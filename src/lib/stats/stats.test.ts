import { describe, it, expect } from "vitest";
import {
  localDateKey,
  totalWordsWritten,
  daysWritten,
  wordsToday,
  currentStreak,
  longestStreak,
  computeThresholds,
  cellLevel,
} from "@/lib/stats/stats";
import { WritingStatsSchema, type WritingStats } from "@/lib/stats/schema";

function day(added: number, removed: number, saves: number) {
  return { added, removed, saves };
}

describe("localDateKey", () => {
  it("formats local year-month-day, zero-padded", () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(localDateKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("totals", () => {
  const days: WritingStats["days"] = {
    "2026-06-20": day(100, 0, 1),
    "2026-06-21": day(0, 50, 2), // delete-only: active, nothing added
    "2026-06-22": day(30, 5, 1),
  };
  it("totalWordsWritten sums added and ignores removed (monotonic)", () => {
    expect(totalWordsWritten(days)).toBe(130);
  });
  it("daysWritten counts every day with a save, including delete-only", () => {
    expect(daysWritten(days)).toBe(3);
  });
  it("wordsToday returns added for the key, 0 when missing", () => {
    expect(wordsToday(days, "2026-06-22")).toBe(30);
    expect(wordsToday(days, "2026-06-25")).toBe(0);
  });
});

describe("currentStreak", () => {
  it("counts consecutive active days ending today", () => {
    const days = { "2026-06-24": day(1, 0, 1), "2026-06-25": day(1, 0, 1), "2026-06-26": day(1, 0, 1) };
    expect(currentStreak(days, "2026-06-26")).toBe(3);
  });
  it("stays alive when today is not yet written but yesterday was", () => {
    const days = { "2026-06-24": day(1, 0, 1), "2026-06-25": day(1, 0, 1) };
    expect(currentStreak(days, "2026-06-26")).toBe(2);
  });
  it("a delete-only day keeps the streak alive", () => {
    const days = { "2026-06-25": day(1, 0, 1), "2026-06-26": day(0, 40, 2) };
    expect(currentStreak(days, "2026-06-26")).toBe(2);
  });
  it("is 0 when the latest active day is older than yesterday", () => {
    expect(currentStreak({ "2026-06-20": day(1, 0, 1) }, "2026-06-26")).toBe(0);
  });
  it("is 0 for an empty log", () => {
    expect(currentStreak({}, "2026-06-26")).toBe(0);
  });
  it("counts across a month boundary", () => {
    const days = { "2026-05-31": day(1, 0, 1), "2026-06-01": day(1, 0, 1) };
    expect(currentStreak(days, "2026-06-01")).toBe(2);
  });
  it("counts across a year boundary", () => {
    const days = { "2025-12-31": day(1, 0, 1), "2026-01-01": day(1, 0, 1) };
    expect(currentStreak(days, "2026-01-01")).toBe(2);
  });
});

describe("longestStreak", () => {
  it("finds the longest consecutive run across gaps", () => {
    const days = {
      "2026-06-01": day(1, 0, 1),
      "2026-06-02": day(1, 0, 1),
      "2026-06-10": day(1, 0, 1),
      "2026-06-11": day(1, 0, 1),
      "2026-06-12": day(1, 0, 1),
    };
    expect(longestStreak(days)).toBe(3);
  });
  it("is 0 for an empty log", () => {
    expect(longestStreak({})).toBe(0);
  });
  it("is 1 for a single active day", () => {
    expect(longestStreak({ "2026-06-15": day(1, 0, 1) })).toBe(1);
  });
});

describe("cellLevel", () => {
  const t: [number, number, number, number] = [10, 50, 200, 1000];
  it("is 0 for no activity", () => {
    expect(cellLevel(undefined, t)).toBe(0);
    expect(cellLevel(day(0, 0, 0), t)).toBe(0);
  });
  it("is at least 1 for a save that added nothing (delete-only)", () => {
    expect(cellLevel(day(0, 40, 1), t)).toBe(1);
  });
  it("scales up with words added", () => {
    expect(cellLevel(day(5, 0, 1), t)).toBe(1);
    expect(cellLevel(day(1500, 0, 1), t)).toBe(4);
  });
});

describe("computeThresholds", () => {
  it("returns fallback [1, 2, 3, 4] for empty input", () => {
    expect(computeThresholds([])).toEqual([1, 2, 3, 4]);
  });
  it("computes thresholds for a 2-element input without index underrun", () => {
    expect(computeThresholds([100, 200])).toEqual([100, 200, 200, 200]);
  });
  it("filters out zeros and negatives, returning uniform thresholds for single value", () => {
    expect(computeThresholds([0, 0, 10])).toEqual([10, 10, 10, 10]);
  });
  it("computes percentiles from a single positive value", () => {
    expect(computeThresholds([5])).toEqual([5, 5, 5, 5]);
  });
  it("computes quartiles from a 4-element sorted array", () => {
    expect(computeThresholds([10, 20, 30, 40])).toEqual([20, 30, 40, 40]);
  });
  it("sorts unsorted input before computing thresholds", () => {
    expect(computeThresholds([40, 10, 30, 20])).toEqual([20, 30, 40, 40]);
  });
});

describe("WritingStatsSchema", () => {
  it("accepts a well-formed shape", () => {
    const ok = WritingStatsSchema.safeParse({
      baselines: { "/a": 10 },
      days: { "2026-06-26": { added: 5, removed: 0, saves: 1 } },
    });
    expect(ok.success).toBe(true);
  });
  it("rejects negative counters", () => {
    const bad = WritingStatsSchema.safeParse({
      baselines: {},
      days: { "2026-06-26": { added: -1, removed: 0, saves: 1 } },
    });
    expect(bad.success).toBe(false);
  });
  it("rejects a missing field", () => {
    const bad = WritingStatsSchema.safeParse({ baselines: {} });
    expect(bad.success).toBe(false);
  });
});
