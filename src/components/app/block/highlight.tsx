// highlight.tsx -- render block prose with the active find match wrapped in a <mark>.

import type { ReactNode } from "react";
import { renderInline, renderInlineHighlighted, FIND_MARK_CLASS } from "@/components/app/inline";

/** The active find match within a block's `text`, or null. */
export type FindHit = { start: number; end: number } | null;

/** Highlight at the inline-node layer (see renderInlineHighlighted) so a match
 *  overlapping a bold or italic span keeps its formatting instead of splitting
 *  the markers. */
export function highlightInline(text: string, hit: FindHit): ReactNode {
  return hit ? renderInlineHighlighted(text, hit.start, hit.end) : renderInline(text);
}

/** Same, for plain-text surfaces (scene labels, raw LaTeX) that skip inline markup,
 *  so plain slicing is exact. */
export function highlightPlain(text: string, hit: FindHit): ReactNode {
  if (!hit) return text;
  return (
    <>
      {text.slice(0, hit.start)}
      <mark className={FIND_MARK_CLASS}>{text.slice(hit.start, hit.end)}</mark>
      {text.slice(hit.end)}
    </>
  );
}
