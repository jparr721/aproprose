// board-act-column.tsx -- one act as a droppable column of sortable beat cards.
//
// Each column is BOTH a droppable (so dropping on its empty area / slack resolves
// to "append to this act", keyed by COLUMN_IDS) AND a SortableContext over its
// act's beats (so cards reorder within it). The DndContext that spans all three
// columns lives one level up in OutlineBoard; this component only declares the
// column's drop target and its sortable list.

import { IconSparkles } from "@tabler/icons-react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TypographyEyebrow, TypographyMuted, TypographyStat } from "@/components/ui/typography";
import { BoardBeatCard } from "@/components/app/outline/board-beat-card";
import { COLUMN_IDS } from "@/lib/outline/board-dnd";
import { actPacing } from "@/lib/outline/model";
import { sculptAct } from "@/lib/ai/operations";
import { buildSculptContext } from "@/lib/ai/sculpt-context";
import { describeAiError } from "@/lib/ai/errors";
import { useProjectStore } from "@/stores/project-store";
import { useOutlineBoardStore } from "@/stores/outline-board-store";
import { cn } from "@/lib/utils";
import type { ActKind } from "@/lib/types";

export function BoardActColumn({ actKind }: { actKind: ActKind }) {
  const outline = useProjectStore((s) => s.meta.outline);
  const chapters = useProjectStore((s) => s.project?.chapters ?? []);

  const sculptingAct = useOutlineBoardStore((s) => s.sculptingAct);
  const proposal = useOutlineBoardStore((s) => s.proposal);
  const sculptError = useOutlineBoardStore((s) => s.sculptError);
  const startSculpt = useOutlineBoardStore((s) => s.startSculpt);
  const setProposal = useOutlineBoardStore((s) => s.setProposal);
  const setSculptError = useOutlineBoardStore((s) => s.setSculptError);

  const act = outline.acts.find((a) => a.kind === actKind)!;
  const pacing = actPacing(outline, chapters)[actKind];
  const sharePct = Math.round(pacing.actualShare * 100);

  // Loading: this act's sculpt is in flight (started, no proposal back yet, no error).
  const loading = sculptingAct === actKind && proposal === null && sculptError === null;

  const runSculpt = () => {
    startSculpt(actKind);
    sculptAct(buildSculptContext(actKind))
      .then((p) => setProposal(p))
      .catch((e: unknown) => setSculptError(describeAiError(e)));
  };

  const { setNodeRef, isOver } = useDroppable({ id: COLUMN_IDS[actKind] });

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <div className="flex items-baseline gap-2">
          <TypographyEyebrow>{act.title}</TypographyEyebrow>
          <TypographyStat className="text-xs text-muted-foreground">{sharePct}%</TypographyStat>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={runSculpt}
            disabled={loading}
          >
            {loading ? <Spinner /> : <IconSparkles className="text-ai-ink" />}
            Sculpt this act
          </Button>
          {sculptError !== null && sculptingAct === actKind ? (
            <TypographyMuted className="text-xs">{sculptError}</TypographyMuted>
          ) : null}
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-32 flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2 transition-colors",
          isOver && "border-select-edge bg-muted/60",
        )}
      >
        <SortableContext items={act.beats.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          {act.beats.map((beat) => (
            <BoardBeatCard key={beat.id} beat={beat} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
