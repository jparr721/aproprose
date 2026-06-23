import { describe, it, expect, beforeEach, vi } from "vitest";

const { readAppData, writeAppData } = vi.hoisted(() => ({
  readAppData: vi.fn(),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/tauri", () => ({ readAppData, writeAppData }));

import {
  aiStateKey,
  toSnapshot,
  fromSnapshot,
  loadAiState,
  saveAiState,
  type PersistedAiState,
} from "@/stores/ai-persistence";
import { useAiCacheStore } from "@/stores/ai-cache-store";
import { useBrainstormStore } from "@/stores/brainstorm-store";

beforeEach(() => {
  readAppData.mockReset();
  writeAppData.mockClear();
  useAiCacheStore.setState({ entries: {} });
  useBrainstormStore.setState({ threads: {} });
});

describe("toSnapshot", () => {
  it("keeps only entries with data, normalizing loading/error, stamping v:1", () => {
    const snap = toSnapshot(
      {
        good: { data: { x: 1 }, loading: true, error: "boom", instruction: "go" },
        empty: { data: null, loading: true, error: null },
      },
      { ch1: [{ role: "user", content: "hi" }] },
    );
    expect(snap).toEqual({
      v: 1,
      entries: { good: { data: { x: 1 }, instruction: "go", loading: false, error: null } },
      threads: { ch1: [{ role: "user", content: "hi" }] },
    });
  });
});

describe("fromSnapshot", () => {
  it("returns empty maps for null or wrong-version input", () => {
    expect(fromSnapshot(null)).toEqual({ entries: {}, threads: {} });
    expect(fromSnapshot({ v: 2 } as unknown as PersistedAiState)).toEqual({ entries: {}, threads: {} });
  });

  it("round-trips a snapshot with loading forced false", () => {
    const snap = toSnapshot(
      { a: { data: 5, loading: false, error: null, instruction: "i" } },
      { ch: [{ role: "assistant", content: "y" }] },
    );
    expect(fromSnapshot(snap)).toEqual({
      entries: { a: { data: 5, instruction: "i", loading: false, error: null } },
      threads: { ch: [{ role: "assistant", content: "y" }] },
    });
  });
});

describe("loadAiState / saveAiState", () => {
  it("loadAiState reads the project key and hydrates both stores", async () => {
    readAppData.mockResolvedValue({
      v: 1,
      entries: { a: { data: 9, loading: true, error: null } },
      threads: { ch1: [{ role: "user", content: "hi" }] },
    } satisfies PersistedAiState);

    await loadAiState("/proj");

    expect(readAppData).toHaveBeenCalledWith(aiStateKey("/proj"));
    expect(useAiCacheStore.getState().entries.a).toEqual({ data: 9, instruction: undefined, loading: false, error: null });
    expect(useBrainstormStore.getState().threads.ch1).toEqual([{ role: "user", content: "hi" }]);
  });

  it("loadAiState resets to empty when no saved state exists", async () => {
    useAiCacheStore.setState({ entries: { stale: { data: 1, loading: false, error: null } } });
    readAppData.mockResolvedValue(null);
    await loadAiState("/proj");
    expect(useAiCacheStore.getState().entries).toEqual({});
  });

  it("saveAiState writes the filtered snapshot under the project key", async () => {
    useAiCacheStore.setState({
      entries: {
        keep: { data: { ok: true }, loading: false, error: null, instruction: "go" },
        drop: { data: null, loading: false, error: "x" },
      },
    });
    useBrainstormStore.setState({ threads: { ch1: [{ role: "user", content: "hi" }] } });

    await saveAiState("/proj");

    expect(writeAppData).toHaveBeenCalledWith(aiStateKey("/proj"), {
      v: 1,
      entries: { keep: { data: { ok: true }, instruction: "go", loading: false, error: null } },
      threads: { ch1: [{ role: "user", content: "hi" }] },
    });
  });
});
