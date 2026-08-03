import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockLanguageModelV3 } from "ai/test";

// Stub the SDK so normalization/sanitizing runs against a canned output.
vi.mock("ai", () => ({
  generateText: vi.fn(),
  Output: {
    object: vi.fn((config: { schema: unknown }) => config),
  },
}));

import { generateText } from "ai";
import {
  critique,
  continuityCheck,
  sanitizeFindingIds,
  critiqueResultSchema,
  continuityResultSchema,
  type AiOpOptions,
  type AnchoredContext,
} from "@/lib/ai/operations";

const ctx: AnchoredContext = {
  blocks: [
    { id: "b1", type: "narration", text: "One." },
    { id: "b2", type: "dialogue", text: "Two." },
  ],
};

const analysisModel = new MockLanguageModelV3();

function analysisOptions(signal: AbortSignal | undefined): AiOpOptions {
  return {
    signal,
    model: analysisModel,
    preferences: {
      styleGuide: "Frozen analysis voice.",
      editingRules: "Frozen analysis editing rules.",
    },
  };
}

interface CapturedGeneration<Schema> {
  model: unknown;
  system: string;
  prompt: string;
  output: { schema: Schema };
  abortSignal?: AbortSignal;
}

const sharedAnalysisClauses = [
  "You are the writing partner inside aproprose, a focused editor for literary novelists",
  "You work on a single manuscript at a time",
  "always reason from the author's actual prose, never from genre cliche",
  "Match the manuscript's established voice, tense, and point of view exactly",
  "if the prose is first-person present, you stay first-person present",
  "Honour the author's diction, rhythm, and level of profanity; do not sanitise or \"improve\" their style",
  "Be concrete and specific to the text in front of you",
  "never give generic writing advice that could apply to any book",
  "treat it as the author's intent for this scene",
  "the beat it serves",
  "flag drift from the beat or the chapter's stated Goal/Conflict/Turn",
  "When it is absent, do not speculate about structure",
  "Emphasis in the prose you read is written _italics_ and **bold**",
  "treat these as formatting to preserve, never as errors to fix",
] as const;

const critiqueClauses = [
  "Task: read the prose and return craft notes, each pinned to something concrete in the text",
  '"strength" for what is working and should be preserved',
  '"watch" for a risk or weakness to keep an eye on',
  '"idea" for an optional opportunity to push further',
  '"tag": a one- or two-word craft category, e.g. "Voice", "Pacing", "Tension", "Imagery", "Dialogue", "Clarity"',
  '"text": one or two sentences naming the specific moment and why it lands or wavers',
  "Quote or paraphrase the actual line you mean",
  '"blockIds": the ids of the specific SCENE BLOCKS the note is about',
  "copied exactly from their [id] labels",
  "Use [] when the note concerns the whole scene",
  "roughly 4-7 notes",
  "Lead with at least one genuine strength; never produce only criticism",
  "Do not invent problems that aren't on the page",
  'If the author included an explicit request ("AUTHOR\'S REQUEST")',
  "focus your notes on what they asked about",
  "Otherwise, cover the most important craft notes you see",
] as const;

const continuityClauses = [
  "Task: act as a continuity editor",
  "names, pronouns, who is present, physical positions, props, time of day, established facts",
  "and report what you find",
  '"ok" when something is tracked cleanly and worth confirming',
  '"warn" for a soft inconsistency or ambiguity the author may have intended',
  '"flag" for a likely error that breaks continuity',
  '"tag": a short label for the thing being tracked, e.g. "Cast", "Props", "Timeline", "Geography", "Pronouns"',
  "naming the specific detail and where it appears",
  '"blockIds": the ids of the specific SCENE BLOCKS the observation is about',
  "copied exactly from their [id] labels",
  "Use [] when it concerns the whole scene",
  "Only report what the supplied text actually supports",
  "if you cannot see earlier chapters, do not assume a contradiction with them",
  "Prefer a few high-signal observations over an exhaustive list",
  'If the author included an explicit request ("AUTHOR\'S REQUEST")',
  "prioritise the continuity dimension they named",
  "Otherwise, sweep broadly",
] as const;

function capturedGeneration<Schema>(): CapturedGeneration<Schema> {
  return vi.mocked(generateText).mock.calls[0][0] as unknown as CapturedGeneration<Schema>;
}

function expectClauses(actual: string, clauses: readonly string[]): void {
  for (const clause of clauses) {
    expect.soft(actual).toContain(clause);
  }
}

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
    expect(await critique(ctx, analysisOptions(undefined))).toEqual([
      { kind: "watch", tag: "Pacing", text: "Slow.", blockIds: [] },
      { kind: "idea", tag: "Voice", text: "Push.", blockIds: ["b2"] },
    ]);
  });

  it("grounds on id-labeled SCENE BLOCKS and forwards the abort signal", async () => {
    vi.mocked(generateText).mockResolvedValue({ output: { notes: [] } } as never);
    const ac = new AbortController();
    await critique(ctx, analysisOptions(ac.signal));
    const call = vi.mocked(generateText).mock.calls[0][0] as unknown as {
      prompt: string;
      abortSignal?: AbortSignal;
    };
    expect(call.prompt).toContain("SCENE BLOCKS (cite these ids in blockIds):");
    expect(call.prompt).toContain("[b1] (narration): One.");
    expect(call.abortSignal).toBe(ac.signal);
  });

  it("passes the complete retained critique system contract to generateText", async () => {
    vi.mocked(generateText).mockResolvedValue({ output: { notes: [] } } as never);

    await critique(ctx, analysisOptions(undefined));

    const call = capturedGeneration<typeof critiqueResultSchema>();
    expect(call.system).toContain("Frozen analysis voice.");
    expect(call.model).toBe(analysisModel);
    expectClauses(call.system, sharedAnalysisClauses);
    expectClauses(call.system, critiqueClauses);
  });

  it("passes the fully described critique schema to generateText", async () => {
    vi.mocked(generateText).mockResolvedValue({ output: { notes: [] } } as never);

    await critique(ctx, analysisOptions(undefined));

    const schema = capturedGeneration<typeof critiqueResultSchema>().output.schema;
    const notes = schema.shape.notes;
    const note = notes.element;
    expect(note.shape.kind.description).toBe(
      "strength = working, watch = risk, idea = opportunity",
    );
    expect(note.shape.tag.description).toBe(
      "one- or two-word craft category, e.g. Voice, Pacing",
    );
    expect(note.shape.text.description).toBe(
      "one or two sentences naming the specific moment and why",
    );
    expect(note.shape.blockIds.description).toBe(
      "ids of the SCENE BLOCKS this concerns, copied exactly from their [id] labels; null when it concerns the whole scene",
    );
    expect(notes.description).toBe(
      "a balanced handful of notes, leading with at least one strength",
    );
  });
});

describe("continuityCheck anchoring", () => {
  it("normalizes null blockIds to [] and drops unknown ids", async () => {
    vi.mocked(generateText).mockResolvedValue({
      output: { flags: [{ sev: "warn", tag: "Cast", text: "Who?", blockIds: ["ghost", "b1"] }] },
    } as never);
    expect(await continuityCheck(ctx, analysisOptions(undefined))).toEqual([
      { sev: "warn", tag: "Cast", text: "Who?", blockIds: ["b1"] },
    ]);
  });

  it("passes the complete retained continuity system contract to generateText", async () => {
    vi.mocked(generateText).mockResolvedValue({ output: { flags: [] } } as never);

    await continuityCheck(ctx, analysisOptions(undefined));

    const call = capturedGeneration<typeof continuityResultSchema>();
    expect(call.system).toContain("Frozen analysis voice.");
    expect(call.model).toBe(analysisModel);
    expectClauses(call.system, sharedAnalysisClauses);
    expectClauses(call.system, continuityClauses);
  });

  it("passes the fully described continuity schema to generateText", async () => {
    vi.mocked(generateText).mockResolvedValue({ output: { flags: [] } } as never);

    await continuityCheck(ctx, analysisOptions(undefined));

    const schema = capturedGeneration<typeof continuityResultSchema>().output.schema;
    const flags = schema.shape.flags;
    const flag = flags.element;
    expect(flag.shape.sev.description).toBe(
      "ok = tracked cleanly, warn = soft inconsistency, flag = likely error",
    );
    expect(flag.shape.tag.description).toBe(
      "short label for the tracked thing, e.g. Cast, Timeline",
    );
    expect(flag.shape.text.description).toBe(
      "one or two sentences describing the observation and where it appears",
    );
    expect(flag.shape.blockIds.description).toBe(
      "ids of the SCENE BLOCKS this concerns, copied exactly from their [id] labels; null when it concerns the whole scene",
    );
    expect(flags.description).toBe(
      "high-signal continuity observations grounded in the supplied text",
    );
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
