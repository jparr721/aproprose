// outline-board.tsx -- the chapter-column storyboard.
//
// One DndContext spans every chapter column; each column (BoardChapterColumn,
// nested inside an ActBand) is its own SortableContext over its cards.
// closestCorners is the multi-container collision strategy: it reports the
// nearest droppable, which is a card id over a card or a column id over empty
// slack -- resolveCardDrop decodes either into the moveCardToChapter args, so a
// drag reorders within a chapter AND moves cards across chapters. Chapters are
// grouped into contiguous runs sharing an act, each rendered as a tinted ActBand,
// and the board scrolls horizontally. Sensors mirror editor.tsx (6px pointer
// threshold so a click still selects; keyboard handle support).

import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { IconPlus } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { TypographyEyebrow } from "@/components/ui/typography";
import { ActBand } from "@/components/app/outline/act-band";
import { SculptReview } from "@/components/app/outline/sculpt-review";
import { resolveCardDrop } from "@/lib/outline/board-dnd";
import { actPacing } from "@/lib/outline/model";
import { useProjectStore } from "@/stores/project-store";
import type { ActKind, ChapterRef } from "@/lib/types";

interface Run {
  act: ActKind | null;
  chapters: ChapterRef[];
  startIndex: number;
}

/** Group ordered chapters into contiguous runs sharing the same act. */
function groupIntoRuns(chapters: ChapterRef[], actOf: (id: string) => ActKind | null): Run[] {
  const runs: Run[] = [];
  chapters.forEach((c, i) => {
    const act = actOf(c.id);
    const last = runs[runs.length - 1];
    if (last && last.act === act) last.chapters.push(c);
    else runs.push({ act, chapters: [c], startIndex: i });
  });
  return runs;
}

export function OutlineBoard() {
  const premise = useProjectStore((s) => s.meta.outline.premise);
  const setPremise = useProjectStore((s) => s.setPremise);
  const chapters = useProjectStore((s) => s.project?.chapters ?? []);
  const chapterOutlines = useProjectStore((s) => s.meta.chapters);
  const moveCardToChapter = useProjectStore((s) => s.moveCardToChapter);
  const addChapter = useProjectStore((s) => s.addChapter);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const runs = groupIntoRuns(chapters, (id) => chapterOutlines[id]?.act ?? null);
  const pacing = actPacing(chapterOutlines, chapters);
  const pacingLabel = (act: ActKind | null): string | null => {
    if (!act) return null;
    const p = pacing[act];
    return `${Math.round(p.actualShare * 100)}% / target ${Math.round(p.targetShare * 100)}%`;
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const move = resolveCardDrop(chapterOutlines, String(e.active.id), String(e.over.id));
    if (move) moveCardToChapter(move.fromChapterId, move.toChapterId, move.cardId, move.toIndex);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <SculptReview />
      <div className="flex flex-col p-4 space-y-2">
        <TypographyEyebrow>Logline</TypographyEyebrow>
        <Textarea
          value={premise}
          onChange={(e) => setPremise(e.target.value)}
          placeholder="What is this book about?"
          rows={2}
          className="resize-y"
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-w-max flex-col px-4">
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
            <div className="flex items-start gap-4">
              {runs.map((run, i) => (
                <ActBand
                  key={i}
                  act={run.act}
                  chapters={run.chapters}
                  startIndex={run.startIndex}
                  pacingLabel={pacingLabel(run.act)}
                />
              ))}
              <Button
                variant="outline"
                className="shrink-0 border-dashed text-muted-foreground"
                onClick={() => void addChapter("New chapter")}
              >
                <IconPlus className="size-4" /> Add chapter
              </Button>
            </div>
          </DndContext>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
