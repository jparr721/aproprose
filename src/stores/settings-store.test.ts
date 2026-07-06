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
