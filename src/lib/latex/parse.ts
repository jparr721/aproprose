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

import type { Block, BlockType, ChapterLevel, DialogueSegment } from "@/lib/types";
import { uid } from "@/lib/id";
import { cleanToText, latexToPlain } from "./inline";

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
// A lore comment: `% @lore[Optional Title]: body` on a single line.
const RE_LORE = /^%\s*@lore(?:\[([^\]]*)\])?:\s?([\s\S]*)$/;
// A scratchpad comment: `% @scratch: body`.
const RE_SCRATCH = /^%\s*@scratch:\s?([\s\S]*)$/;
// A speaker tag: `% @speaker: <id>` on its own line, immediately above the
// dialogue it labels (see serialize.ts). The id references a Character.
const RE_SPEAKER = /^\s*%\s*@speaker:\s?(\S+)\s*\n([\s\S]*)$/;
// A backslash macro that is NOT \emph or \textbf - its presence disqualifies
// simple prose. (\emph and \textbf are the inline macros prose is allowed to carry.)
const RE_NON_EMPH_MACRO = /\\(?!emph\b)(?!textbf\b)[a-zA-Z@]+/;

function classify(content: string, raw: string): Block {
  // A leading `% @speaker: <id>` line tags the dialogue beneath it. Honor it only
  // when the remainder really is dialogue, so a stray comment is never dropped
  // (fidelity over cleverness — the full segment still lives in `raw`).
  const sp = RE_SPEAKER.exec(content);
  if (sp) {
    const dialogue = tryDialogue(sp[2].trim(), raw);
    if (dialogue) {
      dialogue.speaker = sp[1];
      return dialogue;
    }
  }

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

  // 3. Dialogue: a paragraph that opens with ``…'' followed by alternating
  //    beat-runs and further ``…'' quotes.
  const dialogue = tryDialogue(trimmed, raw);
  if (dialogue) return dialogue;

  // 4. Simple prose narration: only \emph and \textbf macros, no other LaTeX, no
  //    comments. A paragraph that opens like dialogue (``) but was rejected by
  //    tryDialogue (broken alternation) must not be silently reinterpreted as
  //    narration containing literal quote marks - it stays opaque `latex`.
  if (!trimmed.startsWith("``") && isSimpleProse(content)) {
    return base("narration", cleanToText(content), raw);
  }

  // 5. Everything else is opaque LaTeX, edited verbatim. Never lose data.
  return base("latex", content, raw);
}

function chapterBlock(inner: string, raw: string): Block {
  // A centered line that is exactly ONE whole-line \textbf is a scene heading
  // (bold, Lora). The serializer only ever produces that form for scenes; break
  // text is plain, so this is the sole discriminator and a break can never flip.
  const labelSrc = sceneLabel(inner);
  if (labelSrc !== null) {
    // Plain inverse of plainToLatex: chapter labels are literal, so a hand-authored
    // \emph/\textbf inside the heading survives a round-trip unchanged.
    const label = isSimpleProse(labelSrc) ? latexToPlain(labelSrc) : labelSrc;
    return base("chapter", label, raw, { level: "scene" });
  }
  // Any other centered content is a freeform break / separator: `* * *`, a
  // fleuron, `Interlude`, etc. Cleaned for editing when it is simple prose.
  const text = isSimpleProse(inner) ? latexToPlain(inner) : inner;
  return base("chapter", text, raw, { level: "break" });
}

/**
 * If `inner` is exactly one `\textbf{...}` wrapping the entire centered body
 * (balanced braces, the matching close at the very end), return the wrapped label;
 * otherwise null. Two adjacent `\textbf` spans, or `\textbf` with surrounding text,
 * are NOT a scene - so a break whose text merely contains bold stays a break.
 */
function sceneLabel(inner: string): string | null {
  const open = "\\textbf{";
  if (!inner.startsWith(open) || !inner.endsWith("}")) return null;
  let depth = 0;
  for (let i = open.length - 1; i < inner.length; i++) {
    if (inner[i] === "{") depth++;
    else if (inner[i] === "}") {
      depth--;
      if (depth === 0) {
        return i === inner.length - 1 ? inner.slice(open.length, inner.length - 1) : null;
      }
    }
  }
  return null;
}

/**
 * Recognise a dialogue paragraph: it must *start* with a ``…'' quote, followed
 * by zero or more alternating beat-runs and further ``…'' quotes (an action
 * beat interrupting a chain of utterances). The grammar is strict alternation,
 * quote-first: a quote may only follow a beat, so adjacent quotes (or a quote
 * with no preceding beat) disqualify the whole paragraph. We only accept a
 * segment as dialogue when its text is itself simple prose (so the round-trip
 * through cleanToText/textToLatex is exact); otherwise we let the whole
 * paragraph fall through to `latex`.
 */
function tryDialogue(trimmed: string, raw: string): Block | null {
  if (!trimmed.startsWith("``")) return null;

  const firstClose = trimmed.indexOf("''", 2);
  if (firstClose === -1) return null;

  const head = trimmed.slice(2, firstClose);
  if (head.includes("``") || head.includes("''") || !isSimpleProse(head)) return null;

  // Walk the remainder as alternating beat-runs and ``...'' quotes. Strict
  // alternation: a quote may only follow a beat, so adjacent quotes (or a quote
  // with no preceding beat) disqualify the whole paragraph -> it falls to latex.
  const tail: DialogueSegment[] = [];
  let rest = trimmed.slice(firstClose + 2);
  while (rest.length > 0) {
    const nextOpen = rest.indexOf("``");
    const beatSrc = (nextOpen === -1 ? rest : rest.slice(0, nextOpen)).trim();
    if (beatSrc.length > 0) {
      if (beatSrc.includes("''") || !isSimpleProse(beatSrc)) return null;
      tail.push({ kind: "beat", text: cleanToText(beatSrc) });
    }
    if (nextOpen === -1) break;
    const close = rest.indexOf("''", nextOpen + 2);
    if (close === -1) return null;
    const quoteSrc = rest.slice(nextOpen + 2, close);
    if (quoteSrc.includes("``") || quoteSrc.includes("''") || !isSimpleProse(quoteSrc)) return null;
    if (tail.length === 0 || tail[tail.length - 1].kind !== "beat") return null;
    tail.push({ kind: "quote", text: cleanToText(quoteSrc) });
    rest = rest.slice(close + 2);
  }

  return base("dialogue", cleanToText(head), raw, {
    tail: tail.length > 0 ? tail : undefined,
  });
}

export function isSimpleProse(content: string): boolean {
  // Strip the recognised \emph{x} and \textbf{x} spans, innermost first, then
  // check what remains. Repeat until stable so nested macros fully strip.
  let stripped = content;
  let prev: string;
  do {
    prev = stripped;
    stripped = stripped
      .replace(/\\emph\{[^{}]*\}/g, "")
      .replace(/\\textbf\{[^{}]*\}/g, "");
  } while (stripped !== prev);

  // Any remaining backslash that isn't a recognised escaped special is a macro.
  if (/\\(?![&%$#_])/.test(stripped)) return false;
  // Any remaining unescaped specials (braces, %, &, $, #, _) disqualify it.
  if (/(?<!\\)[{}]/.test(stripped)) return false;
  if (/(?<!\\)%/.test(stripped)) return false;
  // A non-\emph/\textbf macro anywhere (defensive - caught above too).
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
  extra: { tail?: DialogueSegment[]; title?: string; level?: ChapterLevel } = {},
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
