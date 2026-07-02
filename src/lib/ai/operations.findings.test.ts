import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the model layer so importing operations.ts does not pull the Tauri stack,
// and stub the SDK so normalization/sanitizing runs against a canned output.
vi.mock("@/lib/ai/model", () => ({ getModel: vi.fn().mockResolvedValue({}) }));
vi.mock("ai", () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  Output: { object: vi.fn() },
}));

import { generateText } from "ai";
import {
  critique,
  continuityCheck,
  sanitizeFindingIds,
  critiqueResultSchema,
  continuityResultSchema,
  type AnchoredContext,
} from "@/lib/ai/operations";

const ctx: AnchoredContext = {
  blocksText: 'One.\n\n"Two."',
  blocks: [
    { id: "b1", type: "narration", text: "One." },
    { id: "b2", type: "dialogue", text: "Two." },
  ],
};

beforeEach(() => vi.mocked(generateText).mockReset());

describe("sanitizeFindingIds", () => {
  it("drops ids that were not offered, per finding", () => {
    const out = sanitizeFindingIds(
      [{ blockIds: ["b1", "ghost"] }, { blockIds: ["ghost"] }],
      ["b1", "b2"],
    );
    expect(out).toEqual([{ blockIds: ["b1"] }, { blockIds: [] }]);
  });

  it("keeps scene-level findings ([]) untouched", () => {
    expect(sanitizeFindingIds([{ blockIds: [] }], ["b1"])).toEqual([{ blockIds: [] }]);
  });
});

describe("critique anchoring", () => {
  it("normalizes null blockIds to [] and drops unknown ids", async () => {
    vi.mocked(generateText).mockResolvedValue({
      output: {
        notes: [
          { kind: "watch", tag: "Pacing", text: "Slow.", blockIds: null },
          { kind: "idea", tag: "Voice", text: "Push.", blockIds: ["b2", "ghost"] },
        ],
      },
    } as never);
    expect(await critique(ctx)).toEqual([
      { kind: "watch", tag: "Pacing", text: "Slow.", blockIds: [] },
      { kind: "idea", tag: "Voice", text: "Push.", blockIds: ["b2"] },
    ]);
  });

  it("grounds on id-labeled SCENE BLOCKS and forwards the abort signal", async () => {
    vi.mocked(generateText).mockResolvedValue({ output: { notes: [] } } as never);
    const ac = new AbortController();
    await critique(ctx, { signal: ac.signal });
    const call = vi.mocked(generateText).mock.calls[0][0] as unknown as {
      prompt: string;
      abortSignal?: AbortSignal;
    };
    expect(call.prompt).toContain("SCENE BLOCKS (cite these ids in blockIds):");
    expect(call.prompt).toContain("[b1] (narration): One.");
    expect(call.abortSignal).toBe(ac.signal);
  });
});

describe("continuityCheck anchoring", () => {
  it("normalizes null blockIds to [] and drops unknown ids", async () => {
    vi.mocked(generateText).mockResolvedValue({
      output: { flags: [{ sev: "warn", tag: "Cast", text: "Who?", blockIds: ["ghost", "b1"] }] },
    } as never);
    expect(await continuityCheck(ctx)).toEqual([
      { sev: "warn", tag: "Cast", text: "Who?", blockIds: ["b1"] },
    ]);
  });
});

describe("result schema round-trips", () => {
  it("critiqueResultSchema accepts both null and cited blockIds", () => {
    const sceneNote = { kind: "watch", tag: "Pacing", text: "Slow.", blockIds: null };
    const citedNote = { kind: "idea", tag: "Voice", text: "Push.", blockIds: ["b1"] };
    expect(critiqueResultSchema.parse({ notes: [sceneNote] })).toEqual({ notes: [sceneNote] });
    expect(critiqueResultSchema.parse({ notes: [citedNote] })).toEqual({ notes: [citedNote] });
  });

  it("continuityResultSchema accepts both null and cited blockIds", () => {
    const sceneFlag = { sev: "warn", tag: "Timeline", text: "Day drifts.", blockIds: null };
    const citedFlag = { sev: "flag", tag: "Props", text: "The knife moved.", blockIds: ["b1"] };
    expect(continuityResultSchema.parse({ flags: [sceneFlag] })).toEqual({ flags: [sceneFlag] });
    expect(continuityResultSchema.parse({ flags: [citedFlag] })).toEqual({ flags: [citedFlag] });
  });
});
