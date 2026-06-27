import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  TypographyForeground,
  TypographyMutedSpan,
  TypographySmall,
} from "@/components/ui/typography";
import { cellLevel, computeThresholds, localDateKey } from "@/lib/stats/stats";
import type { WritingStats } from "@/lib/stats/schema";
import { CELL_LEVEL_CLASSES, ContributionCell } from "./contribution-cell";

const DAYS_IN_WEEK = 7;
const WEEKS = 26;

function addDays(date: Date, n: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + n);
  return next;
}

function formatLongDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ContributionChart({ days }: { days: WritingStats["days"] }) {
  const { cells, thresholds } = useMemo(() => {
    const today = new Date();
    const todayKey = localDateKey(today);
    const end = addDays(today, 6 - today.getDay()); // Saturday of this week
    const start = addDays(end, -(WEEKS * DAYS_IN_WEEK - 1)); // Sunday, WEEKS back
    const list: Array<{ key: string; isFuture: boolean }> = [];
    for (let i = 0; i < WEEKS * DAYS_IN_WEEK; i += 1) {
      const key = localDateKey(addDays(start, i));
      list.push({ key, isFuture: key > todayKey });
    }
    const values = list.map((c) => days[c.key]?.added ?? 0).filter((v) => v > 0);
    return { cells: list, thresholds: computeThresholds(values) };
  }, [days]);

  return (
    <div className="flex flex-col gap-2">
      {/* dir=rtl starts the scroll at the most recent week; the inner grid resets
          dir=ltr so the visual day order is correct. */}
      <ScrollArea dir="rtl">
        <div
          dir="ltr"
          className="grid grid-flow-col grid-rows-[repeat(7,minmax(0,1fr))] gap-[3px]"
        >
          {cells.map((cell) => {
            if (cell.isFuture) return <div key={cell.key} className="size-3" />;
            const day = days[cell.key];
            const level = cellLevel(day, thresholds);
            return (
              <Tooltip key={cell.key}>
                <TooltipTrigger asChild>
                  <ContributionCell level={level} aria-label={formatLongDate(cell.key)} />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <TypographySmall className="block font-medium">
                    {formatLongDate(cell.key)}
                  </TypographySmall>
                  {day && day.saves > 0 ? (
                    <TypographyForeground className="block font-mono text-xs tabular-nums">
                      {day.added} word{day.added === 1 ? "" : "s"} - {day.saves} save
                      {day.saves === 1 ? "" : "s"}
                    </TypographyForeground>
                  ) : (
                    <TypographyMutedSpan>No writing</TypographyMutedSpan>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </ScrollArea>

      <div className="flex items-center justify-end gap-1 text-xs">
        <TypographyMutedSpan>Less</TypographyMutedSpan>
        {CELL_LEVEL_CLASSES.map((cls) => (
          <div key={cls} className={cn("size-3 rounded-[2px]", cls)} />
        ))}
        <TypographyMutedSpan>More</TypographyMutedSpan>
      </div>
    </div>
  );
}
