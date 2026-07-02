import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));

import { useAiIntentStore, dispatchAiIntent } from "@/stores/ai-intent-store";
import { useViewStore } from "@/stores/view-store";

beforeEach(() => {
  useAiIntentStore.setState({ pending: null });
  useViewStore.setState({ aiOpen: false, aiCollapsed: true, aiTab: "critique", focus: true });
});

describe("dispatch", () => {
  it("parks the intent and opens the panel on its tab", () => {
    dispatchAiIntent({ tab: "suggest", instruction: "go" });
    expect(useAiIntentStore.getState().pending).toEqual({ tab: "suggest", instruction: "go" });
    const v = useViewStore.getState();
    expect(v.aiOpen).toBe(true);
    expect(v.aiTab).toBe("suggest");
    expect(v.aiCollapsed).toBe(false);
    expect(v.focus).toBe(false);
  });

  it("a later dispatch replaces the parked intent", () => {
    dispatchAiIntent({ tab: "suggest" });
    dispatchAiIntent({ tab: "edit", blockIds: ["b1"] });
    expect(useAiIntentStore.getState().pending).toEqual({ tab: "edit", blockIds: ["b1"] });
  });
});

describe("consume", () => {
  it("returns and clears a pending intent that targets the tab", () => {
    dispatchAiIntent({ tab: "edit", blockIds: ["b1"] });
    expect(useAiIntentStore.getState().consume("edit")).toEqual({ tab: "edit", blockIds: ["b1"] });
    expect(useAiIntentStore.getState().pending).toBeNull();
  });

  it("returns null and leaves the intent parked when the tab does not match", () => {
    dispatchAiIntent({ tab: "edit" });
    expect(useAiIntentStore.getState().consume("suggest")).toBeNull();
    expect(useAiIntentStore.getState().pending).toEqual({ tab: "edit" });
  });

  it("returns null when nothing is pending", () => {
    expect(useAiIntentStore.getState().consume("edit")).toBeNull();
  });
});
