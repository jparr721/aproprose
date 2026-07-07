// dialogue.ts - pure helpers over a chained dialogue block's segments.
//
// A dialogue block's opening quote is `block.text`; `block.tail` holds the
// ordered segments after it, alternating beat/quote (strict alternation,
// quote-first). These helpers are the single source of truth for reading that
// structure, so the editor, serializer, and split logic never re-derive it.

import type { Block, DialogueSegment, DialogueSegmentKind } from "@/lib/types";

/** Every segment in order: the opening quote (`text`) followed by the tail. */
export function dialogueSegments(block: Block): DialogueSegment[] {
  const head: DialogueSegment = { kind: "quote", text: block.text };
  return block.tail ? [head, ...block.tail] : [head];
}

/** The kind the next appended segment must be. Strict alternation: a quote is
 *  followed by a beat, a beat by a quote. With no tail the last kind is the
 *  opening quote, so the next is a beat. */
export function nextSegmentKind(block: Block): DialogueSegmentKind {
  const tail = block.tail ?? [];
  const lastKind = tail.length > 0 ? tail[tail.length - 1].kind : "quote";
  return lastKind === "quote" ? "beat" : "quote";
}

/** True when a tail segment carries non-blank text a merge/delete would drop.
 *  A freshly-appended (still empty) segment drops nothing, so it does not count. */
export function carriesTailContent(block: Block): boolean {
  return (block.tail ?? []).some((s) => s.text.trim().length > 0);
}
