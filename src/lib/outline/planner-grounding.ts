import { projectChapter, type BookBlockValue } from "@/book";
import { getChapterOutline } from "@/lib/outline/model";
import type {
  Block,
  ChapterRef,
  ProjectMeta,
} from "@/lib/types";

export interface OutlinePlannerManuscriptChapter {
  chapterId: string;
  title: string;
  blocks: Block[];
}

export interface OutlinePlannerGroundingInput {
  chapters: ChapterRef[];
  meta: ProjectMeta;
  targetChapterId: string;
  target: OutlinePlannerManuscriptChapter;
  previous: OutlinePlannerManuscriptChapter | null;
  next: OutlinePlannerManuscriptChapter | null;
}

function manuscriptChapter(
  chapter: OutlinePlannerManuscriptChapter | null,
  maxCharacters: number,
): {
  chapterId: string;
  title: string;
  blocks: BookBlockValue[];
  truncated: boolean;
  start: number;
  endExclusive: number;
  includedCharacters: number;
  totalBlocks: number;
  totalCharacters: number;
} | null {
  if (chapter === null) return null;
  const projected = projectChapter(chapter);
  const blocks: BookBlockValue[] = [];
  let includedCharacters = 0;
  for (const block of projected.blocks) {
    const characters = JSON.stringify(block).length + (blocks.length === 0 ? 0 : 1);
    if (includedCharacters + characters > maxCharacters) break;
    blocks.push(block);
    includedCharacters += characters;
  }
  return {
    chapterId: chapter.chapterId,
    title: chapter.title,
    blocks,
    truncated: blocks.length < projected.blocks.length,
    start: 0,
    endExclusive: blocks.length,
    includedCharacters,
    totalBlocks: chapter.blocks.length,
    totalCharacters: JSON.stringify(projected.blocks).length - 2,
  };
}

export function buildOutlinePlannerGrounding(
  input: OutlinePlannerGroundingInput,
  maxManuscriptCharacters: number,
): string {
  const targetIndex = input.chapters.findIndex(
    (chapter) => chapter.id === input.targetChapterId,
  );
  if (targetIndex < 0) {
    throw new Error(`Outline planner chapter not found: ${input.targetChapterId}`);
  }
  const expectedPrevious = input.chapters[targetIndex - 1] ?? null;
  const expectedNext = input.chapters[targetIndex + 1] ?? null;
  if (input.target.chapterId !== input.targetChapterId) {
    throw new Error(
      `Outline planner target mismatch: ${input.target.chapterId}`,
    );
  }
  if (input.previous !== null && input.previous.chapterId !== expectedPrevious?.id) {
    throw new Error(
      `Outline planner previous chapter mismatch: ${input.targetChapterId}`,
    );
  }
  if (input.next !== null && input.next.chapterId !== expectedNext?.id) {
    throw new Error(
      `Outline planner next chapter mismatch: ${input.targetChapterId}`,
    );
  }

  const linkedLoreIds = new Set(
    getChapterOutline(input.meta.chapters, input.targetChapterId).cards.flatMap((card) => card.loreIds),
  );
  const targetOutline = getChapterOutline(
    input.meta.chapters,
    input.targetChapterId,
  );
  const neighborhoodChapterIds = [
    input.previous?.chapterId,
    input.target.chapterId,
    input.next?.chapterId,
  ].filter((chapterId): chapterId is string => chapterId !== undefined);
  const relevantCharacterIds = new Set([
    ...targetOutline.characterIds,
    ...targetOutline.cards.flatMap((card) => card.characterIds),
    ...[input.previous, input.next].flatMap((chapter) =>
      chapter === null
        ? []
        : getChapterOutline(input.meta.chapters, chapter.chapterId).characterIds,
    ),
    ...neighborhoodChapterIds.flatMap(
      (chapterId) =>
        input.meta.knowledge.chapters[chapterId]?.characterObservations.map(
          (observation) => observation.characterId,
        ) ?? [],
    ),
  ]);
  const target = manuscriptChapter(input.target, maxManuscriptCharacters);
  const remaining = target !== null && target.truncated
    ? 0
    : maxManuscriptCharacters - (target === null ? 0 : target.includedCharacters);
  const previous = manuscriptChapter(input.previous, Math.floor(remaining / 2));
  const next = manuscriptChapter(input.next, Math.ceil(remaining / 2));
  const value = {
    discovery: {
      previousChapterId: expectedPrevious === null ? null : expectedPrevious.id,
      nextChapterId: expectedNext === null ? null : expectedNext.id,
      policy: "Target material first. Neighbors are uninspected unless included below. The manuscript character budget counts compact JSON block payloads and includes only complete ordered blocks. Retrieve other book material with tools only to resolve a concrete uncertainty. If target.truncated is true, read the remaining ordered blocks using read_chapter_range starting at target.endExclusive before diagnosing the whole chapter. Distinguish source facts, existing plan, inferred intent and confirmed author choices.",
    },
    logline: input.meta.outline.premise,
    storyOverview: input.meta.outline.overview,
    targetPosition: {
      index: targetIndex,
      number: targetIndex + 1,
      total: input.chapters.length,
      chapterId: input.targetChapterId,
    },
    outline: input.chapters.map((chapter, index) => ({
      index,
      chapterId: chapter.id,
      title: chapter.title,
      ...(chapter.id === input.targetChapterId
        ? getChapterOutline(input.meta.chapters, chapter.id)
        : { cardCount: getChapterOutline(input.meta.chapters, chapter.id).cards.length }),
    })),
    characters: input.meta.characters.map((character) =>
      relevantCharacterIds.has(character.id)
        ? {
            id: character.id,
            name: character.name,
            role: character.role,
            profile: { ...character.profile },
          }
        : {
            id: character.id,
            name: character.name,
            role: character.role,
          },
    ),
    linkedLore: input.meta.lore.filter((entry) => linkedLoreIds.has(entry.id)),
    manuscript: {
      previous,
      target,
      next,
    },
  };
  return `OUTLINE PLANNER GROUNDING\n${JSON.stringify(value, null, 2)}`;
}
