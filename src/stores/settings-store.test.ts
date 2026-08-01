import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_SETTINGS, PREFERENCE_MAX_CHARS } from "@/lib/types";

beforeEach(() =>
  useSettingsStore.setState({
    aiProvider: DEFAULT_SETTINGS.aiProvider,
    aiModel: DEFAULT_SETTINGS.aiModel,
    styleGuide: DEFAULT_SETTINGS.styleGuide,
    editingRules: DEFAULT_SETTINGS.editingRules,
    dailyWordGoal: DEFAULT_SETTINGS.dailyWordGoal,
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
  it("defaults to OpenAI", () => {
    expect(useSettingsStore.getState().aiProvider).toBe("openai");
  });

  it("switches providers and clears the incompatible model selection", () => {
    useSettingsStore.setState({ aiModel: "gpt-4.1-mini" });
    useSettingsStore.getState().setAiProvider("openrouter");
    expect(useSettingsStore.getState()).toMatchObject({
      aiProvider: "openrouter",
      aiModel: null,
    });
  });

  it("persists the active provider", () => {
    useSettingsStore.getState().setAiProvider("openrouter");
    const options = useSettingsStore.persist.getOptions();
    const persisted = options.partialize
      ? options.partialize(useSettingsStore.getState())
      : {};
    expect(persisted).toHaveProperty("aiProvider", "openrouter");
  });

  it("keeps supported provider values while merging persisted settings", () => {
    const options = useSettingsStore.persist.getOptions();
    if (!options.merge) {
      throw new Error("settings persistence must define a merge function");
    }
    const current = useSettingsStore.getState();
    const merged = options.merge(
      { aiProvider: "openrouter", aiModel: "anthropic/claude-sonnet-4" },
      current,
    );
    expect(merged.aiProvider).toBe("openrouter");
    expect(merged.aiModel).toBe("anthropic/claude-sonnet-4");
  });

  it("drops retired provider values while merging persisted settings", () => {
    const options = useSettingsStore.persist.getOptions();
    if (!options.merge) {
      throw new Error("settings persistence must define a merge function");
    }
    const current = useSettingsStore.getState();
    const merged = options.merge(
      { aiProvider: "codex", aiModel: "gpt-4.1-mini" },
      current,
    );
    expect(merged.aiProvider).toBe("openai");
    expect(merged.aiModel).toBeNull();
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

  it("clamps the setters to PREFERENCE_MAX_CHARS so the store never exceeds the cap", () => {
    useSettingsStore.getState().setStyleGuide("x".repeat(PREFERENCE_MAX_CHARS + 500));
    useSettingsStore.getState().setEditingRules("y".repeat(PREFERENCE_MAX_CHARS + 500));
    expect(useSettingsStore.getState().styleGuide).toHaveLength(PREFERENCE_MAX_CHARS);
    expect(useSettingsStore.getState().editingRules).toHaveLength(PREFERENCE_MAX_CHARS);
  });

  it("persists styleGuide and editingRules so they survive a relaunch", () => {
    useSettingsStore.setState({ styleGuide: "Terse.", editingRules: "No adverbs." });
    const opts = useSettingsStore.persist.getOptions();
    const persisted = opts.partialize ? opts.partialize(useSettingsStore.getState()) : {};
    expect(persisted).toMatchObject({ styleGuide: "Terse.", editingRules: "No adverbs." });
  });
});

describe("settings-store dailyWordGoal", () => {
  it("defaults to null (unset until the user opts in)", () => {
    expect(useSettingsStore.getState().dailyWordGoal).toBeNull();
  });

  it("setDailyWordGoal stores a positive integer goal", () => {
    useSettingsStore.getState().setDailyWordGoal(500);
    expect(useSettingsStore.getState().dailyWordGoal).toBe(500);
  });

  it("floors fractional goals to a whole word count", () => {
    useSettingsStore.getState().setDailyWordGoal(500.9);
    expect(useSettingsStore.getState().dailyWordGoal).toBe(500);
  });

  it("clamps a non-positive goal up to 1", () => {
    useSettingsStore.getState().setDailyWordGoal(0);
    expect(useSettingsStore.getState().dailyWordGoal).toBe(1);
    useSettingsStore.getState().setDailyWordGoal(-100);
    expect(useSettingsStore.getState().dailyWordGoal).toBe(1);
  });

  it("treats a non-finite goal as unset rather than persisting NaN/Infinity", () => {
    useSettingsStore.getState().setDailyWordGoal(500);
    useSettingsStore.getState().setDailyWordGoal(Number.NaN);
    expect(useSettingsStore.getState().dailyWordGoal).toBeNull();
    useSettingsStore.getState().setDailyWordGoal(Number.POSITIVE_INFINITY);
    expect(useSettingsStore.getState().dailyWordGoal).toBeNull();
  });

  it("setDailyWordGoal(null) clears the goal", () => {
    useSettingsStore.getState().setDailyWordGoal(500);
    useSettingsStore.getState().setDailyWordGoal(null);
    expect(useSettingsStore.getState().dailyWordGoal).toBeNull();
  });
});
