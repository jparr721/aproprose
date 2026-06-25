// inline.ts — fully reversible conversion between inline LaTeX and the cleaned
// "prose" text the editor shows.
//
// The editor never displays raw LaTeX for simple prose: emphasis becomes
// `_italics_`, bold becomes `**bold**`, TeX quotes become straight `"` / `'`, and
// the dash ligatures become real Unicode dashes. The two functions here are exact
// inverses for the constructs we recognise, so a no-op edit of a narration/dialogue
// block still round-trips byte-for-byte (the serializer reverses the cleaning
// before diffing against the original `raw`).
//
// Anything *not* covered here is the parser's signal that a paragraph is not
// "simple prose" - those paragraphs are classified as `latex` and edited
// verbatim, never run through these helpers. So we only need to handle the small
// closed vocabulary that simple prose is allowed to contain.

import { parseInline, assertNever, type InlineNode } from "./markup";

// ── LaTeX special characters ────────────────────────────────────────────────
// The six characters TeX treats specially in normal text and that a writer might
// type literally. `\` and `{`/`}` are deliberately excluded: a backslash in a
// "simple" paragraph means a macro (which disqualifies it from prose), and the
// parser refuses braces outside of the `\emph{x}` and `\textbf{x}` we explicitly
// unwrap. We keep the set minimal so the inverse is unambiguous.
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
 * The inline tree is built first (so `_` and `**` markers become \emph / \textbf
 * with specials escaped on the text leaves), then the dash ligatures and straight
 * quotes are mapped to their TeX forms.
 */
export function textToLatex(text: string): string {
  return applyTypography(nodesToLatex(parseInline(text)));
}

/**
 * Convert plain (non-prose) text into LaTeX. Used for `chapter` scene/break text,
 * which is a centered label/separator, NOT prose: `**`/`_` stay literal here, so
 * a break can never serialize to a `\textbf` span that the parser would misread as
 * a scene heading. Escapes specials, then maps dashes/quotes - the inverse of
 * {@link cleanToText} for text with no emphasis macros.
 */
export function plainToLatex(text: string): string {
  return applyTypography(escapeSpecials(text));
}

/** Map dash ligatures and straight quotes to their TeX forms. Shared tail of the
 *  prose and plain converters. */
function applyTypography(latex: string): string {
  let out = latex.replace(/—/g, "---").replace(/–/g, "--");
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
      return assertNever(n);
    })
    .join("");
}

/**
 * Convert LaTeX source into cleaned editor text. The inverse of
 * {@link textToLatex}. Applied to a paragraph the parser has already judged to
 * be "simple prose" (narration / dialogue).
 */
export function cleanToText(latex: string): string {
  // 1. Unwrap \emph -> _x_ and \textbf -> **x**, innermost first. Repeat until
  //    stable so a nested `\textbf{\emph{x}}` (and the reverse) fully unwraps.
  let out = latex;
  let prev: string;
  do {
    prev = out;
    out = out.replace(/\\emph\{([^{}]*)\}/g, (_m, inner: string) => `_${inner}_`);
    out = out.replace(/\\textbf\{([^{}]*)\}/g, (_m, inner: string) => `**${inner}**`);
  } while (out !== prev);

  // 2. Quotes, dashes, and specials - shared with the plain (non-prose) inverse.
  return latexToPlain(out);
}

/**
 * Convert plain LaTeX back to editor text: the inverse of {@link plainToLatex},
 * used for `chapter` scene/break labels. TeX quotes and dash ligatures map back
 * and specials unescape, but \emph / \textbf are deliberately NOT unwrapped -
 * chapter text is literal, so any macro a writer hand-authored in a heading
 * round-trips byte-exact rather than being reinterpreted as markdown (which
 * plainToLatex would then escape away, losing it on the next edit).
 */
export function latexToPlain(latex: string): string {
  // Quotes. Doubles first (``x''), then singles (`x').
  let out = latex.replace(/``(.*?)''/gs, (_m, inner: string) => `"${inner}"`);
  out = out.replace(/`(.*?)'/gs, (_m, inner: string) => `'${inner}'`);
  // Dashes - em before en so `---` is consumed as one token.
  out = out.replace(/---/g, "—").replace(/--/g, "–");
  return unescapeSpecials(out);
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
