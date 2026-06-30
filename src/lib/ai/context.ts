// context.ts — build the AiContext from current editor state.
//
// Every AI operation is grounded on what the writer is actually looking at: the
// chapter title, the scene's prose up to the cursor, where the cursor sits, and
// the known cast. Lore/scratchpad/raw-latex blocks are intentionally excluded —
// they don't render and shouldn't pollute the prose the model reasons about.

import type { AiContext, EditRequest } from "@/lib/ai/operations";
import type { Block, BlockType, Character } from "@/lib/types";
import { selectionTargetIds, useProjectStore } from "@/stores/project-store";
import { renderStoryStructure } from "@/lib/outline/grounding";

/** How much of the chapter a grounded op reads: up to the caret, or all of it. */
export type ReadScope = "cursor" | "chapter";

/** Shape a run of blocks into the model's view of the prose. Lore/scratchpad/
 *  raw-latex blocks don't render and are excluded upstream; here we only render
 *  the prose types (narration / heading / dialogue). */
function renderProse(upto: Block[], charById: Map<string, Character>): string {
  const lines: string[] = [];
  for (const b of upto) {
    if (b.type === "narration") {
      lines.push(b.text);
    } else if (b.type === "chapter") {
      // A break carries the writer's own freeform separator text (`Interlude`, a
      // fleuron, `* * *`); fall back to the canonical mark only when it is empty.
      lines.push(b.level === "break" ? b.text.trim() || "* * *" : b.text.toUpperCase());
    } else if (b.type === "dialogue") {
      const sp = b.speaker ? charById.get(b.speaker)?.name : undefined;
      lines.push(`${sp ? `${sp}: ` : ""}"${b.text}"${b.beat ? ` ${b.beat}` : ""}`);
    }
  }
  return lines.join("\n\n");
}

/** A one-line note on where the caret sits, derived from the last in-scope block. */
function cursorSummaryFor(upto: Block[]): string {
  const last = upto[upto.length - 1];
  if (!last) return "Cursor is at the start of the chapter.";
  // Only narration/dialogue/heading text is shown to the model; lore, scratchpad,
  // raw-latex and scene-break blocks are excluded from the grounding, so don't
  // leak their text into the cursor summary either. (Taking the last 12 words
  // here is fine — this is a model-facing prompt string, not UI text, so the
  // "no JS truncation" UI rule doesn't apply.)
  const canShowTail =
    last.type === "narration" ||
    last.type === "dialogue" ||
    (last.type === "chapter" && last.level !== "break");
  const tail = canShowTail ? last.text.trim().split(/\s+/).slice(-12).join(" ") : "";
  return tail
    ? `Cursor sits just after a ${last.type} block ending: "${tail}".`
    : `Cursor sits just after a ${last.type} block.`;
}

/** Assemble the full grounding from a run of in-scope blocks + a cursor note. */
function assemble(upto: Block[], cursorSummary: string): AiContext {
  const { project, activeChapterId, meta } = useProjectStore.getState();
  const chapter = project?.chapters.find((c) => c.id === activeChapterId);
  const charById = new Map<string, Character>(
    meta.characters.map((c) => [c.id, c] as const),
  );
  const structure = renderStoryStructure({
    outline: meta.outline,
    chapters: meta.chapters,
    characters: meta.characters,
    activeChapterId,
  });
  return {
    chapterTitle: chapter?.title,
    blocksText: renderProse(upto, charById),
    cursorSummary,
    characters: meta.characters.map((c) => ({ name: c.name, role: c.role })),
    structure: structure ?? undefined,
  };
}

export function buildAiContext(uptoId?: string): AiContext {
  const { blocks, selectedId } = useProjectStore.getState();
  const cutoff = uptoId ?? selectedId;
  const cutoffIdx = cutoff ? blocks.findIndex((b) => b.id === cutoff) : -1;
  const upto = cutoffIdx >= 0 ? blocks.slice(0, cutoffIdx + 1) : blocks;
  return assemble(upto, cursorSummaryFor(upto));
}

/**
 * Grounding scoped to a reading window. `"cursor"` reads the scene up to the
 * caret (the default for grounded ops); `"chapter"` reads every block in the
 * active chapter, ignoring where the caret sits. Critique/Continuity expose this
 * as a toggle so the author can judge what they've written so far vs. the whole
 * chapter.
 */
export function buildScopedContext(scope: ReadScope): AiContext {
  if (scope === "cursor") return buildAiContext();
  const { blocks } = useProjectStore.getState();
  return assemble(blocks, "Reviewing the whole chapter.");
}

/**
 * Grounding for Suggest's continuation. `"cursor"` reads up to the caret (like
 * `buildAiContext`); `"chapter"` reads every block for context but *keeps the
 * caret anchor* (the cursor note from the run up to the caret) so the model
 * continues at the cursor with full-chapter awareness. This is why Suggest can't
 * reuse `buildScopedContext("chapter")`: that drops the caret because
 * Critique/Continuity only review, whereas Suggest generates *at* the cursor.
 */
export function buildSuggestContext(scope: ReadScope): AiContext {
  if (scope === "cursor") return buildAiContext();
  const { blocks, selectedId } = useProjectStore.getState();
  const cutoffIdx = selectedId ? blocks.findIndex((b) => b.id === selectedId) : -1;
  const upto = cutoffIdx >= 0 ? blocks.slice(0, cutoffIdx + 1) : blocks;
  return assemble(blocks, cursorSummaryFor(upto));
}

/** Blocks the Edit tab may revise: rendered prose only (no notes/latex/breaks). */
function isEditable(b: Block): boolean {
  return (
    b.type === "narration" ||
    b.type === "dialogue" ||
    (b.type === "chapter" && b.level !== "break")
  );
}

/**
 * Wrap a resolved set of target blocks in the shared edit envelope: the active
 * chapter title, the cast roster, and the story structure, so revisions keep
 * voice. The single place `buildEditRequest` and `buildRefineRequest` agree on
 * the grounding; only the target blocks differ between them.
 */
function editRequestFor(
  targets: { id: string; type: BlockType; text: string }[],
  instruction: string,
): EditRequest {
  const { project, activeChapterId, meta } = useProjectStore.getState();
  const chapter = project?.chapters.find((c) => c.id === activeChapterId);
  const structure = renderStoryStructure({
    outline: meta.outline,
    chapters: meta.chapters,
    characters: meta.characters,
    activeChapterId,
  });
  return {
    chapterTitle: chapter?.title,
    characters: meta.characters.map((c) => ({ name: c.name, role: c.role })),
    blocks: targets,
    instruction,
    structure: structure ?? undefined,
  };
}

/**
 * Build the request for `editBlocks`. `"block"` scope targets the multi-selection
 * set when one is active, otherwise the single selected block (empty when nothing
 * is selected); non-editable members are dropped (see `isEditable`). `"chapter"`
 * targets every eligible block. Chapter title + cast are included so revisions
 * keep voice.
 */
export function buildEditRequest(
  scope: "block" | "chapter",
  instruction: string,
): EditRequest {
  const { blocks, selectedId, selectedIds } = useProjectStore.getState();

  let targets: Block[];
  if (scope === "block") {
    const idSet = new Set(selectionTargetIds(selectedIds, selectedId));
    // Filter `blocks` (not the id set) so targets stay in document order.
    targets = blocks.filter((b) => idSet.has(b.id) && isEditable(b));
  } else {
    targets = blocks.filter(isEditable);
  }

  return editRequestFor(
    targets.map((b) => ({ id: b.id, type: b.type, text: b.text })),
    instruction,
  );
}

/**
 * Build a single-block edit request whose base text is a caller-supplied draft -
 * a revision the Edit tab already proposed - rather than the block's stored text.
 * This is the seam that lets the author refine a proposal ("now make it colder")
 * so the model reworks the draft they liked instead of re-editing the original
 * block from scratch.
 */
export function buildRefineRequest(
  block: { id: string; type: BlockType },
  baseText: string,
  instruction: string,
): EditRequest {
  return editRequestFor([{ id: block.id, type: block.type, text: baseText }], instruction);
}
