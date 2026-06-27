// stats.ts -- pure helpers over the writing-stats day log. No store, no IO.

import type { DayActivity, WritingStats } from "./schema";

/** Local-timezone YYYY-MM-DD so "today" matches the user's calendar. */
export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function previousDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - 1);
  return localDateKey(date);
}

function isActive(days: WritingStats["days"], key: string): boolean {
  const day = days[key];
  return day !== undefined && day.saves > 0;
}

export function totalWordsWritten(days: WritingStats["days"]): number {
  let total = 0;
  for (const key in days) total += days[key].added;
  return total;
}

export function daysWritten(days: WritingStats["days"]): number {
  let count = 0;
  for (const key in days) if (days[key].saves > 0) count += 1;
  return count;
}

export function wordsToday(days: WritingStats["days"], todayKey: string): number {
  const day = days[todayKey];
  return day ? day.added : 0;
}

/** Consecutive active days ending today; if today is blank, the run ending
 *  yesterday still counts (you can extend it before the day ends). */
export function currentStreak(days: WritingStats["days"], todayKey: string): number {
  let cursor = isActive(days, todayKey) ? todayKey : previousDayKey(todayKey);
  let streak = 0;
  while (isActive(days, cursor)) {
    streak += 1;
    cursor = previousDayKey(cursor);
  }
  return streak;
}

export function longestStreak(days: WritingStats["days"]): number {
  const activeKeys = Object.keys(days)
    .filter((k) => days[k].saves > 0)
    .sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const key of activeKeys) {
    run = prev !== null && previousDayKey(key) === prev ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = key;
  }
  return longest;
}

/** Percentile buckets over the non-zero "added" values, for heatmap shading. */
export function computeThresholds(values: number[]): [number, number, number, number] {
  const nonZero = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) return [1, 2, 3, 4];
  const p25 = nonZero[Math.floor(nonZero.length * 0.25)] ?? 1;
  const p50 = nonZero[Math.floor(nonZero.length * 0.5)] ?? 2;
  const p75 = nonZero[Math.floor(nonZero.length * 0.75)] ?? 3;
  const max = nonZero[nonZero.length - 1] ?? 4;
  return [p25, p50, p75, max];
}

function getLevel(value: number, thresholds: [number, number, number, number]): number {
  if (value <= 0) return 0;
  if (value <= thresholds[0]) return 1;
  if (value <= thresholds[1]) return 2;
  if (value <= thresholds[2]) return 3;
  return 4;
}

/** Heatmap intensity 0-4. Any day with a save lights up (min level 1), even a
 *  delete-only day - we reward showing up and writing, not just net growth. */
export function cellLevel(
  day: DayActivity | undefined,
  thresholds: [number, number, number, number],
): number {
  if (!day || day.saves === 0) return 0;
  return Math.max(1, getLevel(day.added, thresholds));
}
