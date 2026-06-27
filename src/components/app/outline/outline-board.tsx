// outline-board.tsx -- the three-act storyboard.
//
// One DndContext spans all three columns; each column is its own SortableContext
// (BoardActColumn). closestCorners is the multi-container collision strategy: it
// reports the nearest droppable, which is a beat id over a card or a column id
// over empty slack -- resolveBeatDrop decodes either into the moveBeatTo args, so
// a drag reorders within an act AND moves across acts. A DragOverlay paints the
// lifted card above the columns' overflow. Sensors mirror editor.tsx (6px pointer
// threshold so a click still selects; keyboard handle support).

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TypographyLead, TypographyMuted } from "@/components/ui/typography";
import { PacingGuide } from "@/components/app/outline/pacing-guide";
import { BoardActColumn } from "@/components/app/outline/board-act-column";
import { BoardBeatCard } from "@/components/app/outline/board-beat-card";
import { BeatDetailRail } from "@/components/app/outline/beat-detail-rail";
import { resolveBeatDrop } from "@/lib/outline/board-dnd";
import { findBeat } from "@/lib/outline/model";
import { useProjectStore } from "@/stores/project-store";
import type { ActKind } from "@/lib/types";

const ACTS: ActKind[] = ["setup", "confrontation", "resolution"];

export function OutlineBoard() {
  const premise = useProjectStore((s) => s.meta.outline.premise);
  const outline = useProjectStore((s) => s.meta.outline);
  const moveBeatTo = useProjectStore((s) => s.moveBeatTo);

  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const move = resolveBeatDrop(outline, String(active.id), String(over.id));
    if (move) moveBeatTo(String(active.id), move.toActKind, move.toIndex);
  };

  const activeBeat = activeId ? findBeat(outline, activeId) : null;

  return (
    <div className="flex min-h-0 h-full bg-background">
      <ScrollArea className="flex-1 min-w-0">
        <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 px-6 py-6">
          <div className="flex flex-col gap-3">
            {premise ? (
              <TypographyLead className="text-base">{premise}</TypographyLead>
            ) : (
              <TypographyMuted className="text-sm">
                No logline yet. Set the premise from the outline panel.
              </TypographyMuted>
            )}
            <PacingGuide />
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <div className="flex items-start gap-4">
              {ACTS.map((kind) => (
                <BoardActColumn key={kind} actKind={kind} />
              ))}
            </div>
            <DragOverlay>{activeBeat ? <BoardBeatCard beat={activeBeat} /> : null}</DragOverlay>
          </DndContext>
        </div>
      </ScrollArea>
      <aside className="w-72 shrink-0 border-l border-border bg-card">
        <BeatDetailRail />
      </aside>
    </div>
  );
}
