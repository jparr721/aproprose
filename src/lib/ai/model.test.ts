import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOpenAI: vi.fn(),
  provider: vi.fn(),
  getAiConfig: vi.fn(),
  tauriFetch: vi.fn(),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: mocks.createOpenAI,
}));

vi.mock("@/lib/tauri", () => ({
  getAiConfig: mocks.getAiConfig,
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: mocks.tauriFetch,
}));

import { getModel, resetAiProvider } from "@/lib/ai/model";
import { useSettingsStore } from "@/stores/settings-store";

beforeEach(() => {
  resetAiProvider();
  mocks.provider.mockReset();
  mocks.createOpenAI.mockReset().mockReturnValue(mocks.provider);
  mocks.getAiConfig.mockReset().mockResolvedValue({ apiKey: "test-key" });
  mocks.tauriFetch.mockReset();
  useSettingsStore.setState({ aiModel: null });
});

describe("getModel", () => {
  it("throws when no OpenAI model is selected", async () => {
    await expect(getModel()).rejects.toThrow(
      "Select an AI model in Settings before using AI features.",
    );
    expect(mocks.getAiConfig).not.toHaveBeenCalled();
  });

  it("builds the selected OpenAI model through the configured provider", async () => {
    const expected = { provider: "openai", modelId: "gpt-4.1-mini" };
    mocks.provider.mockReturnValue(expected);
    useSettingsStore.setState({ aiModel: "gpt-4.1-mini" });

    await expect(getModel()).resolves.toBe(expected);
    expect(mocks.getAiConfig).toHaveBeenCalledOnce();
    expect(mocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: "test-key",
      fetch: mocks.tauriFetch,
    });
    expect(mocks.provider).toHaveBeenCalledWith("gpt-4.1-mini");
  });

  it("ignores a legacy provider value when resolving the selected OpenAI model", async () => {
    const expected = { provider: "openai", modelId: "gpt-4.1-mini" };
    mocks.provider.mockReturnValue(expected);
    const current = useSettingsStore.getState();
    const legacyState = {
      ...current,
      aiModel: "gpt-4.1-mini",
      aiProvider: "codex" as const,
    };
    useSettingsStore.setState(legacyState);

    const model = await getModel().finally(() => {
      useSettingsStore.setState(current, true);
    });

    expect(model).toBe(expected);
    expect(mocks.getAiConfig).toHaveBeenCalledOnce();
    expect(mocks.provider).toHaveBeenCalledWith("gpt-4.1-mini");
  });

  it("reuses the provider until resetAiProvider is called", async () => {
    useSettingsStore.setState({ aiModel: "gpt-4.1-mini" });

    await getModel();
    await getModel();
    expect(mocks.createOpenAI).toHaveBeenCalledOnce();

    resetAiProvider();
    await getModel();
    expect(mocks.createOpenAI).toHaveBeenCalledTimes(2);
  });
});
