import type { GuidedOutlineContext } from "@/lib/ai/operations";
import { buildScopedContext } from "@/lib/ai/context";
import { getChapterOutline } from "@/lib/outline/model";
import { useProjectStore } from "@/stores/project-store";

export function buildGuidedOutlineContext(chapterId: string): GuidedOutlineContext {
  const { project, meta, activeChapterId } = useProjectStore.getState();
  if (project === null) throw new Error("Cannot guide an outline without an open project.");
  const chapter = project.chapters.find((candidate) => candidate.id === chapterId);
  if (!chapter) throw new Error(`Chapter "${chapterId}" does not exist in the open project.`);
  const outline = getChapterOutline(meta.chapters, chapterId);
  return {
    chapterId,
    chapterTitle: chapter.title,
    storyPremise: meta.outline.premise,
    act: outline.act,
    plotPoint: outline.plotPoint,
    premise: outline.premise,
    goal: outline.goal,
    conflict: outline.conflict,
    turn: outline.turn,
    cards: outline.cards.map((card) => ({
      id: card.id,
      title: card.title,
      intention: card.intention,
      characterIds: [...card.characterIds],
      loreIds: [...card.loreIds],
    })),
    characters: meta.characters.map((character) => ({
      id: character.id,
      name: character.name,
      role: character.role,
    })),
    lore: meta.lore.map((entry) => ({
      id: entry.id,
      title: entry.title,
      description: entry.description,
      tags: [...entry.tags],
    })),
    manuscript: activeChapterId === chapterId
      ? buildScopedContext("chapter").blocksText
      : "",
  };
}
