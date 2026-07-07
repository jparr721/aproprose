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

// break-words matches the textarea's native overflow-wrap so an unspaced LaTeX
// run wraps identically in both modes instead of overflowing the read view.
export const LATEX_BODY = "whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-2.5 font-mono text-xs leading-[1.6] text-muted-foreground";

/** Types that draw their own tinted card surface; the block row treats them
 *  specially (no hover wash, selection edge only) to avoid box-in-a-box. */
export const CARD_TYPES: ReadonlySet<BlockType> = new Set(["lore", "scratchpad"]);

/** Empty-state text, shared verbatim by the read view and the edit placeholder
 *  so an empty block never changes copy when it enters edit mode. */
export const PLACEHOLDERS = {
  narration: "Write",
  dialogue: "What do they say?",
  beat: "Action beat",
  spokenLine: "What do they say next?",
  scene: "Scene heading",
  break: "* * *",
  lore: "Worldbuilding note",
  scratchpad: "Brainstorm, reminders",
} as const;
