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

// Exhaustiveness guard for the closed InlineNode union: every emitter (inline.ts,
// inline.tsx) ends its switch here, so adding a node kind without a matching
// branch is a compile error rather than a silent fall-through.
export function assertNever(node: never): never {
  throw new Error(`Unhandled inline node: ${JSON.stringify(node)}`);
}

export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let i = 0;
  let buf = "";
  const flush = (): void => {
    if (buf.length > 0) {
      nodes.push({ kind: "text", value: buf });
      buf = "";
    }
  };
  while (i < text.length) {
    if (text.startsWith(BOLD_MARKER, i)) {
      const close = text.indexOf(BOLD_MARKER, i + BOLD_MARKER.length);
      if (close > i + BOLD_MARKER.length) {
        flush();
        nodes.push({ kind: "bold", children: parseInline(text.slice(i + BOLD_MARKER.length, close)) });
        i = close + BOLD_MARKER.length;
        continue;
      }
    } else if (text.startsWith(ITALIC_MARKER, i)) {
      const close = text.indexOf(ITALIC_MARKER, i + ITALIC_MARKER.length);
      if (close > i + ITALIC_MARKER.length) {
        flush();
        nodes.push({ kind: "italic", children: parseInline(text.slice(i + ITALIC_MARKER.length, close)) });
        i = close + ITALIC_MARKER.length;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  flush();
  return nodes;
}
