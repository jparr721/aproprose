// inline.ts — fully reversible conversion between inline LaTeX and the cleaned
// "prose" text the editor shows.
//
// The editor never displays raw LaTeX for simple prose: emphasis becomes
// `_italics_`, bold becomes `**bold**`, TeX quotes become straight `"…"` / `'…'`, and the dash ligatures
// become real Unicode dashes. The two functions here are exact inverses for the
// constructs we recognise, so a no-op edit of a narration/dialogue block still
// round-trips byte-for-byte (the serializer reverses the cleaning before diffing
// against the original `raw`).
//
// Anything *not* covered here is the parser's signal that a paragraph is not
// "simple prose" — those paragraphs are classified as `latex` and edited
// verbatim, never run through these helpers. So we only need to handle the small
// closed vocabulary that simple prose is allowed to contain.

import { parseInline, type InlineNode } from "./markup";

// ── LaTeX special characters ────────────────────────────────────────────────
// The six characters TeX treats specially in normal text and that a writer might
// type literally. `\` and `{`/`}` are deliberately excluded: a backslash in a
// "simple" paragraph means a macro (which disqualifies it from prose), and the
// parser refuses braces outside of the `\emph{…}` and `\textbf{…}` we explicitly unwrap. We keep
// the set minimal so the inverse is unambiguous.
const LATEX_ESCAPES: ReadonlyArray<readonly [string, string]> = [
  ["&", "\\&"],
  ["%", "\\%"],
  ["$", "\\$"],
  ["#", "\\#"],
  ["_", "\\_"],
];

/**
 * Convert cleaned editor text into LaTeX source. The inverse of
 * {@link cleanToText}. Applied only when re-serializing a *dirty* prose block.
 *
 * The inline tree is built first (so `_` and `**` markers are recognised), then LaTeX special characters are escaped on the resulting text leaves.
 */
export function textToLatex(text: string): string {
  let out = nodesToLatex(parseInline(text));
  out = out.replace(/—/g, "---").replace(/–/g, "--");
  out = doubleStraightToTeX(out);
  out = singleStraightToTeX(out);
  return out;
}

/** Emit LaTeX from an inline node tree; escape specials on every text leaf. */
function nodesToLatex(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      if (n.kind === "text") return escapeSpecials(n.value);
      if (n.kind === "bold") return `\\textbf{${nodesToLatex(n.children)}}`;
      if (n.kind === "italic") return `\\emph{${nodesToLatex(n.children)}}`;
      const _exhaustive: never = n;
      return _exhaustive;
    })
    .join("");
}

/**
 * Convert LaTeX source into cleaned editor text. The inverse of
 * {@link textToLatex}. Applied to a paragraph the parser has already judged to
 * be "simple prose".
 */
export function cleanToText(latex: string): string {
  let out = latex;

  // 1. Unwrap \emph -> _x_ and \textbf -> **x**, innermost first. Repeat until
  //    stable so a nested `\textbf{\emph{x}}` (and the reverse) fully unwraps.
  let prev: string;
  do {
    prev = out;
    out = out.replace(/\\emph\{([^{}]*)\}/g, (_m, inner: string) => `_${inner}_`);
    out = out.replace(/\\textbf\{([^{}]*)\}/g, (_m, inner: string) => `**${inner}**`);
  } while (out !== prev);

  // 2. Quotes. Doubles first (``…''), then singles (`…').
  out = out.replace(/``(.*?)''/gs, (_m, inner: string) => `"${inner}"`);
  out = out.replace(/`(.*?)'/gs, (_m, inner: string) => `'${inner}'`);

  // 3. Dashes — em before en so `---` is consumed as one token.
  out = out.replace(/---/g, "—").replace(/--/g, "–");

  // 4. Unescape LaTeX specials.
  out = unescapeSpecials(out);

  return out;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function escapeSpecials(s: string): string {
  let out = s;
  for (const [plain, escaped] of LATEX_ESCAPES) {
    out = out.split(plain).join(escaped);
  }
  return out;
}

function unescapeSpecials(s: string): string {
  let out = s;
  // Reverse order is irrelevant (escaped forms are distinct), but unescape the
  // backslash-prefixed forms directly.
  for (const [plain, escaped] of LATEX_ESCAPES) {
    out = out.split(escaped).join(plain);
  }
  return out;
}

/** `"abc"` -> ` ``abc'' `, pairing opening/closing straight double quotes. */
function doubleStraightToTeX(s: string): string {
  let open = true;
  return s.replace(/"/g, () => {
    const tok = open ? "``" : "''";
    open = !open;
    return tok;
  });
}

/**
 * `'abc'` -> `` `abc' ``. A straight single quote is ambiguous (apostrophe vs.
 * quote). We only convert *paired* singles that look like quotation — an opening
 * single quote is one preceded by a boundary (start/space/open-bracket) and a
 * closing single is its mate. Apostrophes inside words (don't, it's) are left
 * untouched, and an `'` is the natural TeX closing-single glyph anyway, so a
 * stray apostrophe still round-trips.
 */
function singleStraightToTeX(s: string): string {
  return s.replace(
    /(^|[\s([{<])'([^']*)'/g,
    (_m, lead: string, inner: string) => `${lead}\`${inner}'`,
  );
}
