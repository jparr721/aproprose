// beat-detail-rail.tsx -- the storyboard's right-hand inspector for the selected
// beat: intention, cast present, lore referenced, and continuity flags.
// Cast / lore / continuity sections are added in Task 4.6.

import { useProjectStore } from "@/stores/project-store";
import { useOutlineBoardStore } from "@/stores/outline-board-store";
import { findBeat } from "@/lib/outline/model";
import { InlineEdit } from "@/components/app/outline/inline-edit";
import { BeatTypeBadge } from "@/components/app/outline/beat-type-badge";
import {
  TypographyEyebrow,
  TypographyH4,
  TypographyMuted,
} from "@/components/ui/typography";

export function BeatDetailRail() {
  const selectedBeatId = useOutlineBoardStore((s) => s.selectedBeatId);
  const outline = useProjectStore((s) => s.meta.outline);
  const editBeat = useProjectStore((s) => s.editBeat);

  const beat = selectedBeatId ? findBeat(outline, selectedBeatId) : null;

  if (!beat) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <TypographyMuted>Select a beat to inspect its cast, lore, and continuity.</TypographyMuted>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-col gap-1.5">
        <BeatTypeBadge type={beat.type} />
        <TypographyH4>{beat.title}</TypographyH4>
      </div>
      <section className="flex flex-col gap-1.5">
        <TypographyEyebrow>Intention</TypographyEyebrow>
        <InlineEdit
          value={beat.intention}
          onCommit={(intention) => editBeat(beat.id, { intention })}
          placeholder="What must this beat accomplish?"
          multiline
          className="text-xs leading-snug text-muted-foreground"
        />
      </section>
    </div>
  );
}
