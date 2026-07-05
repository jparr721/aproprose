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

beforeEach(() =>
  useSettingsStore.setState({
    aiModel: DEFAULT_SETTINGS.aiModel,
    aiProvider: DEFAULT_SETTINGS.aiProvider,
    styleGuide: DEFAULT_SETTINGS.styleGuide,
    editingRules: DEFAULT_SETTINGS.editingRules,
  }),
);

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

describe("settings-store aiProvider", () => {
  it("defaults to openai", () => {
    expect(useSettingsStore.getState().aiProvider).toBe("openai");
  });

  it("setAiProvider switches the active provider", () => {
    useSettingsStore.getState().setAiProvider("codex");
    expect(useSettingsStore.getState().aiProvider).toBe("codex");
    useSettingsStore.getState().setAiProvider("claude");
    expect(useSettingsStore.getState().aiProvider).toBe("claude");
  });
});

describe("settings-store author preferences", () => {
  it("styleGuide and editingRules default to empty strings", () => {
    expect(useSettingsStore.getState().styleGuide).toBe("");
    expect(useSettingsStore.getState().editingRules).toBe("");
  });

  it("setStyleGuide stores the voice text", () => {
    useSettingsStore.getState().setStyleGuide("Terse, tech-noir.");
    expect(useSettingsStore.getState().styleGuide).toBe("Terse, tech-noir.");
  });

  it("setEditingRules stores the editing text", () => {
    useSettingsStore.getState().setEditingRules("No adverbs.");
    expect(useSettingsStore.getState().editingRules).toBe("No adverbs.");
  });
});
