// context.ts — build the AiContext from current editor state.
//
// Every AI operation is grounded on what the writer is actually looking at: the
// chapter title, the scene's prose up to the cursor, where the cursor sits, and
// the known cast. Lore/scratchpad/raw-latex blocks are intentionally excluded —
// they don't render and shouldn't pollute the prose the model reasons about.

import type { AiContext, EditRequest } from "@/lib/ai/operations";
import type { Block } from "@/lib/types";
import { selectionTargetIds, useProjectStore } from "@/stores/project-store";
import { renderStoryStructure } from "@/lib/outline/grounding";

export function buildAiContext(uptoId?: string): AiContext {
  const { project, activeChapterId, blocks, meta, selectedId } =
    useProjectStore.getState();
  const chapter = project?.chapters.find((c) => c.id === activeChapterId);

  const cutoff = uptoId ?? selectedId;
  const cutoffIdx = cutoff ? blocks.findIndex((b) => b.id === cutoff) : -1;
  const upto = cutoffIdx >= 0 ? blocks.slice(0, cutoffIdx + 1) : blocks;

  const charById = new Map(meta.characters.map((c) => [c.id, c]));
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

  const last = upto[upto.length - 1];
  let cursorSummary: string;
  if (!last) {
    cursorSummary = "Cursor is at the start of the chapter.";
  } else {
    // Only narration/dialogue/heading text is shown to the model; lore, scratchpad,
    // raw-latex and scene-break blocks are excluded from the grounding, so don't
    // leak their text into the cursor summary either. (Taking the last 12 words
    // here is fine — this is a model-facing prompt string, not UI text, so the
    // "no JS truncation" UI rule doesn't apply.)
    const canShowTail =
      last.type === "narration" ||
      last.type === "dialogue" ||
      (last.type === "chapter" && last.level !== "break");
    const tail = canShowTail
      ? last.text.trim().split(/\s+/).slice(-12).join(" ")
      : "";
    cursorSummary = tail
      ? `Cursor sits just after a ${last.type} block ending: "${tail}".`
      : `Cursor sits just after a ${last.type} block.`;
  }

  const structure = renderStoryStructure({
    outline: meta.outline,
    chapters: meta.chapters,
    characters: meta.characters,
    activeChapterId,
  });

  return {
    chapterTitle: chapter?.title,
    blocksText: lines.join("\n\n"),
    cursorSummary,
    characters: meta.characters.map((c) => ({ name: c.name, role: c.role })),
    structure: structure ?? undefined,
  };
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
  const { project, activeChapterId, blocks, meta, selectedId, selectedIds } =
    useProjectStore.getState();
  const chapter = project?.chapters.find((c) => c.id === activeChapterId);

  let targets: Block[];
  if (scope === "block") {
    const idSet = new Set(selectionTargetIds(selectedIds, selectedId));
    // Filter `blocks` (not the id set) so targets stay in document order.
    targets = blocks.filter((b) => idSet.has(b.id) && isEditable(b));
  } else {
    targets = blocks.filter(isEditable);
  }

  const structure = renderStoryStructure({
    outline: meta.outline,
    chapters: meta.chapters,
    characters: meta.characters,
    activeChapterId,
  });

  return {
    chapterTitle: chapter?.title,
    characters: meta.characters.map((c) => ({ name: c.name, role: c.role })),
    blocks: targets.map((b) => ({ id: b.id, type: b.type, text: b.text })),
    instruction,
    structure: structure ?? undefined,
  };
}
