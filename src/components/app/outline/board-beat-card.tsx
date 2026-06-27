// board-beat-card.tsx -- one beat as a draggable storyboard card.
//
// Mirrors block.tsx's sortable wiring: the whole card is the drop node
// (setNodeRef), a dedicated grip is the drag activator (setActivatorNodeRef +
// attributes/listeners), and the live drag offset rides a CSS var consumed by an
// arbitrary transform utility so no literal inline transform is written. A plain
// click (the PointerSensor's 6px threshold keeps it from starting a drag) selects
// the beat into the board store; the detail rail (Phase 4) reads that selection.

import { type CSSProperties } from "react";
import { IconGripVertical } from "@tabler/icons-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "@/components/ui/card";
import { BeatTypeBadge } from "@/components/app/outline/beat-type-badge";
import { TypographySmall, TypographyMutedSpan } from "@/components/ui/typography";
import { useProjectStore } from "@/stores/project-store";
import { useOutlineBoardStore } from "@/stores/outline-board-store";
import { cn } from "@/lib/utils";
import type { Beat } from "@/lib/types";

type DndVar = CSSProperties & Record<"--dnd-transform", string>;

export function BoardBeatCard({ beat }: { beat: Beat }) {
  const chapters = useProjectStore((s) => s.project?.chapters ?? []);
  const selectChapter = useProjectStore((s) => s.selectChapter);
  const selectBeat = useOutlineBoardStore((s) => s.selectBeat);
  const selected = useOutlineBoardStore((s) => s.selectedBeatId === beat.id);

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useSortable({ id: beat.id });

  const linked = beat.chapterIds
    .map((id) => chapters.find((c) => c.id === id))
    .filter((c) => c != null);

  return (
    <Card
      ref={setNodeRef}
      data-beat-id={beat.id}
      onClick={() => selectBeat(beat.id)}
      style={{ "--dnd-transform": CSS.Transform.toString(transform) } as DndVar}
      className={cn(
        "group cursor-pointer gap-0 py-0 transition-colors [transform:var(--dnd-transform,none)]",
        selected ? "border-select-edge" : "hover:bg-muted/50",
        isDragging && "z-10 opacity-90 shadow-lg",
      )}
    >
      <CardContent className="flex gap-1.5 px-2.5 py-2">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder beat"
          title="Drag to reorder"
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 inline-flex h-fit cursor-grab touch-none border-0 bg-transparent p-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
        >
          <IconGripVertical className="size-3.5" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <BeatTypeBadge type={beat.type} />
          <TypographySmall className="line-clamp-2 font-medium leading-snug">
            {beat.title}
          </TypographySmall>
          {linked.length > 0 ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void selectChapter(linked[0].id);
              }}
              className="w-fit text-left"
            >
              <TypographyMutedSpan className="line-clamp-1 text-xs hover:underline">
                {linked.length === 1
                  ? linked[0].title
                  : `${linked[0].title} +${linked.length - 1}`}
              </TypographyMutedSpan>
            </button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
