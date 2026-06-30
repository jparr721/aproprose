// constants.ts -- shared block presentation tokens (labels, swatches, prose class).

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
