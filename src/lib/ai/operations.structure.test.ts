import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the model layer so importing operations.ts does not pull the Tauri/model
// stack, and stub the SDK so assignSpeakers runs against a canned model output.
vi.mock("@/lib/ai/model", () => ({ getModel: vi.fn().mockResolvedValue({}) }));
vi.mock("ai", () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  Output: { object: vi.fn() },
}));

import { generateText } from "ai";
import { assignSpeakers } from "@/lib/ai/operations";
import { getModel } from "@/lib/ai/model";
import type { Block, Character } from "@/lib/types";

beforeEach(() => {
  vi.mocked(generateText).mockReset();
  vi.mocked(getModel).mockClear();
});

describe("assignSpeakers", () => {
  it("returns the model's speaker assignments", async () => {
    vi.mocked(generateText).mockResolvedValue({
      output: { assignments: [{ index: 1, speaker: "Brian" }] },
    } as never);
    const seed: Block[] = [
      { id: "1", type: "narration", text: "Brian said.", raw: "", dirty: true },
      { id: "2", type: "dialogue", text: "Hi", raw: "", dirty: true },
    ];
    const cast: Character[] = [{ id: "c-brian", name: "Brian", color: "#000", role: "" }];
    const out = await assignSpeakers(seed, cast, "GROUNDING", undefined);
    expect(out).toEqual([{ index: 1, speaker: "Brian" }]);
  });

  it("skips the model call when the seed has no dialogue", async () => {
    const seed: Block[] = [
      { id: "1", type: "narration", text: "Brian said.", raw: "", dirty: true },
    ];
    const cast: Character[] = [{ id: "c-brian", name: "Brian", color: "#000", role: "" }];
    const out = await assignSpeakers(seed, cast, "GROUNDING", undefined);
    expect(out).toEqual([]);
    expect(generateText).not.toHaveBeenCalled();
  });
});
