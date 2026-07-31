import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/model", () => ({ getModel: vi.fn().mockResolvedValue({}) }));
const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText };
});

import {
  guideChapterOutline,
  sanitizeGuidedOutlineTurn,
  type GuidedOutlineContext,
  type GuidedOutlineTurn,
} from "@/lib/ai/operations";

const context: GuidedOutlineContext = {
  chapterId: "ch1",
  chapterTitle: "The Winter Letter",
  storyPremise: "A reluctant courier carries a treasonous letter north.",
  act: "setup",
  plotPoint: null,
  premise: "",
  goal: "",
  conflict: "",
  turn: "",
  cards: [
    {
      id: "card-1",
      title: "The seal breaks",
      intention: "Reveal the summons.",
      characterIds: ["mara"],
      loreIds: ["winter-court"],
    },
  ],
  characters: [
    { id: "mara", name: "Mara", role: "Courier" },
    { id: "oren", name: "Oren", role: "Brother" },
  ],
  lore: [
    {
      id: "winter-court",
      title: "Winter Court",
      description: "The queen's northern seat.",
      tags: ["place"],
    },
  ],
  manuscript: "",
};

beforeEach(() => {
  generateText.mockReset();
});

describe("sanitizeGuidedOutlineTurn", () => {
  it("pins the plan to the requested chapter and removes unknown references", () => {
    const turn: GuidedOutlineTurn = {
      reply: "The choice is clear enough to preview.",
      plan: {
        chapterId: "wrong-chapter",
        summary: "Mara answers the summons.",
        act: "setup",
        plotPoint: "inciting",
        premise: "A summons corners Mara.",
        goal: "Keep Oren home.",
        conflict: "The queen names him directly.",
        turn: "Mara goes in his place.",
        characterIds: ["mara", "ghost", "mara"],
        beats: [
          {
            sourceCardId: "missing-card",
            title: "A false signature",
            intention: "Mara commits to the substitution.",
            characterIds: ["oren", "ghost"],
            loreIds: ["winter-court", "missing-lore"],
          },
        ],
      },
    };

    expect(sanitizeGuidedOutlineTurn(turn, context)).toEqual({
      reply: "The choice is clear enough to preview.",
      plan: {
        chapterId: "ch1",
        summary: "Mara answers the summons.",
        act: "setup",
        plotPoint: "inciting",
        premise: "A summons corners Mara.",
        goal: "Keep Oren home.",
        conflict: "The queen names him directly.",
        turn: "Mara goes in his place.",
        characterIds: ["mara", "oren"],
        beats: [
          {
            sourceCardId: null,
            title: "A false signature",
            intention: "Mara commits to the substitution.",
            characterIds: ["oren"],
            loreIds: ["winter-court"],
          },
        ],
      },
    });
  });
});

describe("guideChapterOutline", () => {
  it("grounds the full conversation and returns the structured preview", async () => {
    const output: GuidedOutlineTurn = {
      reply: "What makes Mara choose Oren over the mission?",
      plan: null,
    };
    generateText.mockResolvedValue({ output });

    const result = await guideChapterOutline(
      [
        { role: "user", content: "The letter should force Mara to choose." },
        { role: "assistant", content: "What does she stand to lose?" },
        { role: "user", content: "Her brother will be conscripted." },
      ],
      context,
      null,
    );

    expect(result).toEqual(output);
    const request = generateText.mock.calls[0][0];
    expect(request.messages.slice(-3)).toEqual([
      { role: "user", content: "The letter should force Mara to choose." },
      { role: "assistant", content: "What does she stand to lose?" },
      { role: "user", content: "Her brother will be conscripted." },
    ]);
    expect(request.messages[0].content).toContain("The Winter Letter");
    expect(request.messages[0].content).toContain("card-1");
  });

  it("includes the current preview so later turns revise instead of restarting it", async () => {
    generateText.mockResolvedValue({
      output: { reply: "I moved the reveal earlier.", plan: null },
    });
    const currentPlan = {
      chapterId: "ch1",
      summary: "Mara takes Oren's place.",
      act: "setup" as const,
      plotPoint: "inciting" as const,
      premise: "A summons corners Mara.",
      goal: "Keep Oren home.",
      conflict: "The queen names him directly.",
      turn: "Mara answers in his place.",
      characterIds: ["mara", "oren"],
      beats: [],
    };

    await guideChapterOutline(
      [{ role: "user", content: "Move the reveal earlier." }],
      context,
      currentPlan,
    );

    expect(generateText.mock.calls[0][0].messages[0].content).toContain(
      "CURRENT PREVIEW",
    );
    expect(generateText.mock.calls[0][0].messages[0].content).toContain(
      "Mara takes Oren's place.",
    );
  });
});
