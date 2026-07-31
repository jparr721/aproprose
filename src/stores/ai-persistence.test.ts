// @vitest-environment happy-dom
//
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  resetAiStores,
  useAiPersistence,
  type PersistedAiState,
} from "@/stores/ai-persistence";
import { useAiCacheStore } from "@/stores/ai-cache-store";
import { useAiActivityStore } from "@/stores/ai-activity-store";
import { useBrainstormStore } from "@/stores/brainstorm-store";
import { useOutlineGuideStore } from "@/stores/outline-guide-store";
import { useProjectStore } from "@/stores/project-store";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

afterEach(() => cleanup());

beforeEach(() => {
  readAppData.mockReset();
  writeAppData.mockClear();
  useAiCacheStore.setState({ entries: {} });
  useBrainstormStore.setState({ threads: {} });
  useOutlineGuideStore.getState().reset();
  useAiActivityStore.setState({ status: {} });
  useProjectStore.setState({ project: null } as never);
});

describe("resetAiStores", () => {
  it("clears the cache, brainstorm, outline guide, and activity stores on project switch", () => {
    useAiCacheStore.setState({ entries: { a: { data: 1, loading: false, error: null } } });
    useBrainstormStore.setState({ threads: { c: [{ role: "user", content: "x" }] } });
    useOutlineGuideStore.getState().hydrate({
      c: { messages: [{ role: "user", content: "plan it" }], plan: null },
    });
    useAiActivityStore.setState({ status: { suggest: "done" } });

    resetAiStores();

    expect(useAiCacheStore.getState().entries).toEqual({});
    expect(useBrainstormStore.getState().threads).toEqual({});
    expect(useOutlineGuideStore.getState().sessions).toEqual({});
    expect(useAiActivityStore.getState().status).toEqual({});
  });
});

describe("toSnapshot", () => {
  it("keeps settled AI data and stamps the guided-outline schema version", () => {
    const snap = toSnapshot(
      {
        good: { data: { x: 1 }, loading: true, error: "boom", instruction: "go" },
        empty: { data: null, loading: true, error: null },
      },
      { ch1: [{ role: "user", content: "hi" }] },
      {
        ch1: {
          messages: [{ role: "user", content: "The letter arrives at dawn." }],
          plan: null,
        },
      },
    );
    expect(snap).toEqual({
      v: 3,
      entries: { good: { data: { x: 1 }, instruction: "go", loading: false, error: null } },
      threads: { ch1: [{ role: "user", content: "hi" }] },
      outlineSessions: {
        ch1: {
          messages: [{ role: "user", content: "The letter arrives at dawn." }],
          plan: null,
        },
      },
    });
  });
});

describe("fromSnapshot", () => {
  it("returns empty maps for null or wrong-version input", () => {
    expect(fromSnapshot(null)).toEqual({ entries: {}, threads: {}, outlineSessions: {} });
    expect(fromSnapshot({ v: 99 } as unknown as PersistedAiState)).toEqual({
      entries: {},
      threads: {},
      outlineSessions: {},
    });
  });

  it("round-trips a snapshot with loading forced false", () => {
    const snap = toSnapshot(
      { a: { data: 5, loading: false, error: null, instruction: "i" } },
      { ch: [{ role: "assistant", content: "y" }] },
      { ch: { messages: [{ role: "user", content: "z" }], plan: null } },
    );
    expect(fromSnapshot(snap)).toEqual({
      entries: { a: { data: 5, instruction: "i", loading: false, error: null } },
      threads: { ch: [{ role: "assistant", content: "y" }] },
      outlineSessions: {
        ch: { messages: [{ role: "user", content: "z" }], plan: null },
      },
    });
  });

  it("round-trips a Suggest anchor id so the frozen anchor survives a restart", () => {
    const snap = toSnapshot(
      { s: { data: { x: 1 }, loading: false, error: null, anchorId: "blk-7" } },
      {},
      {},
    );
    expect(snap.entries.s.anchorId).toBe("blk-7");
    expect(fromSnapshot(snap).entries.s.anchorId).toBe("blk-7");
  });

  it("keeps threads and drops entries from a v1 blob (cached shapes changed)", () => {
    expect(
      fromSnapshot({
        v: 1,
        entries: { a: { data: 7, loading: false, error: null } },
        threads: { ch: [{ role: "user", content: "hi" }] },
      } as unknown as PersistedAiState),
    ).toEqual({
      entries: {},
      threads: { ch: [{ role: "user", content: "hi" }] },
      outlineSessions: {},
    });
  });

  it("tolerates a v1 blob missing the threads field", () => {
    expect(
      fromSnapshot({ v: 1, entries: {} } as unknown as PersistedAiState),
    ).toEqual({ entries: {}, threads: {}, outlineSessions: {} });
  });

  it("loads v2 cache and brainstorm data with no guided sessions", () => {
    expect(
      fromSnapshot({
        v: 2,
        entries: { a: { data: 7, loading: true, error: "old" } },
        threads: { ch: [{ role: "user", content: "hi" }] },
      } as unknown as PersistedAiState),
    ).toEqual({
      entries: {
        a: {
          data: 7,
          instruction: undefined,
          anchorId: undefined,
          loading: false,
          error: null,
        },
      },
      threads: { ch: [{ role: "user", content: "hi" }] },
      outlineSessions: {},
    });
  });

  it("discards malformed guided-outline sessions instead of passing them to the UI", () => {
    expect(
      fromSnapshot({
        v: 3,
        entries: {},
        threads: {},
        outlineSessions: {
          ch1: { messages: "not an array", plan: null },
        },
      } as unknown as PersistedAiState),
    ).toEqual({ entries: {}, threads: {}, outlineSessions: {} });
  });
});

describe("loadAiState / saveAiState", () => {
  it("loadAiState reads the project key and hydrates both stores", async () => {
    readAppData.mockResolvedValue({
      v: 3,
      entries: { a: { data: 9, loading: true, error: null } },
      threads: { ch1: [{ role: "user", content: "hi" }] },
      outlineSessions: {
        ch1: { messages: [{ role: "user", content: "plan it" }], plan: null },
      },
    } satisfies PersistedAiState);

    await loadAiState("/proj", () => true);

    expect(readAppData).toHaveBeenCalledWith(aiStateKey("/proj"));
    expect(useAiCacheStore.getState().entries.a).toEqual({ data: 9, instruction: undefined, loading: false, error: null });
    expect(useBrainstormStore.getState().threads.ch1).toEqual([{ role: "user", content: "hi" }]);
    expect(useOutlineGuideStore.getState().sessions.ch1.messages).toEqual([
      { role: "user", content: "plan it" },
    ]);
  });

  it("loadAiState resets all AI stores when no saved state exists", async () => {
    useAiCacheStore.setState({ entries: { stale: { data: 1, loading: false, error: null } } });
    useBrainstormStore.setState({ threads: { old: [{ role: "user", content: "x" }] } });
    useOutlineGuideStore.getState().hydrate({
      old: { messages: [{ role: "user", content: "x" }], plan: null },
    });
    readAppData.mockResolvedValue(null);
    await loadAiState("/proj", () => true);
    expect(useAiCacheStore.getState().entries).toEqual({});
    expect(useBrainstormStore.getState().threads).toEqual({});
    expect(useOutlineGuideStore.getState().sessions).toEqual({});
  });

  it("saveAiState writes the filtered snapshot under the project key", async () => {
    useAiCacheStore.setState({
      entries: {
        keep: { data: { ok: true }, loading: false, error: null, instruction: "go" },
        drop: { data: null, loading: false, error: "x" },
      },
    });
    useBrainstormStore.setState({ threads: { ch1: [{ role: "user", content: "hi" }] } });
    useOutlineGuideStore.getState().hydrate({
      ch1: { messages: [{ role: "assistant", content: "One question." }], plan: null },
    });

    await saveAiState("/proj");

    expect(writeAppData).toHaveBeenCalledWith(aiStateKey("/proj"), {
      v: 3,
      entries: { keep: { data: { ok: true }, instruction: "go", loading: false, error: null } },
      threads: { ch1: [{ role: "user", content: "hi" }] },
      outlineSessions: {
        ch1: { messages: [{ role: "assistant", content: "One question." }], plan: null },
      },
    });
  });

  it("loadAiState swallows a corrupt/unreadable blob and hydrates empty (does not throw)", async () => {
    useAiCacheStore.setState({ entries: { stale: { data: 1, loading: false, error: null } } });
    useBrainstormStore.setState({ threads: { old: [{ role: "user", content: "x" }] } });
    useOutlineGuideStore.getState().hydrate({
      old: { messages: [{ role: "user", content: "x" }], plan: null },
    });
    readAppData.mockRejectedValue(new Error("Unexpected token in JSON"));

    await expect(loadAiState("/proj", () => true)).resolves.toBe(true);
    expect(useAiCacheStore.getState().entries).toEqual({});
    expect(useBrainstormStore.getState().threads).toEqual({});
    expect(useOutlineGuideStore.getState().sessions).toEqual({});
  });

  it("does not hydrate a cancelled project load after a later project has loaded", async () => {
    const first = deferred<PersistedAiState | null>();
    const second = deferred<PersistedAiState | null>();
    const third = deferred<PersistedAiState | null>();
    readAppData
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);

    useProjectStore.setState({ project: { root: "/a" } } as never);
    renderHook(() => useAiPersistence());

    await waitFor(() => {
      expect(readAppData).toHaveBeenCalledTimes(1);
    });

    act(() => {
      useProjectStore.setState({ project: { root: "/b" } } as never);
    });
    await waitFor(() => {
      expect(readAppData).toHaveBeenCalledTimes(2);
    });

    act(() => {
      useProjectStore.setState({ project: { root: "/c" } } as never);
    });
    await waitFor(() => {
      expect(readAppData).toHaveBeenCalledTimes(3);
    });

    await act(async () => {
      third.resolve({ v: 3, entries: { c: { data: "C", loading: false, error: null } }, threads: {}, outlineSessions: {} });
      await third.promise;
    });

    await act(async () => {
      second.resolve({ v: 3, entries: { b: { data: "B", loading: false, error: null } }, threads: {}, outlineSessions: {} });
      await second.promise;
    });

    expect(useAiCacheStore.getState().entries).toEqual({
      c: { data: "C", instruction: undefined, anchorId: undefined, loading: false, error: null },
    });
  });
});
