import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { IconChevronRight, IconPlus, IconRefresh, IconWand } from "@tabler/icons-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { BoardCard } from "@/components/app/outline/board-card";
import { CharacterChip } from "@/components/app/outline/character-chip";
import { PlotPointBadge } from "@/components/app/outline/plot-point-badge";
import { cardColumnId } from "@/lib/outline/board-dnd";
import { beatCharacters } from "@/lib/outline/beat-signals";
import { getChapterOutline } from "@/lib/outline/model";
import { buildSculptContext } from "@/lib/ai/sculpt-context";
import { sculptChapter } from "@/lib/ai/operations";
import { describeAiError, withAiRetry } from "@/lib/ai/errors";
import { useOutlineBoardStore } from "@/stores/outline-board-store";
import { useProjectStore } from "@/stores/project-store";
import type { ChapterRef } from "@/lib/types";

export function BoardChapterColumn(props: { chapterRef: ChapterRef; index: number }) {
  const { chapterRef, index } = props;
  const ch = useProjectStore((s) => getChapterOutline(s.meta.chapters, chapterRef.id));
  const characters = useProjectStore((s) => s.meta.characters);
  const addCard = useProjectStore((s) => s.addCard);
  const openChapter = useOutlineBoardStore((s) => s.openChapter);
  const startSculpt = useOutlineBoardStore((s) => s.startSculpt);
  const setProposal = useOutlineBoardStore((s) => s.setProposal);
  const setSculptError = useOutlineBoardStore((s) => s.setSculptError);
  const proposal = useOutlineBoardStore((s) => s.proposal);
  const sculptingChapterId = useOutlineBoardStore((s) => s.sculptingChapterId);
  const sculptError = useOutlineBoardStore((s) => s.sculptError);
  const { setNodeRef } = useDroppable({ id: cardColumnId(chapterRef.id) });
  const cast = beatCharacters(ch.characterIds, characters);

  // The sculpt lifecycle is store-global with the target chapter marked, so only
  // this column reacts: in flight = marked with no result yet; failed = marked
  // with an error (a fresh startSculpt anywhere resets it).
  const isSculptTarget = sculptingChapterId === chapterRef.id;
  const sculpting = isSculptTarget && proposal === null && sculptError === null;
  const sculptFailed = isSculptTarget && sculptError !== null;

  const runSculpt = () => {
    startSculpt(chapterRef.id);
    withAiRetry(() => sculptChapter(buildSculptContext(chapterRef.id)))
      .then((p) => setProposal(p))
      .catch((e: unknown) => setSculptError(describeAiError(e)));
  };

  return (
    <div className="flex w-72 shrink-0 flex-col gap-2">
      <div className="flex flex-col gap-1.5 px-0.5">
        <button
          type="button"
          onClick={() => openChapter(chapterRef.id)}
          className="group flex items-center gap-1.5 text-left"
        >
          <span className="tabular-nums text-muted-foreground">{index + 1}</span>
          <span className="text-sm font-semibold text-foreground group-hover:underline">{chapterRef.title}</span>
          <IconChevronRight className="ml-auto size-3.5 text-muted-foreground" />
        </button>
        <div className="flex items-center gap-1.5">
          {ch.plotPoint ? <PlotPointBadge type={ch.plotPoint} /> : null}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-2 text-xs text-muted-foreground"
            onClick={runSculpt}
            disabled={sculpting}
          >
            {sculpting ? <Spinner className="size-3.5" /> : <IconWand className="size-3.5" />} Sculpt
          </Button>
        </div>
        {sculptFailed ? (
          <Alert variant="destructive">
            <AlertDescription className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words">
              {sculptError}
            </AlertDescription>
            <Button variant="outline" size="sm" className="w-fit" onClick={runSculpt}>
              <IconRefresh className="size-3.5" /> Try again
            </Button>
          </Alert>
        ) : null}
        {cast.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {cast.map((c) => (
              <CharacterChip key={c.id} name={c.name} color={c.color} />
            ))}
          </div>
        ) : null}
      </div>

      <div ref={setNodeRef} className="flex min-h-12 flex-col gap-2">
        <SortableContext items={ch.cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {ch.cards.map((card) => (
            <BoardCard key={card.id} card={card} chapterId={chapterRef.id} />
          ))}
        </SortableContext>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="justify-start text-xs text-muted-foreground"
        onClick={() => addCard(chapterRef.id)}
      >
        <IconPlus className="size-3.5" /> Add card
      </Button>
    </div>
  );
}
