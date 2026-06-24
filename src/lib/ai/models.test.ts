import { describe, it, expect, vi } from "vitest";

// Keep the Tauri/http import graph inert; this suite only tests the pure filter.
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@/lib/tauri", () => ({ getAiConfig: vi.fn() }));

import { filterTextModels } from "@/lib/ai/models";

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
