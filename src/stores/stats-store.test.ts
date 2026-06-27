import { describe, it, expect, beforeEach, vi } from "vitest";

const { storage } = vi.hoisted(() => ({ storage: { value: null as string | null } }));
vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => storage.value,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

import { useStatsStore } from "@/stores/stats-store";

beforeEach(() => {
  storage.value = null;
  useStatsStore.setState({ baselines: {}, days: {} });
});

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

describe("hydration ordering", () => {
  const PERSISTED_JSON = JSON.stringify({
    state: {
      baselines: { "/a": 500 },
      days: { "2026-06-20": { added: 100, removed: 0, saves: 1 } },
    },
    version: 1,
  });

  it("hazard: write-before-rehydrate is clobbered by the destructive merge", async () => {
    storage.value = PERSISTED_JSON;

    // Simulate the racing pre-hydration write (init auto-open path).
    useStatsStore.getState().noteBaseline("/b", 100);
    expect(useStatsStore.getState().baselines["/b"]).toBe(100);

    // Hydration runs after the write - the merge replaces baselines wholesale.
    await useStatsStore.persist.rehydrate();

    // The pre-hydration write to /b is gone.
    expect(useStatsStore.getState().baselines["/b"]).toBeUndefined();
    // The persisted /a is present.
    expect(useStatsStore.getState().baselines["/a"]).toBe(500);
  });

  it("fixed contract: rehydrate-before-write preserves both persisted history and new write", async () => {
    storage.value = PERSISTED_JSON;

    // Hydration first - matches what init() now does.
    await useStatsStore.persist.rehydrate();

    // Write after hydration.
    useStatsStore.getState().noteBaseline("/b", 100);

    // Persisted history survives.
    expect(useStatsStore.getState().baselines["/a"]).toBe(500);
    expect(useStatsStore.getState().days["2026-06-20"]).toEqual({
      added: 100,
      removed: 0,
      saves: 1,
    });
    // New write is kept.
    expect(useStatsStore.getState().baselines["/b"]).toBe(100);
  });
});
