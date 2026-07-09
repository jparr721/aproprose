import { type ReactElement, type ReactNode, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  TypographyMutedSpan,
  TypographySmall,
} from "@/components/ui/typography";
import { cellLevel, computeThresholds, dayMetGoal, localDateKey } from "@/lib/stats/stats";
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

export function ContributionChart({
  days,
  goal,
}: {
  days: WritingStats["days"];
  goal: number | null;
}): ReactElement {
  const todayKey = localDateKey(new Date());
  const { cells, thresholds } = useMemo(() => {
    const [ty, tm, td] = todayKey.split("-").map(Number);
    const today = new Date(ty, tm - 1, td);
    const end = addDays(today, 6 - today.getDay()); // Saturday of this week
    const start = addDays(end, -(WEEKS * DAYS_IN_WEEK - 1)); // Sunday, WEEKS back
    const list: Array<{ key: string; isFuture: boolean }> = [];
    for (let i = 0; i < WEEKS * DAYS_IN_WEEK; i += 1) {
      const key = localDateKey(addDays(start, i));
      list.push({ key, isFuture: key > todayKey });
    }
    const values = list.map((c) => days[c.key]?.added ?? 0).filter((v) => v > 0);
    return { cells: list, thresholds: computeThresholds(values) };
  }, [days, todayKey]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <CalendarGrid ariaLabel="Activity chart">
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
                  <ActivityTooltipContent date={formatLongDate(cell.key)} day={day} />
                </TooltipContent>
              </Tooltip>
            );
          })}
        </CalendarGrid>

        <div className="flex items-center justify-end gap-1 text-xs">
          <TypographyMutedSpan>Less</TypographyMutedSpan>
          {CELL_LEVEL_CLASSES.map((cls) => (
            <div key={cls} className={cn("size-3 rounded-[2px]", cls)} />
          ))}
          <TypographyMutedSpan>More</TypographyMutedSpan>
        </div>
      </div>

      {goal !== null ? (
        <div className="flex flex-col gap-2">
          <TypographySmall className="text-muted-foreground">Goal hits</TypographySmall>
          <CalendarGrid ariaLabel="Goal hits chart">
            {cells.map((cell) => {
              if (cell.isFuture) return <div key={cell.key} className="size-3" />;
              const day = days[cell.key];
              const metGoal = day !== undefined && dayMetGoal(day, goal);
              return (
                <Tooltip key={cell.key}>
                  <TooltipTrigger asChild>
                    <ContributionCell
                      level={0}
                      aria-label={`${formatLongDate(cell.key)} ${metGoal ? "goal hit" : "goal not hit"}`}
                      className={metGoal ? "bg-success" : undefined}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <GoalTooltipContent
                      date={formatLongDate(cell.key)}
                      day={day}
                      metGoal={metGoal}
                    />
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </CalendarGrid>
        </div>
      ) : null}
    </div>
  );
}

function CalendarGrid({
  ariaLabel,
  children,
}: {
  ariaLabel: string;
  children: ReactNode;
}): ReactElement {
  return (
    <ScrollArea dir="rtl">
      <div
        aria-label={ariaLabel}
        dir="ltr"
        className="grid grid-flow-col grid-rows-[repeat(7,minmax(0,1fr))] gap-[3px]"
      >
        {children}
      </div>
    </ScrollArea>
  );
}

function ActivityTooltipContent({
  date,
  day,
}: {
  date: string;
  day: WritingStats["days"][string] | undefined;
}): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <TypographySmall className="block font-medium">{date}</TypographySmall>
      {day && day.saves > 0 ? (
        <span className="font-mono tabular-nums">
          {day.added} word{day.added === 1 ? "" : "s"} - {day.saves} save
          {day.saves === 1 ? "" : "s"}
        </span>
      ) : (
        <span className="text-background/70">No writing</span>
      )}
    </div>
  );
}

function GoalTooltipContent({
  date,
  day,
  metGoal,
}: {
  date: string;
  day: WritingStats["days"][string] | undefined;
  metGoal: boolean;
}): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <TypographySmall className="block font-medium">{date}</TypographySmall>
      {day && day.saves > 0 ? (
        <span>{metGoal ? "Goal hit" : "Goal not hit"}</span>
      ) : (
        <span className="text-background/70">No writing</span>
      )}
    </div>
  );
}
