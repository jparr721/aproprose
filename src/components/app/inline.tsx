// inline.tsx - render the editor's `**bold**` / `_italic_` markers as
// <strong>/<em> for display. The shared parser (latex/markup) owns the grammar;
// this is the React-side emitter. (The LaTeX layer maps the same tree to
// \textbf{x}/\emph{x}.)

import { Fragment, type ReactNode } from "react";
import {
  parseInline,
  parseInlineSpans,
  assertNever,
  type InlineNode,
  type InlineSpan,
} from "@/lib/latex/markup";

// Shared <mark> styling for the active find match, reused by the plain-text
// surfaces in block.tsx so the highlight reads identically everywhere. The
// scroll margins keep a nearest-scrolled match clear of the viewport edges and
// the floating find bar (find-store scrolls the mark itself).
export const FIND_MARK_CLASS =
  "rounded-[2px] bg-warning/30 text-foreground scroll-mt-16 scroll-mb-10";

function nodesToReact(nodes: InlineNode[]): ReactNode {
  return nodes.map((n, i) => {
    if (n.kind === "text") return <Fragment key={i}>{n.value}</Fragment>;
    if (n.kind === "bold") return <strong key={i}>{nodesToReact(n.children)}</strong>;
    if (n.kind === "italic") return <em key={i}>{nodesToReact(n.children)}</em>;
    return assertNever(n);
  });
}

export function renderInline(text: string): ReactNode {
  return nodesToReact(parseInline(text));
}

// Wrap the part of a text node that falls inside the match range. The node's
// rendered characters map 1:1 to source offsets `[node.start, node.end)` (text
// runs never contain markers), so the match range clamps straight onto `value`.
function highlightTextNode(
  node: Extract<InlineSpan, { kind: "text" }>,
  start: number,
  end: number,
  key: number,
): ReactNode {
  const from = Math.max(0, start - node.start);
  const to = Math.min(node.value.length, end - node.start);
  if (from >= to) return <Fragment key={key}>{node.value}</Fragment>;
  return (
    <Fragment key={key}>
      {node.value.slice(0, from)}
      <mark className={FIND_MARK_CLASS}>{node.value.slice(from, to)}</mark>
      {node.value.slice(to)}
    </Fragment>
  );
}

function spansToReact(nodes: InlineSpan[], start: number, end: number): ReactNode {
  return nodes.map((n, i) => {
    if (n.kind === "text") return highlightTextNode(n, start, end, i);
    if (n.kind === "bold") return <strong key={i}>{spansToReact(n.children, start, end)}</strong>;
    if (n.kind === "italic") return <em key={i}>{spansToReact(n.children, start, end)}</em>;
    return assertNever(n);
  });
}

// Render inline markup with the source range `[start, end)` highlighted. Because
// it highlights at the parsed-node layer, a match overlapping a **bold**/_italic_
// span no longer splits the markers across separately-parsed slices.
export function renderInlineHighlighted(text: string, start: number, end: number): ReactNode {
  return spansToReact(parseInlineSpans(text), start, end);
}
