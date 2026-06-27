import {
  TypographyEyebrow,
  TypographyMuted,
  TypographyStat,
} from "@/components/ui/typography";
import { ContributionChart } from "@/components/app/stats/contribution-chart";
import { useStatsStore } from "@/stores/stats-store";
import {
  currentStreak,
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
        <TypographyMuted className="font-sans text-xs">{caption}</TypographyMuted>
      ) : null}
    </div>
  );
}

export function StatsTab() {
  const days = useStatsStore((s) => s.days);
  const todayKey = localDateKey(new Date());
  const total = totalWordsWritten(days);
  const written = daysWritten(days);
  const streak = currentStreak(days, todayKey);
  const longest = longestStreak(days);
  const today = wordsToday(days, todayKey);

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
          caption={longest > 0 ? `Best: ${longest}` : undefined}
        />
      </div>
      <div className="flex flex-col gap-2">
        <TypographyEyebrow>Activity</TypographyEyebrow>
        <div className="rounded-lg border bg-card p-3">
          <ContributionChart days={days} />
        </div>
      </div>
    </div>
  );
}
