// @vitest-environment happy-dom
//
import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// view-store (reached via ai-activity-store) persists through the Tauri bridge;
// stub it so importing the hook neither hits native APIs nor matters here.
vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));

import { useAi } from "@/hooks/use-ai";
import { useAiCacheStore } from "@/stores/ai-cache-store";
import { useAiActivityStore } from "@/stores/ai-activity-store";
import { useViewStore } from "@/stores/view-store";

// Let the queued microtasks (the op's promise chain) settle.
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  useAiCacheStore.setState({ entries: {} });
  useAiActivityStore.setState({ status: {} });
  // Looking at another tab, so a finished suggest job flags the rail rather than
  // clearing (the panel isn't watching suggest).
  useViewStore.setState({ aiOpen: true, focus: false, aiCollapsed: false, aiTab: "outline" });
});

describe("useAi", () => {
  it("a resolved op stores the result and flags the tab done", async () => {
    const { result } = renderHook(() =>
      useAi<string>(async () => "RESULT", "k-ok", "suggest"),
    );
    await act(async () => {
      result.current.run("go");
    });
    await flush();
    expect(useAiCacheStore.getState().entries["k-ok"].data).toBe("RESULT");
    expect(useAiCacheStore.getState().entries["k-ok"].loading).toBe(false);
    expect(useAiActivityStore.getState().status.suggest).toBe("done");
  });

  it("a rejected op records the error and flags the tab failed", async () => {
    const { result } = renderHook(() =>
      useAi<string>(async () => {
        throw new Error("async boom");
      }, "k-reject", "suggest"),
    );
    await act(async () => {
      result.current.run("go");
    });
    await flush();
    const entry = useAiCacheStore.getState().entries["k-reject"];
    expect(entry.loading).toBe(false);
    expect(entry.error).toBeTruthy();
    expect(useAiActivityStore.getState().status.suggest).toBe("failed");
  });

  it("a synchronous throw in the op clears loading and flags failed, not stuck running", async () => {
    // buildSuggestContext / buildEditRequest run synchronously inside the op before
    // it returns a promise; a throw there must not escape run() and wedge the tab.
    const { result } = renderHook(() =>
      useAi<string>(() => {
        throw new Error("sync boom");
      }, "k-sync", "suggest"),
    );
    await act(async () => {
      result.current.run("go");
    });
    await flush();
    const entry = useAiCacheStore.getState().entries["k-sync"];
    expect(entry.loading).toBe(false);
    expect(entry.error).toBeTruthy();
    expect(useAiActivityStore.getState().status.suggest).toBe("failed");
  });
});
