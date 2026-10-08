import { blockFingerprint, blockSnapshotText } from "@/lib/ai/agent-context";
import type { Block } from "@/lib/types";
import type { BookBlockValue, BookChapterSnapshot, BookChapterValue } from "@/book/types";

function projectBlock(block: Block, order: number): BookBlockValue {
  const fields = {
    id: block.id,
    order,
    text: block.text,
    fingerprint: blockFingerprint(block),
    citationText: blockSnapshotText(block),
  };
  switch (block.type) {
    case "dialogue":
      return {
        ...fields,
        type: block.type,
        ...(block.speaker === undefined ? {} : { speaker: block.speaker }),
        ...(block.tail === undefined ? {} : { tail: structuredClone(block.tail) }),
      };
    case "chapter":
      return { ...fields, type: block.type, ...(block.level === undefined ? {} : { level: block.level }) };
    case "lore":
      return { ...fields, type: block.type, ...(block.title === undefined ? {} : { title: block.title }) };
    case "narration":
    case "scratchpad":
    case "latex":
      return { ...fields, type: block.type };
    default: {
      const exhaustive: never = block.type;
      throw new Error(`Unsupported book block type: ${exhaustive}`);
    }
  }
}

export function projectChapter(chapter: BookChapterSnapshot): BookChapterValue {
  return {
    chapterId: chapter.chapterId,
    title: chapter.title,
    blocks: chapter.blocks.map(projectBlock),
  };
}
