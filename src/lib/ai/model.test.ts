import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOpenAI: vi.fn(),
  createOpenRouter: vi.fn(),
  openAiProvider: vi.fn(),
  openRouterProvider: vi.fn(),
  getAiConfig: vi.fn(),
  tauriFetch: vi.fn(),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: mocks.createOpenAI,
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: mocks.createOpenRouter,
}));

vi.mock("@/lib/tauri", () => ({
  getAiConfig: mocks.getAiConfig,
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: mocks.tauriFetch,
}));

import { getModel, resetAiProvider } from "@/lib/ai/model";

beforeEach(() => {
  resetAiProvider();
  mocks.openAiProvider.mockReset();
  mocks.openRouterProvider.mockReset();
  mocks.createOpenAI.mockReset().mockReturnValue(mocks.openAiProvider);
  mocks.createOpenRouter.mockReset().mockReturnValue(mocks.openRouterProvider);
  mocks.getAiConfig.mockReset().mockImplementation(async (provider: string) => ({
    apiKey: provider === "openrouter" ? "openrouter-key" : "openai-key",
  }));
  mocks.tauriFetch.mockReset();
});

describe("getModel", () => {
  it("builds the explicitly selected OpenAI model through the configured provider", async () => {
    const expected = { provider: "openai", modelId: "gpt-4.1-mini" };
    mocks.openAiProvider.mockReturnValue(expected);

    await expect(getModel("openai", "gpt-4.1-mini")).resolves.toBe(expected);
    expect(mocks.getAiConfig).toHaveBeenCalledExactlyOnceWith("openai");
    expect(mocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: "openai-key",
      fetch: mocks.tauriFetch,
    });
    expect(mocks.openAiProvider).toHaveBeenCalledWith("gpt-4.1-mini");
  });

  it("builds OpenRouter models through the OpenRouter AI SDK provider", async () => {
    const expected = {
      provider: "openrouter",
      modelId: "anthropic/claude-sonnet-4",
    };
    mocks.openRouterProvider.mockReturnValue(expected);

    await expect(
      getModel("openrouter", "anthropic/claude-sonnet-4"),
    ).resolves.toBe(expected);
    expect(mocks.getAiConfig).toHaveBeenCalledExactlyOnceWith("openrouter");
    expect(mocks.createOpenRouter).toHaveBeenCalledWith({
      apiKey: "openrouter-key",
      compatibility: "strict",
      fetch: mocks.tauriFetch,
    });
    expect(mocks.openRouterProvider).toHaveBeenCalledWith(
      "anthropic/claude-sonnet-4",
    );
  });

  it("reuses each provider until resetAiProvider is called", async () => {
    await getModel("openai", "gpt-4.1-mini");
    await getModel("openai", "gpt-5");
    await getModel("openrouter", "anthropic/claude-sonnet-4");
    await getModel("openrouter", "google/gemini-2.5-pro");
    expect(mocks.createOpenAI).toHaveBeenCalledOnce();
    expect(mocks.createOpenRouter).toHaveBeenCalledOnce();

    resetAiProvider();
    await getModel("openai", "gpt-4.1-mini");
    await getModel("openrouter", "anthropic/claude-sonnet-4");
    expect(mocks.createOpenAI).toHaveBeenCalledTimes(2);
    expect(mocks.createOpenRouter).toHaveBeenCalledTimes(2);
  });
});
