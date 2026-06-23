import { describe, it, expect, beforeEach } from "vitest";
import { useAiCacheStore } from "@/stores/ai-cache-store";

beforeEach(() => useAiCacheStore.setState({ entries: {} }));

describe("ai-cache-store", () => {
  it("patch merges partial entries by key", () => {
    useAiCacheStore.getState().patch("k", { loading: true, error: null });
    useAiCacheStore.getState().patch("k", { data: 42, loading: false });
    expect(useAiCacheStore.getState().entries.k).toEqual({
      loading: false,
      error: null,
      data: 42,
    });
  });

  it("hydrate replaces entries and forces loading to false", () => {
    useAiCacheStore.getState().patch("stale", { loading: true, data: 1, error: null });
    useAiCacheStore.getState().hydrate({
      a: { data: "x", loading: true, error: null, instruction: "go" },
    });
    const { entries } = useAiCacheStore.getState();
    expect(entries.stale).toBeUndefined();
    expect(entries.a).toEqual({ data: "x", loading: false, error: null, instruction: "go" });
  });

  it("reset clears all entries", () => {
    useAiCacheStore.getState().patch("k", { data: 1, loading: false, error: null });
    useAiCacheStore.getState().reset();
    expect(useAiCacheStore.getState().entries).toEqual({});
  });
});
