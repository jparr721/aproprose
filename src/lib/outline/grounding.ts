// grounding.ts -- render the STORY STRUCTURE block injected into AI grounding.
//
// Pure: takes the global logline + the active chapter's planning entry, returns
// the inner text (operations.ts adds the "STORY STRUCTURE:" header) or null when
// there is nothing to ground on. The null case is the no-op guarantee: writers
// who do not outline see zero change in AI behavior. With seeded defaults gone,
// an untouched chapter contributes nothing.

import { ACT_ROMAN, ACT_TITLES } from "@/lib/outline/model";
import type { ChapterOutline, Outline } from "@/lib/types";

export function renderStoryStructure(args: {
  outline: Outline;
  chapters: Record<string, ChapterOutline>;
  activeChapterId: string | null;
}): string | null {
  const { outline, chapters, activeChapterId } = args;
  const premise = outline.premise.trim();
  const ch = activeChapterId ? chapters[activeChapterId] : undefined;

  const arc = ch
    ? [
        ch.goal.trim() ? `Goal: ${ch.goal.trim()}` : "",
        ch.conflict.trim() ? `Conflict: ${ch.conflict.trim()}` : "",
        ch.turn.trim() ? `Turn: ${ch.turn.trim()}` : "",
      ].filter(Boolean)
    : [];
  const chapterPremise = ch?.premise.trim() ?? "";
  const cards = (ch?.cards ?? []).filter((c) => c.title.trim() || c.intention.trim());

  if (!premise && !ch?.act && arc.length === 0 && !chapterPremise && cards.length === 0) {
    return null;
  }

  const lines: string[] = [];
  if (premise) lines.push(`Premise: ${premise}`);
  if (ch?.act) lines.push(`This scene is in Act ${ACT_ROMAN[ch.act]} - ${ACT_TITLES[ch.act]}.`);
  if (chapterPremise) lines.push(`This chapter: ${chapterPremise}`);
  if (arc.length > 0) lines.push(`This chapter's arc - ${arc.join(" ")}`);
  if (cards.length > 0) {
    const beats = cards
      .map((c) => (c.intention.trim() ? `${c.title.trim()} - ${c.intention.trim()}` : c.title.trim()))
      .join("; ");
    lines.push(`Planned beats: ${beats}`);
  }
  return lines.join("\n");
}
