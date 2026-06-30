// block-text.ts — pure helpers shared across the block surfaces: speaker lookup
// and a whole block rendered as readable plain text (the "Copy block" action).

import type { Block as BlockT, Character } from "@/lib/types";

export function findSpeaker(block: BlockT, characters: Character[]): Character | undefined {
  return block.speaker ? characters.find((c) => c.id === block.speaker) : undefined;
}

export function blockPlainText(block: BlockT, characters: Character[]): string {
  switch (block.type) {
    case "chapter":
      return block.text;
    case "dialogue": {
      const sp = findSpeaker(block, characters);
      const quote = `"${block.text}"`;
      const head = sp ? `${sp.name}: ${quote}` : quote;
      return block.beat ? `${head}\n${block.beat}` : head;
    }
    case "lore":
    case "scratchpad":
      return block.title ? `${block.title}\n${block.text}` : block.text;
    default:
      return block.text;
  }
}
