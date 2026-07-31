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
  Block,
  BlockChange,
  BlockType,
  ChatMessage,
  Character,
  CritiqueNote,
  ContinuityFlag,
  GuidedOutlinePlan,
  ManuscriptProposal,
  SuggestResult,
} from "@/lib/types";
import type { SpeakerAssignment } from "@/lib/blocks/structure-proposal";
import { getModel } from "@/lib/ai/model";
import { renderGrounding } from "@/lib/ai/grounding-render";
import {
  BRAINSTORM_SYSTEM,
  CLEAN_TRANSCRIPT_SYSTEM,
  CONTINUITY_SYSTEM,
  CRITIQUE_SYSTEM,
  EDIT_SYSTEM,
  GUIDED_OUTLINE_SYSTEM,
  REVISE_SYSTEM,
  STRUCTURE_SYSTEM,
  SUGGEST_SYSTEM,
} from "@/lib/ai/prompts";
import { authorSystem } from "@/lib/ai/author-preferences";

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
  /** The chapter the blocks belong to (becomes ManuscriptProposal.chapterId). */
  chapterId: string;
  chapterTitle?: string;
  characters?: { name: string; role?: string }[];
  /** Blocks the model may revise (already scoped + filtered to eligible types). */
  blocks: { id: string; type: BlockType; text: string }[];
  /** The author's instruction (required for an edit). */
  instruction: string;
  /** Pre-rendered STORY STRUCTURE block, or undefined. */
  structure?: string;
}

/** Options every AI op accepts; the agent threads its AbortSignal through. */
export interface AiOpOptions {
  signal?: AbortSignal;
}

/** Current chapter state and reference data for a guided outlining conversation. */
export interface GuidedOutlineContext {
  chapterId: string;
  chapterTitle: string;
  storyPremise: string;
  act: GuidedOutlinePlan["act"];
  plotPoint: GuidedOutlinePlan["plotPoint"];
  premise: string;
  goal: string;
  conflict: string;
  turn: string;
  cards: {
    id: string;
    title: string;
    intention: string;
    characterIds: string[];
    loreIds: string[];
  }[];
  characters: { id: string; name: string; role: string }[];
  lore: { id: string; title: string; description: string; tags: string[] }[];
  manuscript: string;
}

/** One assistant reply plus an optional full plan preview. */
export interface GuidedOutlineTurn {
  reply: string;
  plan: GuidedOutlinePlan | null;
}

/** AiContext plus the id-labeled blocks offered for anchoring findings. */
export interface AnchoredContext extends AiContext {
  /** Blocks offered for anchoring; rendered id-labeled in the grounding. */
  blocks: { id: string; type: BlockType; text: string }[];
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
  return renderGrounding({
    chapterTitle: ctx.chapterTitle,
    characters: ctx.characters,
    cursorSummary: ctx.cursorSummary,
    structure: ctx.structure,
    prose: ctx.blocksText,
    instruction:
      ctx.instruction !== undefined
        ? { label: "AUTHOR'S REQUEST (follow this)", text: ctx.instruction }
        : undefined,
  });
}

/** Grounding for editBlocks: list each editable block by id, then the request. */
function buildEditGrounding(req: EditRequest): string {
  return renderGrounding({
    chapterTitle: req.chapterTitle,
    characters: req.characters,
    structure: req.structure,
    blocks: { label: "EDITABLE BLOCKS (revise only these, by id)", items: req.blocks },
    instruction: { label: "AUTHOR'S REQUEST (apply to the blocks above)", text: req.instruction },
  });
}

/** Grounding for the anchored review ops: id-labeled blocks instead of prose,
 *  so the model can cite real block ids in its findings. */
function buildAnchoredGrounding(ctx: AnchoredContext): string {
  return renderGrounding({
    chapterTitle: ctx.chapterTitle,
    characters: ctx.characters,
    cursorSummary: ctx.cursorSummary,
    structure: ctx.structure,
    blocks: { label: "SCENE BLOCKS (cite these ids in blockIds)", items: ctx.blocks },
    instruction:
      ctx.instruction !== undefined
        ? { label: "AUTHOR'S REQUEST (follow this)", text: ctx.instruction }
        : undefined,
  });
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

const guidedOutlineBeatSchema = z.object({
  sourceCardId: z
    .string()
    .nullable()
    .describe("existing card id copied from context, or null for a new beat"),
  title: z.string().describe("short, concrete beat title"),
  intention: z.string().describe("one or two sentences on what the beat accomplishes"),
  characterIds: z.array(z.string()).describe("character ids copied from the available cast"),
  loreIds: z.array(z.string()).describe("lore ids copied from the available lore"),
});

const guidedOutlinePlanSchema = z.object({
  chapterId: z.string().describe("chapter id copied from the supplied chapter"),
  summary: z.string().describe("one sentence describing the chapter's dramatic shape"),
  act: z.enum(["setup", "confrontation", "resolution"]).nullable(),
  plotPoint: z
    .enum(["plot-point", "inciting", "pinch", "action", "midpoint", "climax", "resolution"])
    .nullable(),
  premise: z.string().describe("what this chapter is about"),
  goal: z.string().describe("what the point-of-view character wants entering the chapter"),
  conflict: z.string().describe("the obstacle or question creating tension"),
  turn: z.string().describe("the irreversible change or hook leaving the chapter"),
  characterIds: z.array(z.string()).describe("all character ids planned for the chapter"),
  beats: z.array(guidedOutlineBeatSchema).describe("every chapter beat in reading order"),
});

const guidedOutlineTurnSchema = z.object({
  reply: z.string().describe("concise conversational reply with at most one question"),
  plan: guidedOutlinePlanSchema
    .nullable()
    .describe("complete plan preview when ready or requested, otherwise null"),
});

const critiqueNoteSchema = z.object({
  kind: z
    .enum(["strength", "watch", "idea"])
    .describe("strength = working, watch = risk, idea = opportunity"),
  tag: z.string().describe("one- or two-word craft category, e.g. Voice, Pacing"),
  text: z
    .string()
    .describe("one or two sentences naming the specific moment and why"),
  blockIds: z
    .array(z.string())
    .nullable()
    .describe("ids of the SCENE BLOCKS this concerns, copied exactly from their [id] labels; null when it concerns the whole scene"),
});

// Exported for the schema round-trip tests.
export const critiqueResultSchema = z.object({
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
  blockIds: z
    .array(z.string())
    .nullable()
    .describe("ids of the SCENE BLOCKS this concerns, copied exactly from their [id] labels; null when it concerns the whole scene"),
});

// Exported for the schema round-trip tests.
export const continuityResultSchema = z.object({
  flags: z
    .array(continuityFlagSchema)
    .describe("high-signal continuity observations grounded in the supplied text"),
});

const blockEditSchema = z.object({
  blockId: z
    .string()
    .describe("the id of a block to revise, copied exactly from EDITABLE BLOCKS; use each id at most once"),
  newText: z
    .string()
    .describe(
      "the FULL revised text for THIS block only - a self-contained revision of its own text; never fold in, borrow, or merge prose from another block, and never leave it empty. Cleaned prose (no LaTeX)",
    ),
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
  opts?: AiOpOptions,
): Promise<SuggestResult> {
  const model = await getModel();
  const { output } = await generateText({
    model,
    output: Output.object({ schema: suggestResultSchema }),
    system: authorSystem(SUGGEST_SYSTEM, "voice"),
    prompt: buildGrounding(ctx),
    abortSignal: opts?.signal,
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

/** Drop finding blockIds that were not offered. Pure, exported for tests. */
export function sanitizeFindingIds<T extends { blockIds: string[] }>(
  findings: T[],
  offeredIds: string[],
): T[] {
  const known = new Set(offeredIds);
  return findings.map((f) => ({ ...f, blockIds: f.blockIds.filter((id) => known.has(id)) }));
}

/**
 * Read the scene and return craft notes (strengths / things to watch / ideas),
 * each pinned to a concrete moment and anchored to the block ids it cites.
 */
export async function critique(ctx: AnchoredContext, opts?: AiOpOptions): Promise<CritiqueNote[]> {
  const model = await getModel();
  const { output } = await generateText({
    model,
    output: Output.object({ schema: critiqueResultSchema }),
    system: authorSystem(CRITIQUE_SYSTEM, "voice"),
    prompt: buildAnchoredGrounding(ctx),
    abortSignal: opts?.signal,
  });
  return sanitizeFindingIds(
    output.notes.map((n) => ({ ...n, blockIds: n.blockIds ?? [] })),
    ctx.blocks.map((b) => b.id),
  );
}

/**
 * Scan the scene for internal consistency and return continuity observations
 * (ok / warn / flag), anchored to the block ids each observation cites.
 */
export async function continuityCheck(
  ctx: AnchoredContext,
  opts?: AiOpOptions,
): Promise<ContinuityFlag[]> {
  const model = await getModel();
  const { output } = await generateText({
    model,
    output: Output.object({ schema: continuityResultSchema }),
    system: authorSystem(CONTINUITY_SYSTEM, "voice"),
    prompt: buildAnchoredGrounding(ctx),
    abortSignal: opts?.signal,
  });
  return sanitizeFindingIds(
    output.flags.map((f) => ({ ...f, blockIds: f.blockIds ?? [] })),
    ctx.blocks.map((b) => b.id),
  );
}

/**
 * Propose in-place revisions for the supplied blocks that satisfy the author's
 * instruction. Rewrite-only: the result is a ManuscriptProposal whose changes
 * are all rewrites, so every AI write path reviews through one envelope.
 * Sanitized (unknown ids and no-ops removed).
 */
export async function editBlocks(
  req: EditRequest,
  opts?: AiOpOptions,
): Promise<ManuscriptProposal> {
  // Nothing to act on without a direction or an eligible block: skip the model
  // call entirely (the UI also guards this, but defend the boundary too).
  if (!req.instruction.trim() || req.blocks.length === 0) {
    return { chapterId: req.chapterId, summary: "", changes: [] };
  }
  const model = await getModel();
  const { output } = await generateText({
    model,
    output: Output.object({ schema: editResultSchema }),
    system: authorSystem(EDIT_SYSTEM, "voice+editing"),
    prompt: buildEditGrounding(req),
    abortSignal: opts?.signal,
  });
  // The edit schema stays rewrite-shaped; map it onto the shared envelope.
  const changes: BlockChange[] = output.edits.map((e) => ({
    kind: "rewrite",
    blockId: e.blockId,
    afterId: null,
    type: null,
    speaker: null,
    newText: e.newText,
    toIndex: null,
    reason: e.reason,
  }));
  // Keep every edit local to one block: at most one rewrite per blockId, so the
  // model cannot collapse several blocks' edits onto a single block even when it
  // is trying to make them relate. Dedup runs on the SANITIZED survivors so a
  // leading no-op or blank edit can't shadow a genuine revision of the same
  // block; first genuine edit for a block wins, later ones drop.
  const sanitized = sanitizeProposal(
    { chapterId: req.chapterId, summary: "", changes },
    req.blocks,
    null,
  );
  const seen = new Set<string>();
  const deduped = sanitized.changes.filter((c) => {
    if (c.blockId === null || seen.has(c.blockId)) return false;
    seen.add(c.blockId);
    return true;
  });
  return { ...sanitized, changes: deduped };
}

// -- Revise (structural chapter write path) -----------------------------------
// reviseChapter proposes structural changes to ONE chapter's block list. Unlike
// editBlocks (rewrite-only), it may also insert/remove/move blocks. The proposal
// is reviewed change by change in the Edit tab before any of it applies.

const blockChangeSchema = z.object({
  kind: z
    .enum(["rewrite", "insert", "remove", "move"])
    .describe(
      "rewrite revises a block in place, insert adds a new block, remove deletes, move repositions",
    ),
  blockId: z
    .string()
    .nullable()
    .describe(
      "for rewrite/remove/move: an id copied exactly from EDITABLE BLOCKS; null for insert",
    ),
  afterId: z
    .string()
    .nullable()
    .describe(
      "for insert ONLY: the id of the block the new one follows, or null to append at the chapter end; null otherwise",
    ),
  type: z
    .enum(["narration", "dialogue"])
    .nullable()
    .describe("for insert ONLY: the new block's kind; null otherwise"),
  speaker: z
    .string()
    .nullable()
    .describe("for an inserted dialogue block: the speaker's display name; null otherwise"),
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
    .describe("for move ONLY: zero-based target index in the block list; null otherwise"),
  reason: z.string().describe("short phrase: what changed and why"),
});

// Exported for schema round-trip tests.
export const reviseResultSchema = z.object({
  summary: z.string().describe("one sentence describing the overall revision"),
  changes: z
    .array(blockChangeSchema)
    .describe("the smallest set of changes that delivers the request; empty if none needed"),
});

/**
 * Drop changes the review UI can't safely apply. Rules: rewrite needs a known
 * blockId + newText that differs trimmed from the current text; insert needs
 * non-empty trimmed newText + a type + (afterId null or known); remove needs a
 * known blockId; move needs a known blockId + a toIndex. When an allowlist is
 * supplied it confines every change to those targets (inserts must anchor after
 * a target, never at the chapter end); null leaves the proposal unrestricted.
 * Pure: returns a new proposal.
 */
export function sanitizeProposal(
  proposal: ManuscriptProposal,
  blocks: { id: string; text: string }[],
  allowedTargetIds: readonly string[] | null,
): ManuscriptProposal {
  const textById = new Map(blocks.map((b) => [b.id, b.text]));
  const allowed = allowedTargetIds === null ? null : new Set(allowedTargetIds);
  const permits = (id: string | null): boolean =>
    allowed === null || (id !== null && allowed.has(id));
  const changes = proposal.changes.filter((c) => {
    switch (c.kind) {
      case "rewrite": {
        if (c.blockId === null || c.newText === null || !permits(c.blockId)) return false;
        const current = textById.get(c.blockId);
        // A rewrite is an in-place revision: a known target, genuinely changed
        // text, and non-empty. Blanking a block is a delete, not a revision -
        // dropping it keeps a merge attempt from leaving an empty block behind.
        return (
          current !== undefined &&
          c.newText.trim() !== "" &&
          c.newText.trim() !== current.trim()
        );
      }
      case "insert":
        return (
          c.newText !== null &&
          c.newText.trim() !== "" &&
          c.type !== null &&
          ((c.afterId !== null && textById.has(c.afterId) && permits(c.afterId)) ||
            (c.afterId === null && allowed === null))
        );
      case "remove":
        return c.blockId !== null && textById.has(c.blockId) && permits(c.blockId);
      case "move":
        return c.blockId !== null && textById.has(c.blockId) && c.toIndex !== null && permits(c.blockId);
    }
  });
  return { ...proposal, changes };
}

/**
 * Propose structural changes to the supplied blocks that satisfy the author's
 * instruction. All change kinds allowed (rewrite/insert/remove/move); returns a
 * sanitized ManuscriptProposal the Edit tab reviews change by change.
 */
export async function reviseChapter(
  req: EditRequest,
  opts?: AiOpOptions,
): Promise<ManuscriptProposal> {
  // Nothing to act on without a direction or an eligible block: skip the model
  // call entirely (the UI also guards this, but defend the boundary too).
  if (!req.instruction.trim() || req.blocks.length === 0) {
    return { chapterId: req.chapterId, summary: "", changes: [] };
  }
  const model = await getModel();
  const { output } = await generateText({
    model,
    output: Output.object({ schema: reviseResultSchema }),
    // Voice only, by design: the mechanical editing rules are scoped to Edit and
    // Muse (as the "Editing & Muse rules" setting states), not chapter-wide Revise.
    system: authorSystem(REVISE_SYSTEM, "voice"),
    prompt: buildEditGrounding(req),
    abortSignal: opts?.signal,
  });
  return sanitizeProposal(
    { chapterId: req.chapterId, summary: output.summary, changes: output.changes },
    req.blocks,
    null,
  );
}

// -- Structure (dialogue speaker attribution) ---------------------------------

const speakerAssignmentSchema = z.object({
  assignments: z
    .array(
      z.object({
        index: z.number().int().describe("0-based index into SEED BLOCKS"),
        speaker: z
          .string()
          .nullable()
          .describe("the speaker's display name from KNOWN CAST for a dialogue block; null if unknown"),
      }),
    )
    .describe("one entry per dialogue block you can attribute"),
});

/** Attribute the dialogue blocks in a freshly-structured seed. Returns the
 *  model's name assignments; the caller resolves names to ids and builds the
 *  proposal (structure-proposal.ts). No model call when the seed has no dialogue. */
export async function assignSpeakers(
  seed: Block[],
  cast: Character[],
  grounding: string,
  opts: AiOpOptions | undefined,
): Promise<SpeakerAssignment[]> {
  if (!seed.some((b) => b.type === "dialogue")) return [];
  const model = await getModel();
  const seedLines = seed
    .map((b, i) => {
      if (b.type !== "dialogue") return `[${i}] NARRATION: ${b.text}`;
      const tail = (b.tail ?? []).map((s) => (s.kind === "quote" ? `"${s.text}"` : s.text)).join(" ");
      return `[${i}] DIALOGUE: "${b.text}"${tail ? ` ${tail}` : ""}`;
    })
    .join("\n");
  const castLines = cast.map((c) => `- ${c.name}`).join("\n");
  const prompt = `SEED BLOCKS:\n${seedLines}\n\nKNOWN CAST:\n${castLines}\n\nSURROUNDING CONTEXT:\n${grounding}`;
  const { output } = await generateText({
    model,
    output: Output.object({ schema: speakerAssignmentSchema }),
    system: authorSystem(STRUCTURE_SYSTEM, "voice"),
    prompt,
    abortSignal: opts?.signal,
  });
  return output.assignments;
}

function buildGuidedOutlineGrounding(
  ctx: GuidedOutlineContext,
  currentPlan: GuidedOutlinePlan | null,
): string {
  const currentCards = ctx.cards.length === 0
    ? "-"
    : ctx.cards.map((card, index) => (
        `[${index}] id=${card.id}\nTitle: ${card.title || "-"}\nIntention: ${card.intention || "-"}\nCharacter ids: ${card.characterIds.join(", ") || "-"}\nLore ids: ${card.loreIds.join(", ") || "-"}`
      )).join("\n\n");
  const characters = ctx.characters.length === 0
    ? "-"
    : ctx.characters.map((character) => (
        `- id=${character.id} | ${character.name} | ${character.role || "-"}`
      )).join("\n");
  const lore = ctx.lore.length === 0
    ? "-"
    : ctx.lore.map((entry) => (
        `- id=${entry.id} | ${entry.title} | ${entry.description || "-"} | tags: ${entry.tags.join(", ") || "-"}`
      )).join("\n");
  const parts = [
    `CHAPTER:\nid=${ctx.chapterId}\nTitle: ${ctx.chapterTitle}`,
    `STORY PREMISE:\n${ctx.storyPremise || "-"}`,
    `CURRENT CHAPTER OUTLINE:\nAct: ${ctx.act || "-"}\nStructural beat: ${ctx.plotPoint || "-"}\nPremise: ${ctx.premise || "-"}\nGoal: ${ctx.goal || "-"}\nConflict: ${ctx.conflict || "-"}\nTurn: ${ctx.turn || "-"}`,
    `CURRENT PLOT ELEMENTS:\n${currentCards}`,
    `AVAILABLE CHARACTERS:\n${characters}`,
    `AVAILABLE LORE:\n${lore}`,
  ];
  if (ctx.manuscript.trim()) {
    parts.push(`CURRENT MANUSCRIPT:\n${ctx.manuscript.trim()}`);
  }
  if (currentPlan !== null) {
    parts.push(`CURRENT PREVIEW:\n${JSON.stringify(currentPlan, null, 2)}`);
  }
  return parts.join("\n\n");
}

/**
 * Continue a guided outlining interview. The model returns conversational text
 * and, once ready, a complete structured plan preview in the same response.
 */
export async function guideChapterOutline(
  messages: ChatMessage[],
  ctx: GuidedOutlineContext,
  currentPlan: GuidedOutlinePlan | null,
  opts?: AiOpOptions,
): Promise<GuidedOutlineTurn> {
  const model = await getModel();
  const { output } = await generateText({
    model,
    output: Output.object({ schema: guidedOutlineTurnSchema }),
    system: authorSystem(GUIDED_OUTLINE_SYSTEM, "voice"),
    messages: [
      {
        role: "user",
        content: `Here is the chapter context for our conversation.\n\n${buildGuidedOutlineGrounding(ctx, currentPlan)}`,
      },
      ...messages,
    ],
    abortSignal: opts?.signal,
  });
  return sanitizeGuidedOutlineTurn(
    { reply: output.reply, plan: output.plan },
    ctx,
  );
}

/**
 * Constrain model-authored outline references to the chapter and roster supplied
 * by the app. Beat-level cast is folded into chapter cast so the two cannot drift.
 */
export function sanitizeGuidedOutlineTurn(
  turn: GuidedOutlineTurn,
  ctx: GuidedOutlineContext,
): GuidedOutlineTurn {
  if (turn.plan === null) return { reply: turn.reply, plan: null };
  const characterIds = new Set(ctx.characters.map((character) => character.id));
  const loreIds = new Set(ctx.lore.map((entry) => entry.id));
  const cardIds = new Set(ctx.cards.map((card) => card.id));
  const usedCardIds = new Set<string>();
  const uniqueAllowed = (ids: string[], allowed: Set<string>): string[] =>
    [...new Set(ids.filter((id) => allowed.has(id)))];
  const beats = turn.plan.beats.map((beat) => {
    const canReuseCard = beat.sourceCardId !== null
      && cardIds.has(beat.sourceCardId)
      && !usedCardIds.has(beat.sourceCardId);
    if (canReuseCard && beat.sourceCardId !== null) usedCardIds.add(beat.sourceCardId);
    return {
      ...beat,
      sourceCardId: canReuseCard ? beat.sourceCardId : null,
      characterIds: uniqueAllowed(beat.characterIds, characterIds),
      loreIds: uniqueAllowed(beat.loreIds, loreIds),
    };
  });
  return {
    reply: turn.reply,
    plan: {
      ...turn.plan,
      chapterId: ctx.chapterId,
      characterIds: uniqueAllowed(
        [
          ...turn.plan.characterIds,
          ...beats.flatMap((beat) => beat.characterIds),
        ],
        characterIds,
      ),
      beats,
    },
  };
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
  opts?: AiOpOptions,
): Promise<ReturnType<typeof streamText>> {
  const model = await getModel();
  return streamText({
    model,
    system: authorSystem(BRAINSTORM_SYSTEM, "voice"),
    messages: [
      {
        role: "user",
        content: `Here is the manuscript context for our conversation.\n\n${buildGrounding(ctx)}`,
      },
      ...messages,
    ],
    abortSignal: opts?.signal,
  });
}

/**
 * Repair a speech-to-text transcription using the surrounding manuscript as
 * context, returning only the corrected prose (no commentary, no LaTeX).
 */
export async function cleanTranscript(
  raw: string,
  ctx: AiContext,
  opts?: AiOpOptions,
): Promise<string> {
  const model = await getModel();
  const { textStream } = streamText({
    model,
    system: authorSystem(CLEAN_TRANSCRIPT_SYSTEM, "voice"),
    prompt: `${buildGrounding(ctx)}\n\nRAW DICTATION TO CLEAN:\n${raw}`,
    abortSignal: opts?.signal,
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
