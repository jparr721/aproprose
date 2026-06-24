import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_SETTINGS } from "@/lib/types";

beforeEach(() => useSettingsStore.setState({ aiModel: DEFAULT_SETTINGS.aiModel }));

describe("settings-store aiModel", () => {
  it("defaults to null (no hardcoded model)", () => {
    expect(useSettingsStore.getState().aiModel).toBeNull();
  });

  it("setAiModel stores the selected model id", () => {
    useSettingsStore.getState().setAiModel("gpt-4.1-mini");
    expect(useSettingsStore.getState().aiModel).toBe("gpt-4.1-mini");
  });

  it("setAiModel(null) clears the selection", () => {
    useSettingsStore.getState().setAiModel("gpt-4.1-mini");
    useSettingsStore.getState().setAiModel(null);
    expect(useSettingsStore.getState().aiModel).toBeNull();
  });
});
