// board-dnd.ts -- decode a dnd-kit drop on the chapter board into a card move.
//
// The board is a multi-container sortable: one column per chapter, each a
// SortableContext over its cards. closestCorners hands onDragEnd an over.id that
// is EITHER a card id (pointer over a card) OR a column id (pointer over an empty
// column / slack below the last card). This pure helper is the single place that
// branch lives, so onDragEnd just forwards the result to moveCardToChapter.

import type { ChapterOutline } from "@/lib/types";

const COLUMN_PREFIX = "col:";

/** Droppable id each chapter column registers, distinct from any card id. */
export function cardColumnId(chapterId: string): string {
  return `${COLUMN_PREFIX}${chapterId}`;
}

function chapterIdFromColumnId(overId: string): string | null {
  return overId.startsWith(COLUMN_PREFIX) ? overId.slice(COLUMN_PREFIX.length) : null;
}

function locateCard(
  chapters: Record<string, ChapterOutline>,
  cardId: string,
): { chapterId: string; index: number } | null {
  for (const [chapterId, ch] of Object.entries(chapters)) {
    const index = ch.cards.findIndex((c) => c.id === cardId);
    if (index >= 0) return { chapterId, index };
  }
  return null;
}

/**
 * Resolve a card drop into the full move, or null when it is a no-op (onto
 * itself) or onto an unrecognized target. Index semantics mirror moveCardToChapter:
 * - over a column id -> append (index = that chapter's card count).
 * - over a card id   -> that card's chapter, at that card's current index.
 */
export function resolveCardDrop(
  chapters: Record<string, ChapterOutline>,
  activeId: string,
  overId: string,
): { fromChapterId: string; toChapterId: string; cardId: string; toIndex: number } | null {
  if (activeId === overId) return null;
  const src = locateCard(chapters, activeId);
  if (!src) return null;

  const column = chapterIdFromColumnId(overId);
  if (column) {
    return {
      fromChapterId: src.chapterId,
      toChapterId: column,
      cardId: activeId,
      toIndex: chapters[column]?.cards.length ?? 0,
    };
  }

  const tgt = locateCard(chapters, overId);
  if (!tgt) return null;
  return { fromChapterId: src.chapterId, toChapterId: tgt.chapterId, cardId: activeId, toIndex: tgt.index };
}
