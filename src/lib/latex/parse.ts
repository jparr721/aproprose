// parse.ts — split a chapter's LaTeX source into display blocks.
//
// THE PRIME DIRECTIVE is fidelity, not cleverness. Every block records `raw`:
// the exact source substring it came from, *including its trailing blank-line
// separator*. Concatenating every block's `raw` reproduces the input
// byte-for-byte, so an unedited save is a guaranteed no-op (see serialize.ts).
//
// Classification only drives how a block is *displayed* and edited; it can never
// lose data, because `raw` is the source of truth for clean blocks. We therefore
// classify CONSERVATIVELY: anything we are not certain is simple prose (or one of
// the few other shapes we understand) falls back to `latex` and is edited
// verbatim.

import type { Block, BlockType, ChapterLevel } from "@/lib/types";
import { uid } from "@/lib/id";
import { cleanToText } from "./inline";

/**
 * Parse a chapter body into an ordered list of blocks.
 *
 * Guarantee: `blocks.map(b => b.raw).join("") === source` exactly.
 */
export function parseChapter(source: string): Block[] {
  const segments = splitSegments(source);
  return segments.map((seg) => classify(seg.content, seg.raw));
}

// ── segmentation ────────────────────────────────────────────────────────────

interface Segment {
  /** The paragraph content, with no trailing separator. */
  content: string;
  /** content + the blank-line/EOF separator that followed it. */
  raw: string;
}

/**
 * Cut the source into (content, raw) segments. A segment boundary is a blank
 * line: a run of one newline followed by one or more lines that are empty or
 * whitespace-only. The boundary run is appended to the *preceding* segment's
 * `raw` so concatenation is lossless.
 *
 * A standalone `\begin{env}…\end{env}` paragraph is left as a single segment by
 * this pass (it has no internal blank lines in the real manuscripts); the
 * environment-as-its-own-block requirement is satisfied because such a paragraph
 * is already isolated by the blank lines around it.
 */
function splitSegments(source: string): Segment[] {
  if (source.length === 0) return [];

  const segments: Segment[] = [];
  // A separator is: a newline, then zero+ whitespace-only lines, consuming the
  // trailing newline of each blank line. We match content greedily up to (but
  // not including) the newline that begins such a separator.
  //
  // Walk manually so we keep full control of byte offsets.
  let i = 0;
  const n = source.length;
  let contentStart = 0;

  while (i < n) {
    if (source[i] === "\n") {
      // Look ahead: is the *next* line blank (whitespace then newline) or EOF?
      const sep = matchSeparator(source, i);
      if (sep !== null) {
        // Everything from contentStart up to (not incl.) this newline is content;
        // the newline + the blank run is the separator, all part of `raw`.
        const content = source.slice(contentStart, i);
        const raw = source.slice(contentStart, sep);
        segments.push({ content, raw });
        contentStart = sep;
        i = sep;
        continue;
      }
    }
    i++;
  }

  // Trailing chunk (no blank-line separator before EOF). It may end with a
  // single newline, which belongs to its `raw`.
  if (contentStart < n) {
    const rest = source.slice(contentStart);
    const content = rest.endsWith("\n") ? rest.slice(0, -1) : rest;
    segments.push({ content, raw: rest });
  }

  return segments;
}

/**
 * Given that `source[at] === "\n"`, decide whether a paragraph separator starts
 * here. A separator requires at least one *blank* line after the current line,
 * i.e. the newline at `at` plus one or more whitespace-only lines. Returns the
 * index just past the whole separator run (where the next paragraph begins), or
 * null if this newline is just an in-paragraph line break.
 */
function matchSeparator(source: string, at: number): number | null {
  const n = source.length;
  // `at` is the newline ending the current content line. Scan the following
  // lines; each whitespace-only line (ending in \n) extends the separator.
  let j = at + 1;
  let sawBlank = false;
  while (j < n) {
    // Measure one line starting at j.
    let k = j;
    while (k < n && source[k] !== "\n") k++;
    const line = source.slice(j, k);
    const isBlank = line.trim() === "";
    if (isBlank && k < n) {
      // Whitespace-only line terminated by a newline -> part of the separator.
      sawBlank = true;
      j = k + 1;
      continue;
    }
    if (isBlank && k === n) {
      // Trailing whitespace-only line with no closing newline (rare). Treat the
      // remainder as separator so nothing is lost.
      sawBlank = true;
      j = k;
      break;
    }
    // Non-blank line — separator ends before it.
    break;
  }
  // Also treat "newline immediately at EOF" as a separator end (the lone
  // trailing newline case is handled by the trailing-chunk logic instead).
  return sawBlank ? j : null;
}

// ── classification ────────────────────────────────────────────────────────────

const RE_CENTER = /^\\begin\{center\}([\s\S]*?)\\end\{center\}$/;
const RE_TEXTBF = /^\\textbf\{([\s\S]*)\}$/;
// A lore comment: `% @lore[Optional Title]: body` on a single line.
const RE_LORE = /^%\s*@lore(?:\[([^\]]*)\])?:\s?([\s\S]*)$/;
// A scratchpad comment: `% @scratch: body`.
const RE_SCRATCH = /^%\s*@scratch:\s?([\s\S]*)$/;
// A backslash macro that is NOT \emph — its presence disqualifies simple prose.
// (\emph is the one inline macro prose is allowed to carry.)
const RE_NON_EMPH_MACRO = /\\(?!emph\b)[a-zA-Z@]+/;

function classify(content: string, raw: string): Block {
  const trimmed = content.trim();

  // 1. Centered environments → chapter scene / break.
  const center = RE_CENTER.exec(trimmed);
  if (center) {
    const inner = center[1].trim();
    return chapterBlock(inner, raw);
  }

  // 2. Non-rendering comment markers (lore / scratchpad). Single comment line.
  if (isSingleLine(trimmed)) {
    const lore = RE_LORE.exec(trimmed);
    if (lore) {
      return base("lore", lore[2], raw, {
        title: lore[1] ? lore[1].trim() : undefined,
      });
    }
    const scratch = RE_SCRATCH.exec(trimmed);
    if (scratch) {
      return base("scratchpad", scratch[1], raw);
    }
  }

  // 3. Dialogue: a paragraph that is entirely one ``…'' utterance, optionally
  //    followed by a short trailing sentence (an action beat).
  const dialogue = tryDialogue(trimmed, raw);
  if (dialogue) return dialogue;

  // 4. Simple prose narration: only \emph macros, no other LaTeX, no comments.
  if (isSimpleProse(content)) {
    return base("narration", cleanToText(content), raw);
  }

  // 5. Everything else is opaque LaTeX, edited verbatim. Never lose data.
  return base("latex", content, raw);
}

function chapterBlock(inner: string, raw: string): Block {
  // A `* * *` (any spacing / star count, asterisks only) is a scene break.
  if (/^[*\s]+$/.test(inner) && /\*/.test(inner)) {
    return base("chapter", "∗ ∗ ∗", raw, { level: "break" });
  }
  // \textbf{X} → scene label X (cleaned). Plain short text also a scene label.
  const bf = RE_TEXTBF.exec(inner);
  const labelSrc = bf ? bf[1] : inner;
  // The label may itself contain only \emph; clean it for display. If it carries
  // other macros, fall back to the raw inner so we never mangle it.
  const label = isSimpleProse(labelSrc) ? cleanToText(labelSrc) : labelSrc;
  return base("chapter", label, raw, { level: "scene" });
}

/**
 * Recognise a dialogue paragraph: it must *start* with a ``…'' quote. If the
 * whole paragraph is the quote, `beat` is empty. If a short trailing sentence
 * follows the closing '', that becomes the beat. We only accept it as dialogue
 * when both the quote body and the beat are themselves simple prose (so the
 * round-trip through cleanToText/textToLatex is exact); otherwise we let it fall
 * through to `latex`.
 */
function tryDialogue(trimmed: string, raw: string): Block | null {
  if (!trimmed.startsWith("``")) return null;

  // Find the matching closing '' for the opening ``.
  const close = trimmed.indexOf("''", 2);
  if (close === -1) return null;

  const quoteBody = trimmed.slice(2, close);
  const after = trimmed.slice(close + 2).trim();

  // The quote body must not contain a *second* opening quote or a closing ''
  // (we already took the first ''), and must be simple prose.
  if (quoteBody.includes("``") || quoteBody.includes("''")) return null;
  if (!isSimpleProse(quoteBody)) return null;

  // Trailing beat (if any) must also be simple prose with no further quotes.
  if (after.length > 0) {
    if (after.includes("``") || after.includes("''")) return null;
    if (!isSimpleProse(after)) return null;
  }

  return base("dialogue", cleanToText(quoteBody), raw, {
    beat: after.length > 0 ? cleanToText(after) : undefined,
  });
}

/**
 * "Simple prose" = no LaTeX we don't understand. Concretely: no non-\emph
 * backslash macros, no braces outside a balanced `\emph{…}`, no comment `%`
 * (unescaped), no environments. \emph{…}, escaped specials (\&, \%, …), the TeX
 * dash ligatures and quote glyphs are all fine.
 */
export function isSimpleProse(content: string): boolean {
  // Strip the recognised \emph{…} spans, then check what remains.
  const stripped = content.replace(/\\emph\{[^{}]*\}/g, "");

  // Any remaining backslash that isn't a recognised escaped special is a macro.
  if (/\\(?![&%$#_])/.test(stripped)) return false;
  // Any remaining unescaped specials (braces, %, &, $, #, _) disqualify it: they
  // would not survive the clean/serialize round-trip unambiguously.
  if (/(?<!\\)[{}]/.test(stripped)) return false;
  if (/(?<!\\)%/.test(stripped)) return false;
  // A non-\emph macro anywhere (defensive — caught above too).
  if (RE_NON_EMPH_MACRO.test(stripped)) return false;

  return true;
}

function isSingleLine(s: string): boolean {
  return !s.includes("\n");
}

function base(
  type: BlockType,
  text: string,
  raw: string,
  extra: { beat?: string; title?: string; level?: ChapterLevel } = {},
): Block {
  return {
    id: uid(),
    type,
    text,
    raw,
    dirty: false,
    ...extra,
  };
}
