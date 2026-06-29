// find.ts - the pure matcher behind in-chapter find & replace.
//
// Everything here operates on raw `block.text` (markers included), which is the
// exact string replace writes back, so search target == replace target. The
// store + UI sit on top; this layer is stateless and unit-tested in isolation.

import type { Block } from "@/lib/types";

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/** A single match: the half-open range `[start, end)` into a block's `text`. */
export interface Match {
  blockId: string;
  start: number;
  end: number;
}

type TextBlock = Pick<Block, "id" | "text">;

/** Escape a literal query so regex metacharacters match themselves. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Compile the query to a RegExp. Throws SyntaxError on an invalid pattern. */
function compile(query: string, opts: FindOptions, global: boolean): RegExp {
  let pattern = opts.regex ? query : escapeRegExp(query);
  // Non-capturing wrapper so whole-word never renumbers the user's capture groups.
  if (opts.wholeWord) pattern = `\\b(?:${pattern})\\b`;
  const flags = (global ? "g" : "") + (opts.caseSensitive ? "" : "i");
  return new RegExp(pattern, flags);
}

export function findMatches(
  blocks: TextBlock[],
  query: string,
  opts: FindOptions,
): { matches: Match[]; error: string | null } {
  if (query === "") return { matches: [], error: null };
  let re: RegExp;
  try {
    re = compile(query, opts, true);
  } catch (e) {
    return { matches: [], error: e instanceof Error ? e.message : String(e) };
  }
  const matches: Match[] = [];
  for (const block of blocks) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block.text)) !== null) {
      // Zero-length matches (e.g. `x*`) can't be highlighted or replaced and
      // would spin the loop; skip them and step lastIndex past the position.
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      matches.push({ blockId: block.id, start: m.index, end: m.index + m[0].length });
    }
  }
  return { matches, error: null };
}

/** Replace a single match. Regex mode expands `$1`/`$&`; literal mode is verbatim. */
export function replaceOne(
  text: string,
  match: Pick<Match, "start" | "end">,
  query: string,
  replacement: string,
  opts: FindOptions,
): string {
  const before = text.slice(0, match.start);
  const after = text.slice(match.end);
  // The slice IS the match, so a non-global replace rewrites exactly it - and a
  // function replacer keeps `$` literal when the user isn't in regex mode.
  const middle = opts.regex
    ? text.slice(match.start, match.end).replace(compile(query, opts, false), replacement)
    : replacement;
  return before + middle + after;
}

/** Replace every match across blocks; returns one edit per CHANGED block only. */
export function replaceAllEdits(
  blocks: TextBlock[],
  query: string,
  replacement: string,
  opts: FindOptions,
): { id: string; text: string }[] {
  if (query === "") return [];
  let re: RegExp;
  try {
    re = compile(query, opts, true);
  } catch {
    return [];
  }
  const edits: { id: string; text: string }[] = [];
  for (const block of blocks) {
    re.lastIndex = 0;
    const next = opts.regex
      ? block.text.replace(re, replacement)
      : block.text.replace(re, () => replacement);
    if (next !== block.text) edits.push({ id: block.id, text: next });
  }
  return edits;
}
