// inline.tsx — render the editor's `_italic_` markers as <em> for display.
// (The LaTeX layer maps \emph{…} <-> _…_; this is the React-side renderer.)

import { Fragment, type ReactNode } from "react";

export function renderInline(text: string): ReactNode {
  return text.split(/(_[^_]+_)/g).map((part, i) =>
    part.length > 2 && part.startsWith("_") && part.endsWith("_") ? (
      <em key={i}>{part.slice(1, -1)}</em>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
