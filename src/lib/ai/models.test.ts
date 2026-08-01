import { beforeEach, describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchModels: vi.fn(),
  getAiConfig: vi.fn(),
  tauriFetch: vi.fn(),
  toastWarning: vi.fn(),
}));

// Keep the Tauri/http import graph inert and control metadata network requests.
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: mocks.tauriFetch }));
vi.mock("@/lib/tauri", () => ({ getAiConfig: mocks.getAiConfig }));
vi.mock("tokenlens", async () => {
  const actual = await vi.importActual<typeof import("tokenlens")>("tokenlens");
  return { ...actual, fetchModels: mocks.fetchModels };
});
vi.mock("sonner", () => ({ toast: { warning: mocks.toastWarning } }));

import {
  filterOpenRouterTextModels,
  filterTextModels,
  listTextModels,
  resetModelMetadata,
  resolveModelContextWindow,
} from "@/lib/ai/models";

const openRouterModel = (
  id: string,
  contextLength: number,
  inputModalities: string[],
  outputModalities: string[],
  supportedParameters: string[],
) => ({
  id,
  context_length: contextLength,
  architecture: {
    input_modalities: inputModalities,
    output_modalities: outputModalities,
  },
  supported_parameters: supportedParameters,
});

beforeEach(() => {
  resetModelMetadata();
  mocks.fetchModels.mockReset();
  mocks.getAiConfig.mockReset();
  mocks.tauriFetch.mockReset();
  mocks.toastWarning.mockReset();
});

describe("filterTextModels", () => {
  it("keeps gpt and o-series text models", () => {
    expect(
      filterTextModels(["gpt-4.1", "o3-mini", "o1", "chatgpt-4o-latest"]),
    ).toEqual(["chatgpt-4o-latest", "gpt-4.1", "o1", "o3-mini"]);
  });

  it("drops embeddings, audio, image, tts, whisper, moderation, realtime", () => {
    const ids = [
      "gpt-4.1",
      "text-embedding-3-small",
      "gpt-4o-audio-preview",
      "gpt-4o-realtime-preview",
      "gpt-image-1",
      "dall-e-3",
      "tts-1",
      "whisper-1",
      "omni-moderation-latest",
    ];
    expect(filterTextModels(ids)).toEqual(["gpt-4.1"]);
  });

  it("de-duplicates and sorts", () => {
    expect(filterTextModels(["gpt-4o", "gpt-4o", "gpt-3.5-turbo"])).toEqual([
      "gpt-3.5-turbo",
      "gpt-4o",
    ]);
  });

  it("returns empty when nothing is text-capable", () => {
    expect(filterTextModels(["text-embedding-3-large", "dall-e-2"])).toEqual([]);
  });
});

describe("filterOpenRouterTextModels", () => {
  it("keeps text generation models that support agent tools", () => {
    const models = [
      openRouterModel(
        "anthropic/claude-sonnet-4",
        200_000,
        ["text", "image"],
        ["text"],
        ["tools", "tool_choice"],
      ),
      openRouterModel(
        "openai/gpt-image-1",
        32_000,
        ["text"],
        ["image"],
        ["tools"],
      ),
      openRouterModel(
        "meta-llama/llama-text-only",
        128_000,
        ["text"],
        ["text"],
        ["temperature"],
      ),
    ];

    expect(filterOpenRouterTextModels(models)).toEqual([
      "anthropic/claude-sonnet-4",
    ]);
  });
});

describe("listTextModels", () => {
  it("lists tool-capable OpenRouter text models with the configured key", async () => {
    mocks.getAiConfig.mockResolvedValue({ apiKey: "openrouter-key" });
    mocks.tauriFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            openRouterModel(
              "anthropic/claude-sonnet-4",
              200_000,
              ["text"],
              ["text"],
              ["tools"],
            ),
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(listTextModels("openrouter")).resolves.toEqual([
      "anthropic/claude-sonnet-4",
    ]);
    expect(mocks.getAiConfig).toHaveBeenCalledExactlyOnceWith("openrouter");
    expect(mocks.tauriFetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      {
        method: "GET",
        headers: { Authorization: "Bearer openrouter-key" },
      },
    );
  });
});

describe("resolveModelContextWindow", () => {
  it("retries and loads current metadata for a live model missing from the bundle", async () => {
    mocks.fetchModels
      .mockRejectedValueOnce(new Error("models.dev unavailable"))
      .mockResolvedValueOnce({
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-5.6-luna": {
            id: "gpt-5.6-luna",
            name: "GPT-5.6 Luna",
            limit: {
              context: 1_050_000,
              input: 922_000,
              output: 128_000,
            },
          },
        },
      });

    await expect(
      resolveModelContextWindow("openai", "gpt-5.6-luna"),
    ).resolves.toBe(1_050_000);
    expect(mocks.fetchModels).toHaveBeenCalledTimes(2);
    expect(mocks.fetchModels).toHaveBeenLastCalledWith({
      provider: "openai",
      fetch: mocks.tauriFetch,
    });
    expect(mocks.toastWarning).toHaveBeenCalledOnce();
  });

  it("uses OpenRouter model metadata for the selected routed model", async () => {
    mocks.getAiConfig.mockResolvedValue({ apiKey: "openrouter-key" });
    mocks.tauriFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            openRouterModel(
              "anthropic/claude-sonnet-4",
              200_000,
              ["text"],
              ["text"],
              ["tools"],
            ),
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(
      resolveModelContextWindow("openrouter", "anthropic/claude-sonnet-4"),
    ).resolves.toBe(200_000);
  });
});
