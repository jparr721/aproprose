// grounding-render.ts - the single renderer for AI grounding prompts.
//
// Every structured op grounds the model on labeled sections in one canonical
// order. operations.ts feeds it per-op sections (prose for the generative ops,
// id-labeled blocks for the anchored ones); the section renderer itself never
// varies, so op groundings cannot drift apart. (Named grounding-render to avoid
// clashing with src/lib/outline/grounding.ts.)

import type { BlockType } from "@/lib/types";

export interface GroundingSections {
  chapterTitle?: string;
  characters?: { name: string; role?: string }[];
  cursorSummary?: string;
  structure?: string;
  /** Rendered scene prose (SCENE PROSE section). */
  prose?: string;
  /** Id-labeled blocks ("[id] (type): text") with a caller-supplied label. */
  blocks?: { label: string; items: { id: string; type: BlockType; text: string }[] };
  /** The author's request, always rendered LAST. */
  instruction?: { label: string; text: string };
}

/** Render labeled sections in the canonical order: CHAPTER, KNOWN CAST,
 *  CURSOR, STORY STRUCTURE, prose/blocks, instruction. Skips empty sections;
 *  joins with blank lines. */
export function renderGrounding(sections: GroundingSections): string {
  const parts: string[] = [];
  if (sections.chapterTitle) parts.push(`CHAPTER: ${sections.chapterTitle}`);
  if (sections.characters && sections.characters.length > 0) {
    const roster = sections.characters
      .map((c) => (c.role ? `- ${c.name} (${c.role})` : `- ${c.name}`))
      .join("\n");
    parts.push(`KNOWN CAST:\n${roster}`);
  }
  if (sections.cursorSummary) parts.push(`CURSOR: ${sections.cursorSummary}`);
  if (sections.structure) parts.push(`STORY STRUCTURE:\n${sections.structure}`);
  // The scene sits just before the request so the request stays the freshest,
  // most salient directive in the model's window. Empty prose still renders:
  // the section header is the op's contract, its content the current scene.
  if (sections.prose !== undefined) parts.push(`SCENE PROSE:\n${sections.prose}`);
  if (sections.blocks) {
    const lines = sections.blocks.items
      .map((b) => `[${b.id}] (${b.type}): ${b.text}`)
      .join("\n\n");
    parts.push(`${sections.blocks.label}:\n${lines}`);
  }
  const ask = sections.instruction?.text.trim();
  if (sections.instruction && ask) parts.push(`${sections.instruction.label}:\n${ask}`);
  return parts.join("\n\n");
}
