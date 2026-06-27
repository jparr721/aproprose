import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

import { useStatsStore } from "@/stores/stats-store";

beforeEach(() => useStatsStore.setState({ baselines: {}, days: {} }));

function onlyDay() {
  const days = useStatsStore.getState().days;
  const keys = Object.keys(days);
  if (keys.length === 0) throw new Error("no day entries recorded");
  return days[keys[0]];
}

describe("stats-store", () => {
  it("noteBaseline seeds the per-project baseline", () => {
    useStatsStore.getState().noteBaseline("/a", 500);
    expect(useStatsStore.getState().baselines["/a"]).toBe(500);
  });

  it("positive delta increments added and saves", () => {
    useStatsStore.getState().noteBaseline("/a", 500);
    useStatsStore.getState().recordSave("/a", 620);
    expect(onlyDay()).toEqual({ added: 120, removed: 0, saves: 1 });
    expect(useStatsStore.getState().baselines["/a"]).toBe(620);
  });

  it("negative delta increments removed but not added", () => {
    useStatsStore.getState().noteBaseline("/a", 500);
    useStatsStore.getState().recordSave("/a", 460);
    expect(onlyDay()).toEqual({ added: 0, removed: 40, saves: 1 });
  });

  it("zero delta still counts as a save (active day)", () => {
    useStatsStore.getState().noteBaseline("/a", 500);
    useStatsStore.getState().recordSave("/a", 500);
    expect(onlyDay()).toEqual({ added: 0, removed: 0, saves: 1 });
  });

  it("multiple projects accumulate into one global day", () => {
    useStatsStore.getState().noteBaseline("/a", 100);
    useStatsStore.getState().noteBaseline("/b", 200);
    useStatsStore.getState().recordSave("/a", 150); // +50
    useStatsStore.getState().recordSave("/b", 260); // +60
    expect(onlyDay()).toEqual({ added: 110, removed: 0, saves: 2 });
  });

  it("recordSave without a prior baseline records a zero-delta save", () => {
    useStatsStore.getState().recordSave("/fresh", 999);
    expect(onlyDay()).toEqual({ added: 0, removed: 0, saves: 1 });
    expect(useStatsStore.getState().baselines["/fresh"]).toBe(999);
  });
});
