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
): { chapterId: string; title: string; prose: string } | null {
  if (chapter === null) return null;
  return {
    chapterId: chapter.chapterId,
    title: chapter.title,
    prose: chapter.blocks
      .filter(
        (block) =>
          block.type === "narration" ||
          block.type === "dialogue" ||
          block.type === "chapter",
      )
      .map((block) => block.text)
      .join("\n\n"),
  };
}

export function buildOutlinePlannerGrounding(
  input: OutlinePlannerGroundingInput,
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
    characters: input.meta.characters,
    linkedLore: input.meta.lore.filter((entry) => linkedLoreIds.has(entry.id)),
    manuscript: {
      previous: manuscriptChapter(input.previous),
      target: manuscriptChapter(input.target),
      next: manuscriptChapter(input.next),
    },
  };
  return `OUTLINE PLANNER GROUNDING\n${JSON.stringify(value, null, 2)}`;
}
