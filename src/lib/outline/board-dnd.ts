// board-dnd.ts -- decode a dnd-kit drop on the outline board into a move.
//
// The board is a multi-container sortable: three columns, each a SortableContext
// over its act's beats. closestCorners hands onDragEnd an `over.id` that is EITHER
// a beat id (the pointer is over a card) OR a column id (the pointer is over an
// empty column or the slack below the last card). This pure helper is the single
// place that branch lives, so onDragEnd just forwards the result to moveBeatTo and
// the rule stays unit-tested in isolation.

import type { ActKind, Outline } from "@/lib/types";

const ACT_ORDER: ActKind[] = ["setup", "confrontation", "resolution"];

/** Droppable id each column registers, distinct from any beat id. */
export const COLUMN_IDS: Record<ActKind, string> = {
  setup: "col:setup",
  confrontation: "col:confrontation",
  resolution: "col:resolution",
};

function actByColumnId(overId: string): ActKind | null {
  return ACT_ORDER.find((k) => COLUMN_IDS[k] === overId) ?? null;
}

function locateBeat(
  outline: Outline,
  beatId: string,
): { actKind: ActKind; index: number } | null {
  for (const act of outline.acts) {
    const index = act.beats.findIndex((b) => b.id === beatId);
    if (index >= 0) return { actKind: act.kind, index };
  }
  return null;
}

/**
 * Resolve a beat drop into `{ toActKind, toIndex }` for moveBeatTo, or null when
 * the drop is a no-op (onto itself) or onto an unrecognized target.
 *
 * - over a column id  -> append to that act (index = its current beat count).
 * - over a beat id    -> that beat's act, at that beat's index (so the dragged
 *   card lands where the hovered card sits; moveBeatTo clamps).
 *
 * Index semantics match moveBeatTo: toIndex is the insertion slot AFTER the
 * dragged beat is removed from its source. For a beat target, passing the
 * over-beat's pre-removal index works in all cases:
 *   - cross-act: removal is in a different act, indices unaffected.
 *   - same-act moving up (active.index > over.index): over is before active,
 *     unaffected by removal.
 *   - same-act moving down (active.index < over.index): after removal, over
 *     shifts to over.index - 1; moveBeatTo receives over.index which clamps to
 *     the new length and splices active after over - the intended behavior.
 */
export function resolveBeatDrop(
  outline: Outline,
  activeId: string,
  overId: string,
): { toActKind: ActKind; toIndex: number } | null {
  if (activeId === overId) return null;

  const column = actByColumnId(overId);
  if (column) {
    const act = outline.acts.find((a) => a.kind === column)!;
    return { toActKind: column, toIndex: act.beats.length };
  }

  const target = locateBeat(outline, overId);
  if (!target) return null;
  return { toActKind: target.actKind, toIndex: target.index };
}
