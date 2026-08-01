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

beforeEach(() => {
  resetAiProvider();
  mocks.provider.mockReset();
  mocks.createOpenAI.mockReset().mockReturnValue(mocks.provider);
  mocks.getAiConfig.mockReset().mockResolvedValue({ apiKey: "test-key" });
  mocks.tauriFetch.mockReset();
});

describe("getModel", () => {
  it("builds the explicitly selected OpenAI model through the configured provider", async () => {
    const expected = { provider: "openai", modelId: "gpt-4.1-mini" };
    mocks.provider.mockReturnValue(expected);

    await expect(getModel("gpt-4.1-mini")).resolves.toBe(expected);
    expect(mocks.getAiConfig).toHaveBeenCalledOnce();
    expect(mocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: "test-key",
      fetch: mocks.tauriFetch,
    });
    expect(mocks.provider).toHaveBeenCalledWith("gpt-4.1-mini");
  });

  it("reuses the provider until resetAiProvider is called", async () => {
    await getModel("gpt-4.1-mini");
    await getModel("gpt-5");
    expect(mocks.createOpenAI).toHaveBeenCalledOnce();

    resetAiProvider();
    await getModel("gpt-4.1-mini");
    expect(mocks.createOpenAI).toHaveBeenCalledTimes(2);
  });
});
