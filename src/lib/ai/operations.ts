// operations.ts — the AI operations layer.
//
// This is the seam between the editor UI and the language model. Every function
// here takes the manuscript context the editor assembles (the chapter, the prose
// around the cursor, the known cast) and turns it into a *grounded* request:
// structured operations go through `generateText` with an `Output.object` zod
// schema that mirrors the return type from `@/lib/types`, and the open-ended
// brainstorm chat goes through `streamText` so the UI can render tokens as they
// arrive.
//
// The model + provider come from `./model` (`getModel()`), which reads the API
// key on the Rust side and routes HTTP through Tauri - see that file. We never
// set provider params the chosen model might reject (e.g. `temperature` on a
// reasoning model): we let the SDK defaults apply so whatever model the user
// selected works without per-operation tuning.

import { generateText, Output, streamText } from "ai";
import { z } from "zod";

import type {
  BlockEdit,
  BlockType,
  ChatMessage,
  CritiqueNote,
  ContinuityFlag,
  SculptChange,
  SculptProposal,
  SuggestResult,
} from "@/lib/types";
import { getModel } from "@/lib/ai/model";
import {
  BRAINSTORM_SYSTEM,
  CLEAN_TRANSCRIPT_SYSTEM,
  CONTINUITY_SYSTEM,
  CRITIQUE_SYSTEM,
  EDIT_SYSTEM,
  SCULPT_SYSTEM,
  SUGGEST_SYSTEM,
} from "@/lib/ai/prompts";

// ── Grounding context ───────────────────────────────────────────────────────
// The editor builds an `AiContext` describing what the writer is looking at, and
// every operation grounds itself on it. `blocksText` is the prose of the current
// scene (already cleaned of LaTeX by the block layer); `cursorSummary` marks
// where the writer's caret is so continuation/suggestion land in the right spot.

/** What the editor knows about the writer's current view, handed to every op. */
export interface AiContext {
  /** Title of the chapter being edited, when known. */
  chapterTitle?: string;
  /** The current scene's prose (block text concatenated), already de-LaTeX'd. */
  blocksText: string;
  /** A short note on where the cursor sits, e.g. "after the detective's line". */
  cursorSummary?: string;
  /** The known cast, so the model can name speakers and tag colours. */
  characters?: { name: string; role?: string }[];
  /** Optional free-text steering from the author's ask box; honoured when present. */
  instruction?: string;
  /** Pre-rendered STORY STRUCTURE block (premise + served beat + chapter arc),
   *  or undefined when the scene has no outline context. */
  structure?: string;
}

/** What the Edit tab hands `editBlocks`: the blocks it may revise + the request. */
export interface EditRequest {
  chapterTitle?: string;
  characters?: { name: string; role?: string }[];
  /** Blocks the model may revise (already scoped + filtered to eligible types). */
  blocks: { id: string; type: BlockType; text: string }[];
  /** The author's instruction (required for an edit). */
  instruction: string;
  /** Pre-rendered STORY STRUCTURE block, or undefined. */
  structure?: string;
}

/**
 * Render the grounding the model reads before doing any work: the chapter, the
 * cast roster, the cursor position, the scene prose, and — when the author
 * supplied one — their explicit request, in a stable order. The prose sits near
 * the end and the request last, so the freshest, most salient items are closest
 * to the model's attention. This goes in the `prompt` field; the per-operation
 * instructions live in `system`.
 */
function buildGrounding(ctx: AiContext): string {
  const parts: string[] = [];

  if (ctx.chapterTitle) {
    parts.push(`CHAPTER: ${ctx.chapterTitle}`);
  }

  if (ctx.characters && ctx.characters.length > 0) {
    const roster = ctx.characters
      .map((c) => (c.role ? `- ${c.name} (${c.role})` : `- ${c.name}`))
      .join("\n");
    parts.push(`KNOWN CAST:\n${roster}`);
  }

  if (ctx.cursorSummary) {
    parts.push(`CURSOR: ${ctx.cursorSummary}`);
  }

  if (ctx.structure) {
    parts.push(`STORY STRUCTURE:\n${ctx.structure}`);
  }

  // The scene itself goes before the request so the request is the last,
  // freshest, most salient directive in the model's window.
  parts.push(`SCENE PROSE:\n${ctx.blocksText}`);

  if (ctx.instruction?.trim()) {
    parts.push(`AUTHOR'S REQUEST (follow this):\n${ctx.instruction.trim()}`);
  }

  return parts.join("\n\n");
}

/** Grounding for editBlocks: list each editable block by id, then the request. */
function buildEditGrounding(req: EditRequest): string {
  const parts: string[] = [];
  if (req.chapterTitle) parts.push(`CHAPTER: ${req.chapterTitle}`);
  if (req.characters && req.characters.length > 0) {
    const roster = req.characters
      .map((c) => (c.role ? `- ${c.name} (${c.role})` : `- ${c.name}`))
      .join("\n");
    parts.push(`KNOWN CAST:\n${roster}`);
  }
  if (req.structure) {
    parts.push(`STORY STRUCTURE:\n${req.structure}`);
  }
  const blocks = req.blocks
    .map((b) => `[${b.id}] (${b.type}): ${b.text}`)
    .join("\n\n");
  parts.push(`EDITABLE BLOCKS (revise only these, by id):\n${blocks}`);
  parts.push(`AUTHOR'S REQUEST (apply to the blocks above):\n${req.instruction.trim()}`);
  return parts.join("\n\n");
}

// ── Zod schemas ───────────────────────────────────────────────────────────────
// Each schema mirrors the matching return type in `@/lib/types` exactly. The
// `.describe()` calls double as inline guidance the SDK forwards to the model,
// and the inferred type is asserted against the domain type at each call site.

const suggestionSchema = z.object({
  type: z
    .enum(["dialogue", "narration"])
    .describe("dialogue when primarily a spoken line, else narration"),
  // Nullable (not optional): OpenAI strict structured output requires every
  // property to appear in `required`, so absent values are sent as null.
  speaker: z
    .string()
    .nullable()
    .describe("display name of the speaker for dialogue, else null"),
  text: z
    .string()
    .describe("the continuation prose, in the manuscript's voice, plain (no LaTeX)"),
  rationale: z
    .string()
    .describe("one sentence on why this direction works, tied to the page"),
});

const suggestResultSchema = z.object({
  suggestions: z
    .array(suggestionSchema)
    .describe("three distinct continuations, mixing dialogue and narration"),
  followups: z
    .array(z.string())
    .describe("a few short 'after this, you could' nudges"),
});

const critiqueNoteSchema = z.object({
  kind: z
    .enum(["strength", "watch", "idea"])
    .describe("strength = working, watch = risk, idea = opportunity"),
  tag: z.string().describe("one- or two-word craft category, e.g. Voice, Pacing"),
  text: z
    .string()
    .describe("one or two sentences naming the specific moment and why"),
});

const critiqueResultSchema = z.object({
  notes: z
    .array(critiqueNoteSchema)
    .describe("a balanced handful of notes, leading with at least one strength"),
});

const continuityFlagSchema = z.object({
  sev: z
    .enum(["ok", "warn", "flag"])
    .describe("ok = tracked cleanly, warn = soft inconsistency, flag = likely error"),
  tag: z.string().describe("short label for the tracked thing, e.g. Cast, Timeline"),
  text: z
    .string()
    .describe("one or two sentences describing the observation and where it appears"),
});

const continuityResultSchema = z.object({
  flags: z
    .array(continuityFlagSchema)
    .describe("high-signal continuity observations grounded in the supplied text"),
});

const blockEditSchema = z.object({
  blockId: z
    .string()
    .describe("the id of a block to revise, copied exactly from EDITABLE BLOCKS"),
  newText: z
    .string()
    .describe("the FULL revised text for that block, cleaned prose (no LaTeX)"),
  reason: z.string().describe("short phrase: what changed and why"),
});

const editResultSchema = z.object({
  edits: z
    .array(blockEditSchema)
    .describe("only the blocks that need changes; empty if none do"),
});

// ── Structured operations ─────────────────────────────────────────────────────
// Each delegates to `generateText` with an `Output.object` schema and returns
// the validated `output`, shaped to the domain type. We pass `system` (the
// operation's instructions) and `prompt` (the grounding) separately so the
// framing stays stable while the manuscript varies.

/**
 * Propose three distinct continuations (a mix of dialogue and narration), each
 * with a rationale, plus a few short follow-up nudges — all grounded on `ctx`.
 */
export async function suggestContinuation(
  ctx: AiContext,
): Promise<SuggestResult> {
  const model = await getModel();
  const { output } = await generateText({
    model,
    output: Output.object({ schema: suggestResultSchema }),
    system: SUGGEST_SYSTEM,
    prompt: buildGrounding(ctx),
  });
  // Normalize null -> undefined to match the domain type's optional fields.
  return {
    suggestions: output.suggestions.map((s) => ({
      type: s.type,
      text: s.text,
      rationale: s.rationale,
      speaker: s.speaker ?? undefined,
    })),
    followups: output.followups,
  };
}

/**
 * Read the scene and return craft notes (strengths / things to watch / ideas),
 * each pinned to a concrete moment in the prose.
 */
export async function critique(ctx: AiContext): Promise<CritiqueNote[]> {
  const model = await getModel();
  const { output } = await generateText({
    model,
    output: Output.object({ schema: critiqueResultSchema }),
    system: CRITIQUE_SYSTEM,
    prompt: buildGrounding(ctx),
  });
  return output.notes;
}

/**
 * Scan the scene for internal consistency and return continuity observations
 * (ok / warn / flag), grounded only on what the supplied text supports.
 */
export async function continuityCheck(
  ctx: AiContext,
): Promise<ContinuityFlag[]> {
  const model = await getModel();
  const { output } = await generateText({
    model,
    output: Output.object({ schema: continuityResultSchema }),
    system: CONTINUITY_SYSTEM,
    prompt: buildGrounding(ctx),
  });
  return output.flags;
}

/**
 * Drop edits the UI can't safely apply: ones targeting a block that wasn't
 * offered, and no-ops where the revised text matches the current text (trimmed).
 */
export function sanitizeEdits(
  edits: BlockEdit[],
  blocks: { id: string; text: string }[],
): BlockEdit[] {
  const textById = new Map(blocks.map((b) => [b.id, b.text]));
  return edits.filter((e) => {
    const current = textById.get(e.blockId);
    return current !== undefined && e.newText.trim() !== current.trim();
  });
}

/**
 * Propose in-place revisions for the supplied blocks that satisfy the author's
 * instruction. Returns the full revised text per changed block, already
 * sanitized (unknown ids and no-ops removed).
 */
export async function editBlocks(req: EditRequest): Promise<BlockEdit[]> {
  // Nothing to act on without a direction or an eligible block: skip the model
  // call entirely (the UI also guards this, but defend the boundary too).
  if (!req.instruction.trim() || req.blocks.length === 0) return [];
  const model = await getModel();
  const { output } = await generateText({
    model,
    output: Output.object({ schema: editResultSchema }),
    system: EDIT_SYSTEM,
    prompt: buildEditGrounding(req),
  });
  return sanitizeEdits(output.edits, req.blocks);
}

// ── Sculpt (chapter-level AI write path) ──────────────────────────────────────
// sculptChapter proposes structural changes to ONE chapter's plot-element cards.
// Unlike editBlocks (in-place rewrite only), it may also add/move/remove cards.
// The proposal is reviewed behind a gate in the board before any of it applies.

/** What the board hands `sculptChapter`: one chapter's spine + cards + roster. */
export interface SculptContext {
  chapterId: string;
  chapterTitle: string;
  /** The global logline. */
  storyPremise: string;
  /** The chapter's own premise. */
  premise: string;
  goal: string;
  conflict: string;
  turn: string;
  /** The chapter's cards in order, by id, for the model to reference and reorder. */
  cards: { id: string; title: string; intention: string }[];
  characters: { name: string }[];
  lore: { title: string; description: string; tags: string[] }[];
}

const sculptChangeSchema = z.object({
  kind: z
    .enum(["rewrite", "add", "move", "remove"])
    .describe("rewrite revises a card in place, add inserts a new card, move repositions, remove deletes"),
  cardId: z
    .string()
    .nullable()
    .describe("for rewrite/move/remove: an id copied exactly from the supplied cards; null for add"),
  title: z.string().nullable().describe("proposed card title for rewrite/add; null otherwise"),
  intention: z
    .string()
    .nullable()
    .describe("proposed one-to-two sentence intention for rewrite/add; null otherwise"),
  toIndex: z
    .number()
    .int()
    .nullable()
    .describe("for move ONLY: zero-based target index within the chapter; null otherwise"),
  reason: z.string().describe("one short sentence on why this change strengthens the chapter"),
});

const sculptProposalSchema = z.object({
  chapterId: z.string().describe("the chapter being reshaped, echoed back from context"),
  summary: z.string().describe("one sentence describing the overall reshape"),
  changes: z
    .array(sculptChangeSchema)
    .describe("the structural changes to apply; few or none if the chapter is already tight"),
});

/** Render the sculpt grounding: the chapter's spine, its ordered cards, cast, lore. */
function buildSculptGrounding(ctx: SculptContext): string {
  const parts: string[] = [];
  parts.push(`CHAPTER: ${ctx.chapterTitle}`);
  if (ctx.storyPremise.trim()) parts.push(`STORY PREMISE: ${ctx.storyPremise.trim()}`);
  const spine = [
    ctx.premise.trim() ? `Premise: ${ctx.premise.trim()}` : "",
    ctx.goal.trim() ? `Goal: ${ctx.goal.trim()}` : "",
    ctx.conflict.trim() ? `Conflict: ${ctx.conflict.trim()}` : "",
    ctx.turn.trim() ? `Turn: ${ctx.turn.trim()}` : "",
  ].filter(Boolean);
  if (spine.length > 0) parts.push(`CHAPTER SPINE:\n${spine.join("\n")}`);
  if (ctx.characters.length > 0) {
    parts.push(`KNOWN CAST:\n${ctx.characters.map((c) => `- ${c.name}`).join("\n")}`);
  }
  if (ctx.lore.length > 0) {
    parts.push(`LORE:\n${ctx.lore.map((l) => `- ${l.title}${l.description ? `: ${l.description}` : ""}`).join("\n")}`);
  }
  const cards = ctx.cards
    .map((c, i) => `[${i}] (${c.id}) ${c.title}: ${c.intention}`)
    .join("\n");
  parts.push(`PLOT ELEMENTS (in order; reorder/rewrite/add/remove these):\n${cards || "(none yet)"}`);
  return parts.join("\n\n");
}

/**
 * Drop changes the board can't safely apply: rewrite/move/remove whose cardId is
 * not one of `cardIds`, a `move` with no `toIndex`, and a `rewrite` that proposes
 * no title or intention (a no-op). Pure: returns a new proposal.
 */
export function sanitizeSculpt(proposal: SculptProposal, cardIds: string[]): SculptProposal {
  const known = new Set(cardIds);
  const changes = proposal.changes.filter((c: SculptChange) => {
    switch (c.kind) {
      case "add":
        return true;
      case "rewrite":
        return c.cardId !== null && known.has(c.cardId) && (c.title !== null || c.intention !== null);
      case "move":
        return c.cardId !== null && known.has(c.cardId) && c.toIndex !== null;
      case "remove":
        return c.cardId !== null && known.has(c.cardId);
    }
  });
  return { ...proposal, changes };
}

/**
 * Propose structural changes to ONE chapter. Returns a validated, sanitized
 * proposal the board reviews behind its gate. A truly empty chapter (no spine,
 * no cards) has nothing to reshape, so we skip the call.
 */
export async function sculptChapter(ctx: SculptContext): Promise<SculptProposal> {
  const empty =
    ctx.cards.length === 0 &&
    !ctx.premise.trim() &&
    !ctx.goal.trim() &&
    !ctx.conflict.trim() &&
    !ctx.turn.trim();
  if (empty) {
    return { chapterId: ctx.chapterId, summary: "", changes: [] };
  }
  const model = await getModel();
  const { output } = await generateText({
    model,
    output: Output.object({ schema: sculptProposalSchema }),
    system: SCULPT_SYSTEM,
    prompt: buildSculptGrounding(ctx),
  });
  return sanitizeSculpt(
    { chapterId: ctx.chapterId, summary: output.summary, changes: output.changes },
    ctx.cards.map((c) => c.id),
  );
}

// ── Streaming + freeform operations ─────────────────────────────────────────

/**
 * Open-ended brainstorm chat about the manuscript. Returns the `streamText`
 * result so the UI can render tokens as they arrive — callers iterate
 * `result.textStream` (an async iterable of string chunks), e.g.
 *
 * ```ts
 * const result = await brainstorm(messages, ctx);
 * for await (const delta of result.textStream) append(delta);
 * ```
 *
 * The grounding is injected as a leading user turn so it sits ahead of the live
 * conversation while the instructions stay in `system`.
 *
 * The return type is `streamText`'s own result type (inferred), so it tracks the
 * SDK exactly and exposes `textStream` for the UI to consume.
 */
export async function brainstorm(
  messages: ChatMessage[],
  ctx: AiContext,
): Promise<ReturnType<typeof streamText>> {
  const model = await getModel();
  return streamText({
    model,
    system: BRAINSTORM_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Here is the manuscript context for our conversation.\n\n${buildGrounding(ctx)}`,
      },
      ...messages,
    ],
  });
}

/**
 * Repair a speech-to-text transcription using the surrounding manuscript as
 * context, returning only the corrected prose (no commentary, no LaTeX).
 */
export async function cleanTranscript(
  raw: string,
  ctx: AiContext,
): Promise<string> {
  const model = await getModel();
  const { textStream } = streamText({
    model,
    system: CLEAN_TRANSCRIPT_SYSTEM,
    prompt: `${buildGrounding(ctx)}\n\nRAW DICTATION TO CLEAN:\n${raw}`,
  });

  // Drain the stream into the full corrected passage. We stream rather than use
  // generateText so the same provider path (and its tolerance for the pinned
  // model's params) is exercised uniformly across operations.
  let cleaned = "";
  for await (const delta of textStream) {
    cleaned += delta;
  }
  return cleaned.trim();
}
