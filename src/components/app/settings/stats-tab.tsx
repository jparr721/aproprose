import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  TypographyEyebrow,
  TypographyMuted,
  TypographyStat,
} from "@/components/ui/typography";
import { ContributionChart } from "@/components/app/stats/contribution-chart";
import { DailyGoalInput } from "@/components/app/daily-goal-input";
import { useStatsStore } from "@/stores/stats-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  currentStreak,
  daysGoalMet,
  daysWritten,
  localDateKey,
  longestStreak,
  totalWordsWritten,
  wordsToday,
} from "@/lib/stats/stats";

function StatCell({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <div className="flex flex-col gap-1 p-3">
      <TypographyEyebrow>{label}</TypographyEyebrow>
      <TypographyStat>{value}</TypographyStat>
      {caption ? (
        <TypographyMuted className="text-xs">{caption}</TypographyMuted>
      ) : null}
    </div>
  );
}

export function StatsTab() {
  const days = useStatsStore((s) => s.days);
  const goal = useSettingsStore((s) => s.dailyWordGoal);
  const setGoal = useSettingsStore((s) => s.setDailyWordGoal);
  const todayKey = localDateKey(new Date());
  const total = totalWordsWritten(days);
  const written = daysWritten(days);
  const streak = currentStreak(days, todayKey);
  const longest = longestStreak(days);
  const today = wordsToday(days, todayKey);
  const hit = goal !== null ? daysGoalMet(days, goal) : 0;
  const missed = written - hit;
  const attainment = written > 0 ? Math.round((hit / written) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 divide-x overflow-hidden rounded-lg border bg-card">
        <StatCell
          label="Words written"
          value={total.toLocaleString()}
          caption={`${today.toLocaleString()} today`}
        />
        <StatCell label="Days written" value={written.toLocaleString()} />
        <StatCell
          label="Current streak"
          value={`${streak} day${streak === 1 ? "" : "s"}`}
          caption={longest > 0 ? `Best: ${longest.toLocaleString()}` : undefined}
        />
      </div>

      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
        <div className="flex items-center justify-between gap-3">
          <TypographyEyebrow>Daily goal</TypographyEyebrow>
          <DailyGoalInput
            value={goal}
            submitLabel={goal === null ? "Set" : "Save"}
            onSubmit={setGoal}
            className="w-52"
          />
        </div>
        {goal === null ? (
          <TypographyMuted className="text-xs">
            Set a goal to track how often you hit it.
          </TypographyMuted>
        ) : (
          <>
            {written === 0 ? (
              <TypographyMuted className="text-xs">
                Start writing to track your goal.
              </TypographyMuted>
            ) : (
              <div className="flex items-center gap-4">
                <TypographyStat className="text-2xl">{attainment}%</TypographyStat>
                <Progress
                  value={attainment}
                  className="h-2 flex-1 [&>[data-slot=progress-indicator]]:bg-success"
                />
                <TypographyMuted className="text-xs">
                  Hit your goal on {hit.toLocaleString()} of {written.toLocaleString()} writing day
                  {written === 1 ? "" : "s"}.
                  {missed > 0 ? ` ${missed.toLocaleString()} fell short.` : ""}
                </TypographyMuted>
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 self-start px-2 text-muted-foreground"
              onClick={() => setGoal(null)}
            >
              Remove goal
            </Button>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <TypographyEyebrow>Activity</TypographyEyebrow>
        <div className="rounded-lg border bg-card p-3">
          <ContributionChart days={days} goal={goal} />
        </div>
      </div>
    </div>
  );
}
