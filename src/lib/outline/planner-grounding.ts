import { getChapterOutline } from "@/lib/outline/model";
import type {
  Block,
  ChapterRef,
  ProjectMeta,
} from "@/lib/types";

export interface OutlinePlannerManuscriptChapter {
  chapterId: string;
  title: string;
  blocks: Array<Pick<Block, "type" | "text">>;
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
  prose: string;
  truncated: boolean;
} | null {
  if (chapter === null) return null;
  const prose = chapter.blocks
    .filter(
      (block) =>
        block.type === "narration" ||
        block.type === "dialogue" ||
        block.type === "chapter",
    )
    .map((block) => block.text)
    .join("\n\n");
  return {
    chapterId: chapter.chapterId,
    title: chapter.title,
    prose: prose.slice(0, maxCharacters),
    truncated: prose.length > maxCharacters,
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
  if (input.previous?.chapterId !== (expectedPrevious?.id ?? undefined)) {
    throw new Error(
      `Outline planner previous chapter mismatch: ${input.targetChapterId}`,
    );
  }
  if (input.next?.chapterId !== (expectedNext?.id ?? undefined)) {
    throw new Error(
      `Outline planner next chapter mismatch: ${input.targetChapterId}`,
    );
  }

  const linkedLoreIds = new Set(
    Object.values(input.meta.chapters).flatMap((chapter) =>
      chapter.cards.flatMap((card) => card.loreIds),
    ),
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
  const manuscriptSources = [input.previous, input.target, input.next];
  const presentManuscriptCount = manuscriptSources.filter(
    (chapter) => chapter !== null,
  ).length;
  const baseChapterBudget =
    presentManuscriptCount === 0
      ? 0
      : Math.floor(maxManuscriptCharacters / presentManuscriptCount);
  let remainingCharacters =
    maxManuscriptCharacters - baseChapterBudget * presentManuscriptCount;
  const manuscriptBudgets = manuscriptSources.map((chapter) => {
    if (chapter === null) return 0;
    const extraCharacter = remainingCharacters > 0 ? 1 : 0;
    remainingCharacters -= extraCharacter;
    return baseChapterBudget + extraCharacter;
  });
  const value = {
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
      ...getChapterOutline(input.meta.chapters, chapter.id),
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
      previous: manuscriptChapter(input.previous, manuscriptBudgets[0]),
      target: manuscriptChapter(input.target, manuscriptBudgets[1]),
      next: manuscriptChapter(input.next, manuscriptBudgets[2]),
    },
  };
  return `OUTLINE PLANNER GROUNDING\n${JSON.stringify(value, null, 2)}`;
}
