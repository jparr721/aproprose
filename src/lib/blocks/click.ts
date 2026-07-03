// click.ts - the block mouse-down decision table, kept pure so the nav/edit vs
// multi-select routing can be unit-tested without rendering the component.

export type BlockClickAction = "toggle" | "range" | "select" | "edit" | "none";

/**
 * Resolve a left/right mouse-down on a block into a selection action:
 * - non-left button -> "none" (right-click must not change selection)
 * - Shift held      -> "range" select from the active block to this one, except
 *   on the block being edited, where shift-click is the native extend-selection
 *   gesture inside the textarea and must stay untouched
 * - Cmd/Ctrl held   -> "toggle" the block in the multi-selection (never edits)
 * - a multi-selection is active, or the block isn't selected -> "select" (a plain
 *   click collapses any multi-selection back to this single block)
 * - the block is already the lone selection -> "edit" (second click), unless it
 *   is already in edit mode -> "none"
 */
export function blockClickAction(opts: {
  button: number;
  modifier: boolean;
  shift: boolean;
  selected: boolean;
  multiActive: boolean;
  editing: boolean;
}): BlockClickAction {
  if (opts.button !== 0) return "none";
  if (opts.shift) return opts.selected && opts.editing ? "none" : "range";
  if (opts.modifier) return "toggle";
  if (opts.multiActive || !opts.selected) return "select";
  return opts.editing ? "none" : "edit";
}

/**
 * The contiguous id span from `anchorId` to `targetId` (inclusive), ordered so
 * the target lands last — setSelection makes the last id the active block.
 * Null when there is no usable anchor; the caller falls back to a plain select.
 */
export function rangeSpan(
  ids: readonly string[],
  anchorId: string | null,
  targetId: string,
): string[] | null {
  if (!anchorId || anchorId === targetId) return null;
  const from = ids.indexOf(anchorId);
  const to = ids.indexOf(targetId);
  if (from === -1 || to === -1) return null;
  const span = ids.slice(Math.min(from, to), Math.max(from, to) + 1);
  if (to < from) span.reverse();
  return span;
}
