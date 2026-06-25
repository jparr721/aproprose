// markup.ts - parse cleaned editor text into an inline node tree.
//
// The editor stores emphasis as `_italics_` and bold as `**bold**`. This is the
// single parser for that vocabulary; the LaTeX emitter (inline.ts) and the React
// renderer (inline.tsx) each walk the tree. A marker pair is only recognised when
// it has a non-empty body and a matching closer; anything else is literal text,
// so stray markers round-trip unchanged.

export type InlineNode =
  | { kind: "text"; value: string }
  | { kind: "bold"; children: InlineNode[] }
  | { kind: "italic"; children: InlineNode[] };

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
    if (text.startsWith("**", i)) {
      const close = text.indexOf("**", i + 2);
      if (close > i + 2) {
        flush();
        nodes.push({ kind: "bold", children: parseInline(text.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    } else if (text[i] === "_") {
      const close = text.indexOf("_", i + 1);
      if (close > i + 1) {
        flush();
        nodes.push({ kind: "italic", children: parseInline(text.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  flush();
  return nodes;
}
