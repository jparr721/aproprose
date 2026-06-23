// carve.ts — pure block-splitting logic shared by the split/convert editor moves.
//
// Both moves cut a block's `text` at offsets and reflow into new blocks:
//   planSplit  — cut at a caret → 2 pieces, same type.
//   planCarve  — cut a selection out → up to 3 pieces, middle re-typed.
// Pure: Block in, plan out. No store, no DOM. Tested in carve.test.ts.

import type { Block, BlockType } from "@/lib/types";
import { uid } from "@/lib/id";

export interface CarvePlan {
  /** The blocks that replace the source block, in order. */
  blocks: Block[];
  /** The id of the piece the editor should select afterward. */
  focusId: string;
}

// One leading + one trailing quote pair is stripped from dialogue bodies, since
// the serializer renders dialogue's own quotes (`` ``…'' ``).
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["“", "”"],
  ["'", "'"],
  ["‘", "’"],
];

export function stripOuterQuotes(text: string): string {
  const t = text.trim();
  for (const [open, close] of QUOTE_PAIRS) {
    if (t.length >= open.length + close.length && t.startsWith(open) && t.endsWith(close)) {
      return t.slice(open.length, t.length - close.length).trim();
    }
  }
  return t;
}

// True when an `_emphasis_` run is open just before `index` (odd marker count).
function emphasisOpenAt(text: string, index: number): boolean {
  let count = 0;
  const stop = Math.min(index, text.length);
  for (let i = 0; i < stop; i++) {
    if (text[i] === "_") count++;
  }
  return count % 2 === 1;
}

// Re-balance `_emphasis_` markers for a piece whose original span in `full` is
// [start, end). Drops markers orphaned at a cut and opens/closes runs the cut
// split, so no piece ever emits a dangling `_`.
function balanceEmphasis(piece: string, full: string, start: number, end: number): string {
  let out = piece;
  if (emphasisOpenAt(full, start)) {
    // Entering mid-run: a leading marker closes an outside run (orphan → drop);
    // otherwise the piece needs its own opener.
    out = out.startsWith("_") ? out.slice(1) : `_${out}`;
  }
  if (emphasisOpenAt(full, end)) {
    // Leaving mid-run: a trailing marker opens a new run with no content here
    // (orphan → drop); otherwise close the run.
    out = out.endsWith("_") ? out.slice(0, -1) : `${out}_`;
  }
  return out;
}

// A fresh replacement piece. `keepTypeFields` carries the source's type-specific
// fields (speaker/level) onto same-type pieces; beat/title are placed by callers.
function makePiece(source: Block, text: string, type: BlockType, keepTypeFields: boolean): Block {
  const piece: Block = { id: uid(), type, text, raw: "", dirty: true };
  if (keepTypeFields) {
    if (source.speaker !== undefined) piece.speaker = source.speaker;
    if (source.level !== undefined) piece.level = source.level;
  }
  return piece;
}

export function planSplit(block: Block, at: number): CarvePlan {
  const text = block.text;
  if (at <= 0 || at >= text.length) return { blocks: [block], focusId: block.id };

  const before = makePiece(
    block,
    balanceEmphasis(text.slice(0, at), text, 0, at).replace(/\s+$/, ""),
    block.type,
    true,
  );
  const after = makePiece(
    block,
    balanceEmphasis(text.slice(at), text, at, text.length).replace(/^\s+/, ""),
    block.type,
    true,
  );

  if (block.type === "dialogue" && block.beat !== undefined) after.beat = block.beat;
  if (block.type === "lore" && block.title !== undefined) before.title = block.title;

  return { blocks: [before, after], focusId: after.id };
}

export function planCarve(block: Block, start: number, end: number, newType: BlockType): CarvePlan {
  const text = block.text;
  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(text.length, Math.max(start, end));

  // Empty selection behaves like a caret split (newType is irrelevant).
  if (a === b) return planSplit(block, a);

  let midText = balanceEmphasis(text.slice(a, b), text, a, b).trim();
  if (newType === "dialogue") midText = stripOuterQuotes(midText);
  // Whitespace-only (or quotes-only) selection: nothing to carve → treat as a split.
  if (midText.length === 0) return planSplit(block, a);

  const sameType = newType === block.type;
  const pieces: Block[] = [];

  const beforeText = balanceEmphasis(text.slice(0, a), text, 0, a).replace(/\s+$/, "");
  if (beforeText.length > 0) pieces.push(makePiece(block, beforeText, block.type, true));

  const mid = makePiece(block, midText, newType, sameType);
  pieces.push(mid);

  const afterText = balanceEmphasis(text.slice(b), text, b, text.length).replace(/^\s+/, "");
  if (afterText.length > 0) pieces.push(makePiece(block, afterText, block.type, true));

  // Redistribute the source's type-specific singletons to surviving same-type pieces.
  if (block.type === "dialogue" && block.beat !== undefined) {
    const lastDialogue = [...pieces].reverse().find((p) => p.type === "dialogue");
    if (lastDialogue) lastDialogue.beat = block.beat;
  }
  if (block.type === "lore" && block.title !== undefined) {
    const firstLore = pieces.find((p) => p.type === "lore");
    if (firstLore) firstLore.title = block.title;
  }

  return { blocks: pieces, focusId: mid.id };
}
