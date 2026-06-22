// context.ts — build the AiContext from current editor state.
//
// Every AI operation is grounded on what the writer is actually looking at: the
// chapter title, the scene's prose up to the cursor, where the cursor sits, and
// the known cast. Lore/scratchpad/raw-latex blocks are intentionally excluded —
// they don't render and shouldn't pollute the prose the model reasons about.

import type { AiContext } from "@/lib/ai/operations";
import { useProjectStore } from "@/stores/project-store";

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
      lines.push(b.level === "break" ? "* * *" : b.text.toUpperCase());
    } else if (b.type === "dialogue") {
      const sp = b.speaker ? charById.get(b.speaker)?.name : undefined;
      lines.push(`${sp ? `${sp}: ` : ""}"${b.text}"${b.beat ? ` ${b.beat}` : ""}`);
    }
  }

  const last = upto[upto.length - 1];
  const cursorSummary = last
    ? `Cursor sits just after a ${last.type} block.`
    : "Cursor is at the start of the chapter.";

  return {
    chapterTitle: chapter?.title,
    blocksText: lines.join("\n\n"),
    cursorSummary,
    characters: meta.characters.map((c) => ({ name: c.name, role: c.role })),
  };
}
