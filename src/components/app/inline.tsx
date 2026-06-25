// inline.tsx - render the editor's `**bold**` / `_italic_` markers as
// <strong>/<em> for display. The shared parser (latex/markup) owns the grammar;
// this is the React-side emitter. (The LaTeX layer maps the same tree to
// \textbf{x}/\emph{x}.)

import { Fragment, type ReactNode } from "react";
import { parseInline, assertNever, type InlineNode } from "@/lib/latex/markup";

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
