// format.ts - toggle an inline marker (`**` bold, `_` italic) around a textarea
// selection. Pure: returns the new text plus the selection to restore. Toggling
// off recognises markers both inside the selection and immediately outside it.

import { clamp } from "es-toolkit";
import { type InlineMarker } from "@/lib/latex/markup";

export type { InlineMarker };

/** A textarea's value plus a [start, end) selection into it. Both the input the
 *  toggle reads and the result it returns, so call sites never transpose offsets. */
export interface TextSelection {
  text: string;
  start: number;
  end: number;
}

export function toggleInlineWrap(sel: TextSelection, marker: InlineMarker): TextSelection {
  const len = marker.length;
  const { text } = sel;
  // Clamp to valid bounds so the returned selection is always in range, whatever
  // a stale caller passes; `start <= end <= text.length`.
  const start = clamp(sel.start, 0, text.length);
  const end = clamp(sel.end, start, text.length);

  // Empty selection: drop an empty pair, caret between the markers.
  if (start === end) {
    const next = text.slice(0, start) + marker + marker + text.slice(start);
    const caret = start + len;
    return { text: next, start: caret, end: caret };
  }

  const selected = text.slice(start, end);

  // Already wrapped, markers inside the selection -> strip them.
  if (
    selected.length >= 2 * len &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(len, selected.length - len);
    return {
      text: text.slice(0, start) + inner + text.slice(end),
      start,
      end: start + inner.length,
    };
  }

  // Already wrapped, markers just outside the selection -> strip them.
  if (start >= len && text.slice(start - len, start) === marker && text.slice(end, end + len) === marker) {
    return {
      text: text.slice(0, start - len) + selected + text.slice(end + len),
      start: start - len,
      end: end - len,
    };
  }

  // Not wrapped -> wrap, keep the inner text selected.
  return {
    text: text.slice(0, start) + marker + selected + marker + text.slice(end),
    start: start + len,
    end: end + len,
  };
}
