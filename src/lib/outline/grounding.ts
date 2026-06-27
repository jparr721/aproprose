// grounding.ts -- render the STORY STRUCTURE block injected into AI grounding.
//
// Pure: takes the outline + chapter beats + the active chapter, returns the inner
// text (operations.ts adds the "STORY STRUCTURE:" header) or null when the active
// scene has no structural context and there is no premise. The null case is the
// no-op guarantee: writers who do not outline see zero change in AI behavior,
// even though beats ship with seeded intention copy.

import { ACT_ROMAN, beatForChapter } from "@/lib/outline/model";
import type { ChapterBeat, ChapterRef, Outline } from "@/lib/types";

export function renderStoryStructure(args: {
  outline: Outline;
  chapterBeats: Record<string, ChapterBeat>;
  activeChapterId: string | null;
  chapters: ChapterRef[];
}): string | null {
  const { outline, chapterBeats, activeChapterId } = args;
  const premise = outline.premise.trim();
  const linked = activeChapterId ? beatForChapter(outline, activeChapterId) : null;
  const cb = activeChapterId ? chapterBeats[activeChapterId] : undefined;
  const arc = cb
    ? [
        cb.goal.trim() ? `Goal: ${cb.goal.trim()}` : "",
        cb.conflict.trim() ? `Conflict: ${cb.conflict.trim()}` : "",
        cb.turn.trim() ? `Turn: ${cb.turn.trim()}` : "",
      ].filter(Boolean)
    : [];

  if (!linked && arc.length === 0 && !premise) return null;

  const lines: string[] = [];
  if (premise) lines.push(`Premise: ${premise}`);

  if (linked) {
    const { act, beat } = linked;
    const head = `This scene is in Act ${ACT_ROMAN[act.kind]} - ${act.title}`;
    lines.push(act.summary.trim() ? `${head}: ${act.summary.trim()}` : `${head}.`);
    const intention = beat.intention.trim();
    lines.push(intention ? `It serves the beat "${beat.title}": ${intention}` : `It serves the beat "${beat.title}".`);
  } else {
    lines.push("This scene is not yet placed on the outline.");
  }

  if (arc.length > 0) lines.push(`This chapter's arc - ${arc.join(" ")}`);

  return lines.join("\n");
}
