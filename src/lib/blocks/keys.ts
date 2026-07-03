// keys.ts - the prose-textarea keydown decision table: the Enter/Backspace
// block grammar (split, continue, merge, delete-empty). Kept pure, like
// click.ts, so the routing is unit-testable without rendering a component.
//
// Only unmodified Enter/Backspace route here; chords stay with the keybinding
// registry (Cmd+Shift+Enter split/carve) and Shift+Enter keeps the native
// newline for an intra-block break.

import type { BlockType } from "@/lib/types";

export type ProseKeyAction =
  | { kind: "split"; at: number }
  | { kind: "insert-after"; type: BlockType }
  | { kind: "merge" }
  | { kind: "delete-empty" }
  /** Swallow the key: acting would corrupt text (e.g. a newline typed at offset 0). */
  | { kind: "suppress" }
  | { kind: "none" };

/**
 * What Enter at the end of a block starts next: prose continues as itself,
 * dialogue continues the conversation, and headings/breaks/notes hand off to
 * narration (they are asides or markers, not runs of prose).
 */
const CONTINUATION: Record<BlockType, BlockType> = {
  narration: "narration",
  dialogue: "dialogue",
  chapter: "narration",
  lore: "narration",
  scratchpad: "narration",
  latex: "narration", // unreachable - the latex editor keeps native newlines
};

/**
 * Types whose text can absorb the block below on a merge. Dialogue is excluded:
 * merging would silently fold one speaker's line into another's quote.
 */
export const MERGEABLE: ReadonlySet<BlockType> = new Set(["narration", "lore", "scratchpad"]);

/**
 * The one merge rule, shared by the key router and the store action so the two
 * can never drift: same mergeable type, and the absorbed block must not carry
 * a beat/title the merge would silently drop.
 */
export function canMerge(
  prevType: BlockType | null,
  curType: BlockType,
  carriesFields: boolean,
): boolean {
  return prevType === curType && MERGEABLE.has(curType) && !carriesFields;
}

export function proseKeyAction(opts: {
  key: string;
  shift: boolean;
  /** Cmd/Ctrl held - chords belong to the keybinding registry, never here. */
  mod: boolean;
  selectionStart: number;
  selectionEnd: number;
  valueLength: number;
  blockType: BlockType;
  /** The block's text is empty or whitespace-only. */
  blockEmpty: boolean;
  /** The block has a beat or title a merge/delete would silently drop. */
  carriesFields: boolean;
  prevType: BlockType | null;
}): ProseKeyAction {
  if (opts.mod) return { kind: "none" };
  const caret = opts.selectionStart === opts.selectionEnd ? opts.selectionStart : null;

  if (opts.key === "Enter" && !opts.shift) {
    // A selection keeps the native replace-with-newline behavior.
    if (caret === null) return { kind: "none" };
    if (caret >= opts.valueLength) return { kind: "insert-after", type: CONTINUATION[opts.blockType] };
    // Caret at the very start: a split would only mint an empty twin above,
    // and falling through would type a hidden newline at the head of the text.
    if (caret === 0) return { kind: "suppress" };
    return { kind: "split", at: caret };
  }

  if (opts.key === "Backspace" && caret === 0) {
    if (opts.prevType === null) return { kind: "none" };
    if (opts.blockEmpty && !opts.carriesFields) return { kind: "delete-empty" };
    if (!opts.blockEmpty && canMerge(opts.prevType, opts.blockType, opts.carriesFields))
      return { kind: "merge" };
    return { kind: "none" };
  }

  return { kind: "none" };
}
