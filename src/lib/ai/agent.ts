// agent.ts - the Muse tool-loop agent core.
//
// runAgent drives one multi-step generateText loop over the active chapter:
// the model plans, reads context through tools (chapter, outline, lore,
// critique), and stages a ManuscriptProposal through the stage_proposal tool.
// The agent can never mutate the manuscript - the sanitized proposal is
// returned to the caller (the Muse tab), which stages it into the Edit tab's
// review gate. The only store write here is get_critique landing a fresh
// critique in the Critique tab's cache entry so the author sees the same
// notes the agent reasoned from.

import { generateText, hasToolCall, stepCountIs, tool } from "ai";
import { z } from "zod";

import type { CritiqueNote, ManuscriptProposal } from "@/lib/types";
import { getModel } from "@/lib/ai/model";
import { MUSE_SYSTEM } from "@/lib/ai/prompts";
import { authorSystem } from "@/lib/ai/author-preferences";
import { buildAnchoredContext } from "@/lib/ai/context";
import { renderGrounding } from "@/lib/ai/grounding-render";
import { critique, sanitizeProposal } from "@/lib/ai/operations";
import { aiCacheKey } from "@/lib/ai/cache-key";
import { renderStoryStructure } from "@/lib/outline/grounding";
import { useProjectStore } from "@/stores/project-store";
import { useAiCacheStore } from "@/stores/ai-cache-store";

export interface AgentStep {
  /** Tool name ("read_chapter", "get_critique", "stage_proposal") or "thinking". */
  tool: string;
  /** Feed line, e.g. "Reading the chapter". */
  label: string;
}

export type MuseScope = "block" | "chapter";

export interface AgentRunOptions {
  signal: AbortSignal;
  onStep: (step: AgentStep) => void;
  scope: MuseScope;
  targetIds: string[];
}

const LOCAL_CHANGE_BOUNDARY = `

LOCAL CHANGE BOUNDARY:
- You may rewrite, remove, or move only a block listed under LOCAL CHANGE TARGETS.
- You may insert only after a block listed under LOCAL CHANGE TARGETS. Do not use a null afterId.
- Read every chapter block as context, but do not stage a change outside the local boundary.`;

// stage_proposal's input mirrors the BlockChange domain type. Nullable (not
// optional) fields follow the OpenAI strict-mode convention used across the
// ops layer; the zod output shape matches BlockChange exactly, so no
// normalization pass is needed.
const changeSchema = z.object({
  kind: z
    .enum(["rewrite", "insert", "remove", "move"])
    .describe("rewrite revises a block in place, insert adds one, remove deletes, move repositions"),
  blockId: z
    .string()
    .nullable()
    .describe("for rewrite/remove/move: an id copied exactly from the chapter blocks; null for insert"),
  afterId: z
    .string()
    .nullable()
    .describe("for insert: the id of an existing chapter block the new one follows; null appends at the chapter end. Several inserts after the same block apply in the order listed"),
  type: z
    .enum(["narration", "dialogue"])
    .nullable()
    .describe("for insert: the new block's kind; null otherwise"),
  speaker: z
    .string()
    .nullable()
    .describe("for insert dialogue: the speaker's display name; null otherwise"),
  newText: z
    .string()
    .nullable()
    .describe(
      "for rewrite/insert: the FULL cleaned text of ONE block - a single paragraph or utterance, no LaTeX and no blank lines; null otherwise",
    ),
  toIndex: z
    .number()
    .int()
    .nullable()
    .describe("for move: zero-based target index in the chapter's block list; null otherwise"),
  reason: z.string().describe("short phrase: what changed and why"),
});

/**
 * Tool-loop agent over the active chapter. Resolves with the staged
 * (sanitized) proposal, or null when the model finished without staging.
 */
export async function runAgent(
  directive: string,
  opts: AgentRunOptions,
): Promise<ManuscriptProposal | null> {
  const { activeChapterId } = useProjectStore.getState();
  if (!activeChapterId) throw new Error("No active chapter.");
  const chapterId = activeChapterId;

  // The tools read the live store while chapterId stays pinned, so a mid-run
  // chapter switch would stage under the old chapter's key citing the new
  // chapter's block ids, and cache the new chapter's critique under the old key.
  // Guard at every point that touches chapter-scoped state, and once more after
  // the loop: a tool's throw becomes a tool-error part in the SDK (it never
  // rejects generateText), so the post-loop check is what surfaces the change.
  const assertSameChapter = () => {
    if (useProjectStore.getState().activeChapterId !== chapterId)
      throw new Error("Chapter changed during the Muse run.");
  };

  const model = await getModel();
  let staged: ManuscriptProposal | null = null;
  const step = (toolName: string, label: string) => opts.onStep({ tool: toolName, label });

  const tools = {
    read_chapter: tool({
      description:
        "Read the active chapter: title, cast, cursor, story structure, and every block labeled by id.",
      inputSchema: z.object({}),
      execute: async () => {
        step("read_chapter", "Reading the chapter");
        const ctx = buildAnchoredContext("chapter");
        return renderGrounding({
          chapterTitle: ctx.chapterTitle,
          characters: ctx.characters,
          cursorSummary: ctx.cursorSummary,
          structure: ctx.structure,
          blocks: {
            label: "CHAPTER BLOCKS (copy these ids exactly into stage_proposal changes)",
            items: ctx.blocks,
          },
          targetIds: opts.scope === "block" ? opts.targetIds : undefined,
        });
      },
    }),
    read_outline: tool({
      description:
        "Read the story structure for the active chapter: premise, act, arc, planned beats.",
      inputSchema: z.object({}),
      execute: async () => {
        step("read_outline", "Reading the outline");
        const { meta, activeChapterId: current } = useProjectStore.getState();
        const structure = renderStoryStructure({
          outline: meta.outline,
          chapters: meta.chapters,
          characters: meta.characters,
          activeChapterId: current,
        });
        return structure ?? "No outline for this chapter.";
      },
    }),
    read_lore: tool({
      description: "Read the project's worldbuilding lore entries.",
      inputSchema: z.object({}),
      execute: async () => {
        step("read_lore", "Reading the lore");
        const { lore } = useProjectStore.getState().meta;
        if (lore.length === 0) return "No lore entries.";
        return lore
          .map((l) => {
            const desc = l.description.trim() ? `: ${l.description.trim()}` : "";
            const tags = l.tags.length > 0 ? ` [${l.tags.join(", ")}]` : "";
            return `- ${l.title}${desc}${tags}`;
          })
          .join("\n");
      },
    }),
    get_critique: tool({
      description:
        "Craft critique of the whole chapter. Cached when the Critique tab already ran it.",
      inputSchema: z.object({}),
      execute: async () => {
        step("get_critique", "Critiquing");
        assertSameChapter();
        const key = aiCacheKey("critique", chapterId, "chapter", "");
        const cached = useAiCacheStore.getState().entries[key]?.data as
          | CritiqueNote[]
          | null
          | undefined;
        let notes = cached ?? null;
        if (!notes) {
          notes = await critique(buildAnchoredContext("chapter"), { signal: opts.signal });
          // Land the fresh result in the Critique tab's chapter-scope entry so
          // the author sees the same notes the agent reasoned from.
          useAiCacheStore
            .getState()
            .patch(key, { data: notes, loading: false, error: null, instruction: directive });
        }
        if (notes.length === 0) return "No critique notes.";
        return notes
          .map(
            (n) =>
              `- [${n.kind}] ${n.tag}: ${n.text}${
                n.blockIds.length > 0 ? ` (blocks: ${n.blockIds.join(", ")})` : ""
              }`,
          )
          .join("\n");
      },
    }),
    stage_proposal: tool({
      description:
        "Stage the full set of manuscript changes for the author's review. Call exactly once, with every change.",
      inputSchema: z.object({
        summary: z.string().describe("one sentence describing the overall revision"),
        changes: z.array(changeSchema).describe("every change, in apply order"),
      }),
      execute: async ({ summary, changes }) => {
        step("stage_proposal", "Drafting changes");
        assertSameChapter();
        const { blocks } = useProjectStore.getState();
        staged = sanitizeProposal(
          { chapterId, summary, changes },
          blocks.map((b) => ({ id: b.id, text: b.text })),
          opts.scope === "block" ? opts.targetIds : null,
        );
        return "Proposal staged for review.";
      },
    }),
  };

  await generateText({
    model,
    system: authorSystem(
      opts.scope === "block" ? MUSE_SYSTEM + LOCAL_CHANGE_BOUNDARY : MUSE_SYSTEM,
      "voice+editing",
    ),
    prompt: directive,
    tools,
    stopWhen: [stepCountIs(8), hasToolCall("stage_proposal")],
    abortSignal: opts.signal,
  });

  assertSameChapter();
  return staged;
}
