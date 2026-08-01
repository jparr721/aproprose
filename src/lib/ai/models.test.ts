import { describe, it, expect, vi } from "vitest";

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
  filterTextModels,
  resolveModelContextWindow,
} from "@/lib/ai/models";

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

    await expect(resolveModelContextWindow("gpt-5.6-luna")).resolves.toBe(
      1_050_000,
    );
    expect(mocks.fetchModels).toHaveBeenCalledTimes(2);
    expect(mocks.fetchModels).toHaveBeenLastCalledWith({
      provider: "openai",
      fetch: mocks.tauriFetch,
    });
    expect(mocks.toastWarning).toHaveBeenCalledOnce();
  });
});
