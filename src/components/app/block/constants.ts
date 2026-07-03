// constants.ts -- shared block presentation tokens (labels, swatches, per-type
// body classes).
//
// The body classes are shared VERBATIM between a type's read view and its edit
// surface (block-body.tsx), so entering or leaving edit mode can never change a
// block's geometry — layout parity is what keeps the viewport still across the
// prose/textarea swap.

import type { BlockType } from "@/lib/types";

export const TYPE_LABELS: Record<BlockType, string> = {
  chapter: "Chapter",
  narration: "Narration",
  dialogue: "Dialogue",
  lore: "Lore note",
  scratchpad: "Scratchpad",
  latex: "Raw LaTeX",
};

export const TYPE_SWATCH: Record<BlockType, string> = {
  chapter: "bg-accent-ink",
  narration: "bg-muted-foreground",
  dialogue: "bg-foreground",
  lore: "bg-lore-ink",
  scratchpad: "bg-scratch-ink",
  latex: "bg-muted-foreground",
};

export const PROSE = "font-serif text-[length:var(--prose-size,17.5px)] leading-[1.65] text-foreground";

export const SCENE_HEADING = "my-2 text-center font-serif text-2xl font-medium tracking-wide text-foreground";

export const SCENE_BREAK = "py-4 text-center font-serif tracking-[0.3em] text-muted-foreground";

export const DIALOGUE_BEAT = "font-serif text-[length:calc(var(--prose-size,17.5px)-1.5px)] leading-[1.6] text-muted-foreground";

/**
 * Dialogue hangs its opening quote inside a small shared indent, so the quote
 * renders as a decoration outside the textarea in edit mode and the prose sits
 * at the same x in both modes.
 */
export const DIALOGUE_INDENT = "relative pl-[0.55em]";
export const DIALOGUE_QUOTE = "absolute left-0 select-none text-faint";

export const NOTE_BODY = "text-sm leading-[1.55]";

export const LATEX_BODY = "whitespace-pre-wrap rounded-md border border-border bg-muted p-2.5 font-mono text-xs leading-[1.6] text-muted-foreground";
