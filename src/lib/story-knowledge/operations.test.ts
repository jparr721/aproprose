import { generateText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { emptyCharacterProfile } from "@/lib/story-knowledge/model";
import {
  analyzeStoryChunk,
  characterCandidateReductionResultSchema,
  reduceChapterKnowledge,
  reduceCharacterCandidates,
  reduceCharacterPatch,
  reduceStoryFields,
  storyFieldReductionResultSchema,
  type AnalyzeStoryChunkInput,
  type StoryKnowledgeAiOptions,
} from "@/lib/story-knowledge/operations";
import type {
  Character,
  CharacterObservation,
  ChapterKnowledge,
  EvidenceLocator,
} from "@/lib/types";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  Output: { object: vi.fn((config: { schema: unknown }) => config) },
}));

vi.mock("sonner", () => ({
  toast: { warning: vi.fn() },
}));

const knowledgeModel = new MockLanguageModelV3();

function aiOptions(signal: AbortSignal): StoryKnowledgeAiOptions {
  return { model: knowledgeModel, signal };
}

function characterFixture(id: string, name: string): Character {
  return {
    id,
    name,
    color: "#a65f46",
    role: "Lead",
    profile: emptyCharacterProfile(),
  };
}

function mapInputFixture(): AnalyzeStoryChunkInput {
  return {
    chunk: {
      chapterId: "ch1",
      chapterTitle: "One",
      blocks: [
        {
          locator: {
            chapterId: "ch1",
            sourceId: "b1",
            order: 0,
            fingerprint: "fp-b1",
            previewText: "Mara checks every lock twice.",
          },
          type: "narration",
          text: "Mara checks every lock twice.",
          speakerId: null,
        },
      ],
    },
    outline: { premise: "", overview: "" },
    chapterOutline: {
      act: null,
      plotPoint: null,
      premise: "",
      goal: "",
      conflict: "",
      turn: "",
      characterIds: ["c1"],
      cards: [],
    },
    roster: [{ id: "c1", name: "Mara", role: "Lead" }],
    relevantProfiles: [characterFixture("c1", "Mara")],
  };
}

function emptyMapOutput(): {
  summaryFragment: string;
  premiseSignals: string[];
  conflictSignals: string[];
  stakeSignals: string[];
  arcSignals: string[];
  endingSignals: string[];
  characterObservations: [];
  unknownCharacterObservations: [];
} {
  return {
    summaryFragment: "",
    premiseSignals: [],
    conflictSignals: [],
    stakeSignals: [],
    arcSignals: [],
    endingSignals: [],
    characterObservations: [],
    unknownCharacterObservations: [],
  };
}

function evidence(sourceId: string): EvidenceLocator {
  return {
    chapterId: "ch1",
    sourceId,
    order: 0,
    fingerprint: `fp-${sourceId}`,
    previewText: "Evidence.",
  };
}

function observation(id: string): CharacterObservation {
  return {
    id,
    characterId: "c1",
    field: "mannerisms",
    detail: "Mara checks every lock twice.",
    evidence: [evidence("b1")],
  };
}

function chapterKnowledge(): ChapterKnowledge {
  return {
    sourceFingerprint: "chapter-fp",
    summary: "Mara returns home.",
    premiseSignals: [],
    conflictSignals: [],
    stakeSignals: [],
    arcSignals: [],
    endingSignals: [],
    characterObservations: [],
    unknownCharacterObservations: [],
  };
}

beforeEach(() => vi.mocked(generateText).mockReset());

describe("story chunk analysis", () => {
  it("drops map observations that cite unknown characters or unoffered evidence", async () => {
    vi.mocked(generateText).mockResolvedValue({
      output: {
        ...emptyMapOutput(),
        summaryFragment: "Mara returns home.",
        characterObservations: [
          {
            characterId: "c1",
            field: "mannerisms",
            detail: "Mara checks every lock twice.",
            sourceIds: ["b1"],
          },
          {
            characterId: "ghost",
            field: "history",
            detail: "Unsupported.",
            sourceIds: ["b1"],
          },
          {
            characterId: "c1",
            field: "history",
            detail: "Also unsupported.",
            sourceIds: ["missing"],
          },
        ],
      },
    } as never);

    const result = await analyzeStoryChunk(
      mapInputFixture(),
      aiOptions(new AbortController().signal),
    );

    expect(result.characterObservations).toHaveLength(1);
    expect(result.characterObservations[0]).toMatchObject({
      characterId: "c1",
      field: "mannerisms",
      evidence: [
        {
          chapterId: "ch1",
          sourceId: "b1",
          fingerprint: "fp-b1",
        },
      ],
    });
    expect(result.characterObservations[0].id).not.toBe("");
  });

  it("filters invalid unknown-character evidence and resolves valid locators", async () => {
    vi.mocked(generateText).mockResolvedValue({
      output: {
        ...emptyMapOutput(),
        unknownCharacterObservations: [
          {
            name: "Inez",
            role: "Guide",
            details: { appearance: "Silver hair." },
            sourceIds: ["b1"],
          },
          {
            name: "Tomas",
            role: "Traveler",
            details: { history: "Unsupported." },
            sourceIds: ["missing"],
          },
        ],
      },
    } as never);

    const result = await analyzeStoryChunk(
      mapInputFixture(),
      aiOptions(new AbortController().signal),
    );

    expect(result.unknownCharacterObservations).toHaveLength(1);
    expect(result.unknownCharacterObservations[0]).toMatchObject({
      name: "Inez",
      evidence: [{ sourceId: "b1", fingerprint: "fp-b1" }],
    });
  });

  it("forwards abort and retries one failed generation", async () => {
    const abort = new AbortController();
    vi.mocked(generateText)
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ output: emptyMapOutput() } as never);

    await analyzeStoryChunk(mapInputFixture(), aiOptions(abort.signal));

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(vi.mocked(generateText).mock.calls[1][0].abortSignal).toBe(abort.signal);
  });

  it("prompts for evidence-only analysis without permanent traits from reactions", async () => {
    vi.mocked(generateText).mockResolvedValue({ output: emptyMapOutput() } as never);

    await analyzeStoryChunk(
      mapInputFixture(),
      aiOptions(new AbortController().signal),
    );

    const call = vi.mocked(generateText).mock.calls[0][0] as unknown as {
      system: string;
      prompt: string;
    };
    expect(call.system).toContain("supplied prose only");
    expect(call.system).toContain("Temporary reactions are not permanent traits");
    expect(call.system).toContain("exact character IDs");
    expect(call.system).toContain("offered source IDs");
    expect(call.prompt).toContain('"sourceId": "b1"');
    expect(call.prompt).toContain('"speakerId": null');
  });
});

describe("chapter knowledge reduction", () => {
  it("retains only offered observations and assigns the source fingerprint", async () => {
    const retained = observation("obs-1");
    vi.mocked(generateText).mockResolvedValue({
      output: {
        summary: "Mara returns and secures the house.",
        premiseSignals: [],
        conflictSignals: ["Someone may have entered."],
        stakeSignals: [],
        arcSignals: [],
        endingSignals: [],
        characterObservationIds: ["obs-1", "ghost"],
        unknownCharacterObservationIds: ["unknown-ghost"],
      },
    } as never);

    const result = await reduceChapterKnowledge(
      {
        sourceFingerprint: "source-fp",
        analyses: [
          {
            ...emptyMapOutput(),
            characterObservations: [retained],
          },
        ],
      },
      aiOptions(new AbortController().signal),
    );

    expect(result).toMatchObject({
      sourceFingerprint: "source-fp",
      summary: "Mara returns and secures the house.",
      characterObservations: [retained],
      unknownCharacterObservations: [],
    });
  });
});

describe("story field reduction", () => {
  it("enforces the 2,000-character overview cap in the structured schema", () => {
    expect(
      storyFieldReductionResultSchema.safeParse({
        premise: "A locksmith returns home.",
        overview: "x".repeat(2_000),
      }).success,
    ).toBe(true);
    expect(
      storyFieldReductionResultSchema.safeParse({
        premise: "A locksmith returns home.",
        overview: "x".repeat(2_001),
      }).success,
    ).toBe(false);
  });

  it("rejects blank replacements for nonempty author story fields", async () => {
    vi.mocked(generateText).mockResolvedValue({
      output: { premise: " ", overview: "A retained overview." },
    } as never);

    await expect(
      reduceStoryFields(
        {
          current: { premise: "Author logline.", overview: "Author overview." },
          chapters: [{ chapterId: "ch1", title: "One", knowledge: chapterKnowledge() }],
        },
        aiOptions(new AbortController().signal),
      ),
    ).rejects.toThrow("Story premise cannot be blank when the current premise is nonempty");
  });
});

describe("character reduction", () => {
  it("rejects unknown observation IDs and blank operations", async () => {
    vi.mocked(generateText).mockResolvedValue({
      output: {
        additions: [
          {
            field: "mannerisms",
            text: "She checks locks twice.",
            observationIds: ["obs-1", "ghost"],
          },
          {
            field: "history",
            text: "Unsupported.",
            observationIds: ["ghost"],
          },
          {
            field: "voice",
            text: " ",
            observationIds: ["obs-1"],
          },
        ],
        corrections: [],
      },
    } as never);

    const result = await reduceCharacterPatch(
      {
        character: characterFixture("c1", "Mara"),
        observations: [observation("obs-1")],
        appliedObservationIds: [],
      },
      aiOptions(new AbortController().signal),
    );

    expect(result).toEqual({
      additions: [
        {
          field: "mannerisms",
          text: "She checks locks twice.",
          observationIds: ["obs-1"],
        },
      ],
      corrections: [],
    });
  });
});

describe("candidate reduction", () => {
  it("restricts output to eligible group fingerprints", async () => {
    const profile = {
      ...emptyCharacterProfile(),
      appearance: "Silver hair.",
    };
    vi.mocked(generateText).mockResolvedValue({
      output: {
        candidates: [
          {
            groupFingerprint: "eligible-fp",
            name: "Inez",
            role: "Guide",
            profile,
          },
          {
            groupFingerprint: "ghost-fp",
            name: "Tomas",
            role: "Traveler",
            profile: emptyCharacterProfile(),
          },
        ],
      },
    } as never);

    const result = await reduceCharacterCandidates(
      {
        groups: [
          {
            name: "Inez",
            normalizedName: "inez",
            role: "Guide",
            details: { appearance: "Silver hair." },
            evidence: [evidence("b1"), evidence("b2")],
            evidenceFingerprint: "eligible-fp",
          },
        ],
      },
      aiOptions(new AbortController().signal),
    );

    expect(result).toEqual([
      {
        groupFingerprint: "eligible-fp",
        name: "Inez",
        role: "Guide",
        profile,
      },
    ]);
  });

  it("requires complete profiles in the structured schema", () => {
    expect(
      characterCandidateReductionResultSchema.safeParse({
        candidates: [
          {
            groupFingerprint: "eligible-fp",
            name: "Inez",
            role: "Guide",
            profile: { appearance: "Silver hair." },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
