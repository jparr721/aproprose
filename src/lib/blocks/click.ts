// click.ts - the block mouse-down decision table, kept pure so the nav/edit vs
// multi-select routing can be unit-tested without rendering the component.

export type BlockClickAction = "toggle" | "select" | "edit" | "none";

/**
 * Resolve a left/right mouse-down on a block into a selection action:
 * - non-left button -> "none" (right-click must not change selection)
 * - Cmd/Ctrl held   -> "toggle" the block in the multi-selection (never edits)
 * - a multi-selection is active, or the block isn't selected -> "select" (a plain
 *   click collapses any multi-selection back to this single block)
 * - the block is already the lone selection -> "edit" (second click), unless it
 *   is already in edit mode -> "none"
 */
export function blockClickAction(opts: {
  button: number;
  modifier: boolean;
  selected: boolean;
  multiActive: boolean;
  editing: boolean;
}): BlockClickAction {
  if (opts.button !== 0) return "none";
  if (opts.modifier) return "toggle";
  if (opts.multiActive || !opts.selected) return "select";
  return opts.editing ? "none" : "edit";
}
