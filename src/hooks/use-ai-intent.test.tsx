// @vitest-environment happy-dom
//
import { renderHook, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));

import { useAiIntent } from "@/hooks/use-ai-intent";
import { useAiIntentStore, dispatchAiIntent } from "@/stores/ai-intent-store";

afterEach(() => cleanup());

beforeEach(() => {
  useAiIntentStore.setState({ pending: null });
});

describe("useAiIntent", () => {
  it("fires once for an intent parked before mount, then clears it", () => {
    dispatchAiIntent({ tab: "suggest", instruction: "go" });
    const onIntent = vi.fn();
    renderHook(() => useAiIntent("suggest", onIntent));
    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(onIntent).toHaveBeenCalledWith({ tab: "suggest", instruction: "go" });
    expect(useAiIntentStore.getState().pending).toBeNull();
  });

  it("fires for an intent dispatched while mounted", () => {
    const onIntent = vi.fn();
    renderHook(() => useAiIntent("edit", onIntent));
    act(() => dispatchAiIntent({ tab: "edit", blockIds: ["b1"] }));
    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(onIntent).toHaveBeenCalledWith({ tab: "edit", blockIds: ["b1"] });
  });

  it("ignores intents for other tabs and leaves them parked", () => {
    const onIntent = vi.fn();
    renderHook(() => useAiIntent("suggest", onIntent));
    act(() => dispatchAiIntent({ tab: "edit" }));
    expect(onIntent).not.toHaveBeenCalled();
    expect(useAiIntentStore.getState().pending).toEqual({ tab: "edit" });
  });

  it("does not re-fire when re-renders hand it a fresh closure", () => {
    const onIntent = vi.fn();
    const { rerender } = renderHook(() => useAiIntent("suggest", () => onIntent()));
    act(() => dispatchAiIntent({ tab: "suggest" }));
    rerender();
    rerender();
    expect(onIntent).toHaveBeenCalledTimes(1);
  });
});
