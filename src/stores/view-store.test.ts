import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

import { useViewStore } from "@/stores/view-store";

beforeEach(() => useViewStore.setState({ aiTab: "suggest", aiCollapsed: false }));

describe("view-store aiTab", () => {
  it("setAiTab switches the active tab, including the new 'edit' tab", () => {
    useViewStore.getState().setAiTab("edit");
    expect(useViewStore.getState().aiTab).toBe("edit");
  });
});

describe("view-store aiCollapsed", () => {
  it("defaults to false and setAiCollapsed flips it", () => {
    expect(useViewStore.getState().aiCollapsed).toBe(false);
    useViewStore.getState().setAiCollapsed(true);
    expect(useViewStore.getState().aiCollapsed).toBe(true);
  });

  it("triggerSuggest expands the panel and selects Suggest", () => {
    useViewStore.setState({ aiCollapsed: true, aiTab: "cast" });
    useViewStore.getState().triggerSuggest();
    expect(useViewStore.getState().aiCollapsed).toBe(false);
    expect(useViewStore.getState().aiTab).toBe("suggest");
  });
});
