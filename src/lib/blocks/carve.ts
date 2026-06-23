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

// Close/reopen `_emphasis_` so a piece sliced from `full` over [a, b) never emits
// a dangling marker. Whitespace trimming doesn't affect marker parity.
function balanceEmphasis(piece: string, full: string, a: number, b: number): string {
  let out = piece;
  if (emphasisOpenAt(full, a)) out = `_${out}`;
  if (emphasisOpenAt(full, b)) out = `${out}_`;
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
    balanceEmphasis(text.slice(0, at).replace(/\s+$/, ""), text, 0, at),
    block.type,
    true,
  );
  const after = makePiece(
    block,
    balanceEmphasis(text.slice(at).replace(/^\s+/, ""), text, at, text.length),
    block.type,
    true,
  );

  // Dialogue: the action beat belongs to the trailing utterance.
  if (block.type === "dialogue" && block.beat !== undefined) after.beat = block.beat;
  // Lore: the title belongs to the first piece only.
  if (block.type === "lore" && block.title !== undefined) before.title = block.title;

  return { blocks: [before, after], focusId: after.id };
}

export function planCarve(block: Block, start: number, end: number, newType: BlockType): CarvePlan {
  const text = block.text;
  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(text.length, Math.max(start, end));

  // Empty selection behaves like a caret split (newType is irrelevant).
  if (a === b) return planSplit(block, a);

  const sameType = newType === block.type;
  const pieces: Block[] = [];

  const beforeText = balanceEmphasis(text.slice(0, a).replace(/\s+$/, ""), text, 0, a);
  if (beforeText.length > 0) pieces.push(makePiece(block, beforeText, block.type, true));

  let midText = balanceEmphasis(text.slice(a, b).trim(), text, a, b);
  if (newType === "dialogue") midText = stripOuterQuotes(midText);
  const mid = makePiece(block, midText, newType, sameType);
  pieces.push(mid);

  const afterText = balanceEmphasis(text.slice(b).replace(/^\s+/, ""), text, b, text.length);
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
