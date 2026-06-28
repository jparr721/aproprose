// sculpt-context.ts - build the SculptContext for one chapter from project state.
//
// Reads the chapter's planning entry, its title from the project, and the roster
// (characters + lore) straight from project-store. Pure read; no writes.

import type { SculptContext } from "@/lib/ai/operations";
import { getChapterOutline } from "@/lib/outline/model";
import { useProjectStore } from "@/stores/project-store";

export function buildSculptContext(chapterId: string): SculptContext {
  const { meta, project } = useProjectStore.getState();
  const ch = getChapterOutline(meta.chapters, chapterId);
  const title = project?.chapters.find((c) => c.id === chapterId)?.title ?? "";
  return {
    chapterId,
    chapterTitle: title,
    storyPremise: meta.outline.premise,
    premise: ch.premise,
    goal: ch.goal,
    conflict: ch.conflict,
    turn: ch.turn,
    cards: ch.cards.map((c) => ({ id: c.id, title: c.title, intention: c.intention })),
    characters: meta.characters.map((c) => ({ name: c.name })),
    lore: meta.lore.map((l) => ({ title: l.title })),
  };
}
