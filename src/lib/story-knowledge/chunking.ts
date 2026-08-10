import {
  blockFingerprint,
  blockSnapshotText,
  textFingerprint,
} from "@/lib/ai/agent-context";
import type { Block, BlockType, EvidenceLocator } from "@/lib/types";

export const STORY_REFRESH_CHUNK_MAX_CHARACTERS = 12_000;
export const EVIDENCE_PREVIEW_MAX_CHARACTERS = 240;

export interface StoryKnowledgeBlock {
  locator: EvidenceLocator;
  type: Extract<BlockType, "chapter" | "narration" | "dialogue">;
  text: string;
  speakerId: string | null;
}

export interface StoryKnowledgeChunk {
  chapterId: string;
  chapterTitle: string;
  blocks: StoryKnowledgeBlock[];
}

type EligibleStoryBlock = Block & { type: StoryKnowledgeBlock["type"] };

function isEligibleStoryBlock(block: Block): block is EligibleStoryBlock {
  return (
    block.type === "narration" ||
    block.type === "dialogue" ||
    (block.type === "chapter" && block.level !== "break")
  );
}

function projectStoryBlock(
  chapterId: string,
  block: EligibleStoryBlock,
  order: number,
  fingerprint: string,
  occurrence: number,
): StoryKnowledgeBlock {
  const text = block.type === "dialogue" ? blockSnapshotText(block) : block.text;
  return {
    locator: {
      chapterId,
      sourceId: block.id,
      order,
      fingerprint,
      occurrence,
      previewText: text.slice(0, EVIDENCE_PREVIEW_MAX_CHARACTERS),
    },
    type: block.type,
    text,
    speakerId: block.type === "dialogue" ? (block.speaker ?? null) : null,
  };
}

export function durableEvidenceIdentity(locator: EvidenceLocator): string {
  return JSON.stringify([
    locator.chapterId,
    locator.fingerprint,
    locator.occurrence,
  ]);
}

export function storyChapterFingerprint(blocks: Block[]): string {
  const fingerprints = blocks
    .filter(isEligibleStoryBlock)
    .map((block) => blockFingerprint(block));
  return textFingerprint(JSON.stringify(fingerprints));
}

export function chunkStoryChapter(
  chapterId: string,
  title: string,
  blocks: Block[],
  maxCharacters: number,
): StoryKnowledgeChunk[] {
  const occurrences = new Map<string, number>();
  const projected = blocks.flatMap((block, order) => {
    if (!isEligibleStoryBlock(block)) return [];
    const fingerprint = blockFingerprint(block);
    const occurrence = occurrences.get(fingerprint) ?? 0;
    occurrences.set(fingerprint, occurrence + 1);
    return [
      projectStoryBlock(
        chapterId,
        block,
        order,
        fingerprint,
        occurrence,
      ),
    ];
  });
  const chunks: StoryKnowledgeChunk[] = [];
  let currentBlocks: StoryKnowledgeBlock[] = [];
  let currentCharacters = 0;

  for (const block of projected) {
    if (
      currentBlocks.length > 0 &&
      currentCharacters + block.text.length > maxCharacters
    ) {
      chunks.push({ chapterId, chapterTitle: title, blocks: currentBlocks });
      currentBlocks = [];
      currentCharacters = 0;
    }
    currentBlocks.push(block);
    currentCharacters += block.text.length;
  }

  if (currentBlocks.length > 0) {
    chunks.push({ chapterId, chapterTitle: title, blocks: currentBlocks });
  }

  return chunks;
}
