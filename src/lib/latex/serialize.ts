// serialize.ts — render blocks back to LaTeX source.
//
// The contract is the inverse of parse.ts: for a *clean* block we emit its `raw`
// untouched, so `serializeChapter(parseChapter(src)) === src` exactly. Only when
// a block is `dirty` (edited in the UI) or brand new (no prior `raw`) do we
// re-render it from its fields, reversing the inline cleaning so a no-op edit
// still produces identical bytes.

import type { Block } from "@/lib/types";
import { textToLatex, plainToLatex } from "./inline";

/** Render a whole chapter. Concatenation of per-block output, in order. */
export function serializeChapter(blocks: Block[]): string {
  return blocks.map(serializeBlock).join("");
}

/**
 * Render one block.
 * - clean block: its exact `raw` (fidelity).
 * - dirty / new block: freshly rendered content + the trailing separator carried
 *   over from `raw` (or a fresh `"\n\n"` for blocks that never had a `raw`).
 */
export function serializeBlock(block: Block): string {
  if (!block.dirty && block.raw.length > 0) {
    return block.raw;
  }
  const body = renderBody(block);
  return body + separatorOf(block);
}

// ── body rendering ──────────────────────────────────────────────────────────

function renderBody(block: Block): string {
  switch (block.type) {
    case "narration":
      return textToLatex(block.text);

    case "dialogue": {
      const parts = [`\`\`${textToLatex(block.text)}''`];
      for (const seg of block.tail ?? []) {
        if (seg.text.trim().length === 0) continue;
        parts.push(seg.kind === "quote" ? `\`\`${textToLatex(seg.text)}''` : textToLatex(seg.text));
      }
      const body = parts.join(" ");
      // Persist the speaker as a non-rendering comment above the line, so the
      // assignment survives the save round-trip (parse.ts reads it back). The id
      // references a Character in the project meta.
      return block.speaker ? `% @speaker: ${block.speaker}\n${body}` : body;
    }

    case "chapter": {
      if (block.level === "break") {
        // Freeform centered separator, rendered as plain text (markup is literal
        // here). An empty break falls back to the canonical `* * *` so it never
        // emits a blank interior line that the parser would tear into two blocks.
        const inner = block.text.trim().length > 0 ? plainToLatex(block.text) : "* * *";
        return `\\begin{center}\n${inner}\n\\end{center}`;
      }
      // Scene label: centered + bold. Plain text - the whole-line \textbf is the
      // discriminator, so its content must not itself carry \textbf spans.
      return `\\begin{center}\n\\textbf{${plainToLatex(block.text)}}\n\\end{center}`;
    }

    case "lore": {
      const title = block.title && block.title.trim().length > 0
        ? `[${block.title.trim()}]`
        : "";
      return `% @lore${title}: ${oneLine(block.text)}`;
    }

    case "scratchpad":
      return `% @scratch: ${oneLine(block.text)}`;

    case "latex":
      // Raw escape hatch: emitted verbatim.
      return block.text;
  }
}

// ── separator handling ──────────────────────────────────────────────────────

/**
 * The trailing blank-line separator to put after a re-rendered block. For an
 * edited block we keep whatever separator the original source used (so editing
 * the *content* of a paragraph doesn't disturb the spacing around it). For a
 * brand-new block (no prior `raw`) we use a standard blank line.
 */
function separatorOf(block: Block): string {
  if (block.raw.length === 0) {
    // New block: standard paragraph break.
    return "\n\n";
  }
  return trailingSeparator(block.raw);
}

/**
 * Extract the trailing separator from a block's original `raw`: everything from
 * the last non-empty line's end to the end of `raw`. Mirrors how parse.ts built
 * `raw` (content + separator), so re-rendering preserves byte-exact spacing.
 */
function trailingSeparator(raw: string): string {
  // The separator is the run of trailing newline / whitespace-only-line
  // characters. Find the index just after the last non-whitespace character that
  // is followed only by line-structure whitespace.
  //
  // Practically: strip from the end any maximal suffix consisting solely of
  // `\n` and intra-line whitespace where each `\n`-delimited line is blank.
  const match = /(?:\n[ \t]*)+$/.exec(raw);
  if (match) return match[0];
  // No trailing newline at all (final block of a file with no terminator).
  return "";
}

function oneLine(text: string): string {
  // Comments are single-line by construction; collapse any stray newlines so we
  // never emit a multi-line comment that LaTeX would mis-handle.
  return text.replace(/\s*\n\s*/g, " ").trim();
}
