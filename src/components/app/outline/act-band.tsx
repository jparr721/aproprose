import { TypographyEyebrow } from "@/components/ui/typography";
import { BoardChapterColumn } from "@/components/app/outline/board-chapter-column";
import { ACT_TITLES } from "@/lib/outline/model";
import { cn } from "@/lib/utils";
import type { ActKind, ChapterRef } from "@/lib/types";

const BAND_BG: Record<ActKind, string> = {
  setup: "bg-act-setup/40",
  confrontation: "bg-act-confrontation/40",
  resolution: "bg-act-resolution/40",
};

/** One contiguous run of chapters sharing an act (or unassigned). `startIndex`
 *  is the run's first chapter's global manuscript index, for column numbering. */
export function ActBand(props: {
  act: ActKind | null;
  chapters: ChapterRef[];
  startIndex: number;
  pacingLabel: string | null;
}) {
  const { act, chapters, startIndex, pacingLabel } = props;
  return (
    <div className={cn("flex shrink-0 flex-col gap-2.5 rounded-xl p-3", act ? BAND_BG[act] : "bg-muted/30")}>
      <div className="flex items-baseline gap-2 px-0.5">
        <TypographyEyebrow>{act ? ACT_TITLES[act] : "Unassigned"}</TypographyEyebrow>
        {pacingLabel ? <span className="text-xs text-faint">{pacingLabel}</span> : null}
      </div>
      <div className="flex items-start gap-3">
        {chapters.map((c, i) => (
          <BoardChapterColumn key={c.id} chapterRef={c} index={startIndex + i} />
        ))}
      </div>
    </div>
  );
}
