import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@/lib/tauri", () => ({
  getAiConfig: vi.fn(async () => ({ apiKey: "sk-test" })),
}));
vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: { getState: vi.fn() },
}));

import { getModel, resetAiProvider } from "@/lib/ai/model";
import { useSettingsStore } from "@/stores/settings-store";

const setSelected = (aiModel: string | null) =>
  (useSettingsStore.getState as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    aiModel,
  });

describe("getModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiProvider();
  });

  it("throws when no model is selected", async () => {
    setSelected(null);
    await expect(getModel()).rejects.toThrow("Select an AI model in Settings");
  });

  it("returns a model when one is selected", async () => {
    setSelected("gpt-4.1-mini");
    await expect(getModel()).resolves.toBeTruthy();
  });
});
