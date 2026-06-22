// latex/ — the LaTeX ↔ block parser/serializer.
//
// Public surface (imported by the stores):
//   parseChapter(source)     → Block[]   split + classify a chapter body
//   serializeChapter(blocks) → string    render blocks back to source
//   serializeBlock(block)    → string    render a single block
//   countWords(blocks)       → number    manuscript word count
//
// The cardinal guarantee — `serializeChapter(parseChapter(src)) === src` for any
// input, as long as no block is dirty — lives in parse.ts / serialize.ts via each
// block's exact `raw`. See those modules for the details.

import type { Block } from "@/lib/types";

export { parseChapter } from "./parse";
export { serializeChapter, serializeBlock } from "./serialize";
export { cleanToText, textToLatex } from "./inline";

/**
 * Count the words in the manuscript prose of a chapter.
 *
 * Only the block kinds that actually render to the page and read as prose are
 * counted: `narration`, `dialogue` (utterance + action beat), and `chapter`
 * scene labels. Non-rendering notes (`lore`, `scratchpad`), scene breaks, and
 * the raw `latex` escape hatch are excluded — counting markup or hidden notes
 * would make the figure meaningless to the writer.
 */
export function countWords(blocks: Block[]): number {
  let total = 0;
  for (const block of blocks) {
    switch (block.type) {
      case "narration":
        total += wordsIn(block.text);
        break;
      case "dialogue":
        total += wordsIn(block.text);
        if (block.beat) total += wordsIn(block.beat);
        break;
      case "chapter":
        if (block.level !== "break") total += wordsIn(block.text);
        break;
      // lore, scratchpad, latex, and scene breaks contribute nothing.
      default:
        break;
    }
  }
  return total;
}

/** Words = maximal runs of non-whitespace. Empty / blank strings count as 0. */
function wordsIn(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}
