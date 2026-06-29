// markup.ts - parse cleaned editor text into an inline node tree.
//
// The editor stores emphasis as `_italics_` and bold as `**bold**`. This is the
// single parser for that vocabulary; the LaTeX emitter (inline.ts) and the React
// renderer (inline.tsx) each walk the tree. A marker pair is only recognised when
// it has a non-empty body and a matching closer; anything else is literal text,
// so stray markers round-trip unchanged.

// The two inline emphasis markers, shared by this parser and the toggle helper
// (blocks/format) so the recognised vocabulary has a single source of truth.
export const BOLD_MARKER = "**";
export const ITALIC_MARKER = "_";
export type InlineMarker = typeof BOLD_MARKER | typeof ITALIC_MARKER;

export type InlineNode =
  | { kind: "text"; value: string }
  | { kind: "bold"; children: InlineNode[] }
  | { kind: "italic"; children: InlineNode[] };

// The span-annotated tree: the same grammar as InlineNode, plus the absolute
// half-open `[start, end)` range each node occupies in the ORIGINAL text (markers
// included). Callers that must map a source offset onto rendered output - find
// highlighting wraps the matched range in <mark> - walk this; parseInline strips
// the spans for everyone who only needs the shape.
export type InlineSpan =
  | { kind: "text"; value: string; start: number; end: number }
  | { kind: "bold"; children: InlineSpan[]; start: number; end: number }
  | { kind: "italic"; children: InlineSpan[]; start: number; end: number };

// Exhaustiveness guard for the closed InlineNode/InlineSpan unions: every emitter
// (inline.ts, inline.tsx) ends its switch here, so adding a node kind without a
// matching branch is a compile error rather than a silent fall-through.
export function assertNever(node: never): never {
  throw new Error(`Unhandled inline node: ${JSON.stringify(node)}`);
}

// The grammar lives here once, offset-aware; `base` is the absolute position of
// `text` within the original string so recursive (nested-marker) calls stay in
// original coordinates.
function parseSpansFrom(text: string, base: number): InlineSpan[] {
  const nodes: InlineSpan[] = [];
  let i = 0;
  let buf = "";
  let bufStart = 0;
  const flush = (): void => {
    if (buf.length > 0) {
      nodes.push({ kind: "text", value: buf, start: base + bufStart, end: base + i });
      buf = "";
    }
  };
  while (i < text.length) {
    if (text.startsWith(BOLD_MARKER, i)) {
      const close = text.indexOf(BOLD_MARKER, i + BOLD_MARKER.length);
      if (close > i + BOLD_MARKER.length) {
        flush();
        nodes.push({
          kind: "bold",
          children: parseSpansFrom(text.slice(i + BOLD_MARKER.length, close), base + i + BOLD_MARKER.length),
          start: base + i,
          end: base + close + BOLD_MARKER.length,
        });
        i = close + BOLD_MARKER.length;
        continue;
      }
    } else if (text.startsWith(ITALIC_MARKER, i)) {
      const close = text.indexOf(ITALIC_MARKER, i + ITALIC_MARKER.length);
      if (close > i + ITALIC_MARKER.length) {
        flush();
        nodes.push({
          kind: "italic",
          children: parseSpansFrom(text.slice(i + ITALIC_MARKER.length, close), base + i + ITALIC_MARKER.length),
          start: base + i,
          end: base + close + ITALIC_MARKER.length,
        });
        i = close + ITALIC_MARKER.length;
        continue;
      }
    }
    if (buf.length === 0) bufStart = i;
    buf += text[i];
    i++;
  }
  flush();
  return nodes;
}

export function parseInlineSpans(text: string): InlineSpan[] {
  return parseSpansFrom(text, 0);
}

function stripSpan(node: InlineSpan): InlineNode {
  switch (node.kind) {
    case "text":
      return { kind: "text", value: node.value };
    case "bold":
      return { kind: "bold", children: node.children.map(stripSpan) };
    case "italic":
      return { kind: "italic", children: node.children.map(stripSpan) };
    default:
      return assertNever(node);
  }
}

export function parseInline(text: string): InlineNode[] {
  return parseInlineSpans(text).map(stripSpan);
}
