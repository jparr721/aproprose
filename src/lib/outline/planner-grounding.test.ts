import { describe, expect, it } from "vitest";
import { z } from "zod";
import { bookChapterSchema, projectChapter, type BookBlockValue } from "@/book";
import { buildOutlinePlannerGrounding } from "@/lib/outline/planner-grounding";
import {
  emptyCharacterProfile,
  emptyProjectKnowledge,
} from "@/lib/story-knowledge/model";
import type { Block, ChapterRef, ProjectMeta } from "@/lib/types";

const chapters: ChapterRef[] = ["a", "b", "c"].map((id, index) => ({
  id,
  label: String(index + 1),
  title: id.toUpperCase(),
  file: `${id}.tex`,
  wordCount: 1,
}));

const meta: ProjectMeta = {
  version: 4,
  characters: [],
  lore: [],
  statuses: {},
  outline: { premise: "Logline", overview: "Overview" },
  chapters: {},
  knowledge: emptyProjectKnowledge(),
};

const manuscript = (chapterId: string) => ({
  chapterId,
  title: chapterId.toUpperCase(),
  blocks: [{ id: chapterId, type: "narration" as const, text: `Prose ${chapterId}`, raw: "", dirty: false }],
});

const manuscriptSeedSchema = bookChapterSchema.extend({
  truncated: z.boolean(),
  start: z.number(),
  endExclusive: z.number(),
  includedCharacters: z.number(),
  totalBlocks: z.number(),
  totalCharacters: z.number(),
});
const plannerManuscriptSchema = z.object({ manuscript: z.object({
  target: manuscriptSeedSchema,
  previous: manuscriptSeedSchema.nullable(),
  next: manuscriptSeedSchema.nullable(),
}) });

function seededManuscript(grounding: string): z.infer<typeof plannerManuscriptSchema>["manuscript"] {
  const value: unknown = JSON.parse(grounding.split("\n").slice(1).join("\n"));
  return plannerManuscriptSchema.parse(value).manuscript;
}

describe("buildOutlinePlannerGrounding", () => {
  const semanticPairs: Array<{ name: string; before: Block; after: Block }> = [
    {
      name: "dialogue speakers",
      before: { id: "same", type: "dialogue", text: "Same words", speaker: "Mara", raw: "source", dirty: true },
      after: { id: "same", type: "dialogue", text: "Same words", speaker: "Ivo", raw: "source", dirty: true },
    },
    {
      name: "ordered quote and beat tails",
      before: { id: "same", type: "dialogue", text: "Same words", tail: [{ kind: "quote", text: "Same tail" }], raw: "source", dirty: true },
      after: { id: "same", type: "dialogue", text: "Same words", tail: [{ kind: "beat", text: "Same tail" }], raw: "source", dirty: true },
    },
    {
      name: "scene and break levels",
      before: { id: "same", type: "chapter", text: "Same words", level: "scene", raw: "source", dirty: true },
      after: { id: "same", type: "chapter", text: "Same words", level: "break", raw: "source", dirty: true },
    },
    {
      name: "scratchpad and lore notes",
      before: { id: "same", type: "scratchpad", text: "Same words", raw: "source", dirty: true },
      after: { id: "same", type: "lore", text: "Same words", raw: "source", dirty: true },
    },
  ];

  it.each(semanticPairs)("retains $name when the text does not change", ({ before, after }) => {
    const seed = (source: Block): BookBlockValue => {
      const grounding = buildOutlinePlannerGrounding({
        chapters, meta, targetChapterId: "b", previous: null, next: null,
        target: { chapterId: "b", title: "B", blocks: [source] },
      }, 1_000);
      return seededManuscript(grounding).target.blocks[0];
    };
    const beforeSeed = seed(before);
    const afterSeed = seed(after);

    expect(beforeSeed).toMatchObject({ id: "same", type: before.type, order: 0, text: "Same words" });
    expect(afterSeed).toMatchObject({ id: "same", type: after.type, order: 0, text: "Same words" });
    if (before.speaker !== undefined) {
      if (beforeSeed.type !== "dialogue" || afterSeed.type !== "dialogue") {
        throw new Error("Expected dialogue seeds");
      }
      expect(beforeSeed.speaker).toBe(before.speaker);
      expect(afterSeed.speaker).toBe(after.speaker);
    }
    if (before.tail !== undefined) {
      if (beforeSeed.type !== "dialogue" || afterSeed.type !== "dialogue") {
        throw new Error("Expected dialogue seeds");
      }
      expect(beforeSeed.tail).toEqual(before.tail);
      expect(afterSeed.tail).toEqual(after.tail);
    }
    if (before.level !== undefined) {
      if (beforeSeed.type !== "chapter" || afterSeed.type !== "chapter") {
        throw new Error("Expected chapter seeds");
      }
      expect(beforeSeed.level).toBe(before.level);
      expect(afterSeed.level).toBe(after.level);
    }
    expect(beforeSeed).not.toEqual(afterSeed);
    expect(beforeSeed).not.toHaveProperty("raw");
    expect(beforeSeed).not.toHaveProperty("dirty");
  });

  it("grounds complete dialogue and notes without reading neighboring manuscript", () => {
    const grounding = buildOutlinePlannerGrounding({ chapters, meta, targetChapterId: "b", previous: null, next: null,
      target: { chapterId: "b", title: "B", blocks: [
        { id: "speech", type: "dialogue", text: "First", speaker: "Dad", tail: [{ kind: "beat", text: "He waits" }, { kind: "quote", text: "Final" }], raw: "", dirty: true },
        { id: "note", type: "scratchpad", text: "Unresolved motive", raw: "", dirty: true },
      ] },
    }, 1000);
    expect(grounding).toContain("He waits");
    expect(grounding).toContain("Final");
    expect(grounding).toContain("Unresolved motive");
    expect(grounding).toContain('"previous": null');
    expect(grounding).toContain('"previousChapterId": "a"');
    expect(grounding).toContain('"nextChapterId": "c"');
    expect(grounding).toContain('"truncated": false');
  });

  it("grounds a middle chapter with both current neighbors", () => {
    const grounding = buildOutlinePlannerGrounding({
      chapters,
      meta,
      targetChapterId: "b",
      previous: manuscript("a"),
      target: manuscript("b"),
      next: manuscript("c"),
    }, 1_000);

    expect(grounding).toContain('"number": 2');
    expect(grounding).toContain('"text": "Prose a"');
    expect(grounding).toContain('"text": "Prose c"');
  });

  it("represents absent first and last neighbors as null", () => {
    const first = buildOutlinePlannerGrounding({
      chapters,
      meta,
      targetChapterId: "a",
      previous: null,
      target: manuscript("a"),
      next: manuscript("b"),
    }, 1_000);
    const last = buildOutlinePlannerGrounding({
      chapters,
      meta,
      targetChapterId: "c",
      previous: manuscript("b"),
      target: manuscript("c"),
      next: null,
    }, 1_000);

    expect(first).toContain('"previous": null');
    expect(last).toContain('"next": null');
  });

  it("resolves a newly inserted first chapter from the current order", () => {
    const inserted = {
      id: "new",
      label: "1",
      title: "New",
      file: "new.tex",
      wordCount: 0,
    };
    const grounding = buildOutlinePlannerGrounding({
      chapters: [inserted, ...chapters],
      meta,
      targetChapterId: "new",
      previous: null,
      target: manuscript("new"),
      next: manuscript("a"),
    }, 1_000);

    expect(grounding).toContain('"number": 1');
    expect(grounding).toContain('"previous": null');
    expect(grounding).toContain('"chapterId": "a"');
  });

  it("uses the current neighbors after chapters are reordered", () => {
    const reordered = [chapters[2], chapters[0], chapters[1]];
    const grounding = buildOutlinePlannerGrounding({
      chapters: reordered,
      meta,
      targetChapterId: "a",
      previous: manuscript("c"),
      target: manuscript("a"),
      next: manuscript("b"),
    }, 1_000);

    expect(grounding).toContain('"number": 2');
    expect(grounding).toContain('"text": "Prose c"');
    expect(grounding).toContain('"text": "Prose b"');
  });

  it("rejects a planner target after its chapter is deleted", () => {
    expect(() =>
      buildOutlinePlannerGrounding({
        chapters: chapters.filter((chapter) => chapter.id !== "b"),
        meta,
        targetChapterId: "b",
        previous: manuscript("a"),
        target: manuscript("b"),
        next: manuscript("c"),
      }, 1_000),
    ).toThrow("Outline planner chapter not found: b");
  });

  it("budgets semantic blocks and reserves the complete target before neighbors", () => {
    const longManuscript = (chapterId: string) => ({
      chapterId,
      title: chapterId.toUpperCase(),
      blocks: [
        {
          id: chapterId, raw: "", dirty: false,
          type: "narration" as const,
          text: `HEAD-${chapterId}-TAIL-${chapterId}`,
        },
      ],
    });

    const target = longManuscript("b");
    const targetCharacters = JSON.stringify(projectChapter(target).blocks).length - 2;
    const budget = targetCharacters + 20;
    const grounding = buildOutlinePlannerGrounding({
      chapters,
      meta,
      targetChapterId: "b",
      previous: longManuscript("a"),
      target,
      next: longManuscript("c"),
    }, budget);
    const value = seededManuscript(grounding);
    const manuscriptChapters = Object.values(value);

    expect(
      manuscriptChapters.reduce(
        (total, chapter) => total + (chapter === null ? 0 : JSON.stringify(chapter.blocks).length - 2),
        0,
      ),
    ).toBeLessThanOrEqual(budget);
    expect(value.previous).toMatchObject({ blocks: [], truncated: true, endExclusive: 0 });
    expect(value.next).toMatchObject({ blocks: [], truncated: true, endExclusive: 0 });
    expect(value.target.blocks).toEqual(projectChapter(target).blocks);
    expect(value.target).toMatchObject({
      truncated: false, start: 0, endExclusive: 1, totalBlocks: 1,
      includedCharacters: targetCharacters, totalCharacters: targetCharacters,
    });
  });

  it("reports a complete ordered prefix and the first unread block within the seed budget", () => {
    const target = {
      chapterId: "b", title: "B", blocks: [
        { id: "first", type: "narration" as const, text: "First complete paragraph", raw: "", dirty: true },
        { id: "second", type: "dialogue" as const, text: "Second", speaker: "Mara", tail: [{ kind: "quote" as const, text: "Tail must stay intact" }], raw: "", dirty: true },
      ],
    };
    const projected = projectChapter(target);
    const budget = JSON.stringify(projected.blocks[0]).length;
    const grounding = buildOutlinePlannerGrounding({
      chapters, meta, targetChapterId: "b", target, previous: null, next: null,
    }, budget);
    const value = seededManuscript(grounding).target;

    expect(value.blocks).toEqual([projected.blocks[0]]);
    expect(value).toMatchObject({
      start: 0, endExclusive: 1, totalBlocks: 2, truncated: true,
      includedCharacters: budget,
      totalCharacters: JSON.stringify(projected.blocks).length - 2,
    });
    expect(grounding).toContain("starting at target.endExclusive");
    expect(grounding).not.toContain("Tail must stay intact");
    expect(value).not.toHaveProperty("prose");
  });

  it("reports an unread target when no complete semantic block fits", () => {
    const grounding = buildOutlinePlannerGrounding({
      chapters, meta, targetChapterId: "b", target: manuscript("b"), previous: null, next: null,
    }, 1);

    expect(seededManuscript(grounding).target).toMatchObject({
      blocks: [], start: 0, endExclusive: 0, totalBlocks: 1,
      truncated: true, includedCharacters: 0,
    });
  });

  it("keeps neighbors uninspected while the target exceeds the seed budget", () => {
    const target = {
      chapterId: "b", title: "B",
      blocks: [{ id: "large", type: "narration" as const, text: "x".repeat(1_000), raw: "", dirty: true }],
    };
    const grounding = buildOutlinePlannerGrounding({
      chapters, meta, targetChapterId: "b", target,
      previous: manuscript("a"), next: manuscript("c"),
    }, 500);
    const value = seededManuscript(grounding);

    expect(value.target).toMatchObject({ blocks: [], truncated: true });
    expect(value.previous).toMatchObject({ blocks: [], truncated: true });
    expect(value.next).toMatchObject({ blocks: [], truncated: true });
  });

  it("expands profiles only for cast relevant to the target neighborhood", () => {
    const profile = (marker: string) => ({
      ...emptyCharacterProfile(),
      mannerisms: marker,
    });
    const plannerMeta: ProjectMeta = {
      ...meta,
      characters: [
        {
          id: "previous",
          name: "Previous",
          color: "#111111",
          role: "Guide",
          profile: profile("previous-profile"),
        },
        {
          id: "target",
          name: "Target",
          color: "#222222",
          role: "Lead",
          profile: profile("target-profile"),
        },
        {
          id: "card",
          name: "Card",
          color: "#333333",
          role: "Witness",
          profile: profile("card-profile"),
        },
        {
          id: "next",
          name: "Next",
          color: "#444444",
          role: "Rival",
          profile: profile("next-profile"),
        },
        {
          id: "observed",
          name: "Observed",
          color: "#555555",
          role: "Clerk",
          profile: profile("observed-profile"),
        },
        {
          id: "previous-observed",
          name: "Previous observed",
          color: "#565656",
          role: "Porter",
          profile: profile("previous-observed-profile"),
        },
        {
          id: "next-observed",
          name: "Next observed",
          color: "#575757",
          role: "Sailor",
          profile: profile("next-observed-profile"),
        },
        {
          id: "unrelated",
          name: "Unrelated",
          color: "#666666",
          role: "Pilot",
          profile: profile("unrelated-profile"),
        },
      ],
      chapters: {
        a: {
          act: null,
          plotPoint: null,
          premise: "",
          goal: "",
          conflict: "",
          turn: "",
          characterIds: ["previous"],
          cards: [],
        },
        b: {
          act: null,
          plotPoint: null,
          premise: "",
          goal: "",
          conflict: "",
          turn: "",
          characterIds: ["target"],
          cards: [
            {
              id: "card",
              title: "Beat",
              intention: "",
              characterIds: ["card"],
              loreIds: [],
              continuityFlags: [],
            },
          ],
        },
        c: {
          act: null,
          plotPoint: null,
          premise: "",
          goal: "",
          conflict: "",
          turn: "",
          characterIds: ["next"],
          cards: [],
        },
      },
      knowledge: {
        ...emptyProjectKnowledge(),
        chapters: {
          a: {
            sourceFingerprint: "previous-source",
            summary: "",
            premiseSignals: [],
            conflictSignals: [],
            stakeSignals: [],
            arcSignals: [],
            endingSignals: [],
            characterObservations: [
              {
                id: "previous-observation",
                characterId: "previous-observed",
                field: "history",
                detail: "Noted",
                evidence: [],
              },
            ],
            unknownCharacterObservations: [],
          },
          b: {
            sourceFingerprint: "source",
            summary: "",
            premiseSignals: [],
            conflictSignals: [],
            stakeSignals: [],
            arcSignals: [],
            endingSignals: [],
            characterObservations: [
              {
                id: "observation",
                characterId: "observed",
                field: "history",
                detail: "Noted",
                evidence: [],
              },
            ],
            unknownCharacterObservations: [],
          },
          c: {
            sourceFingerprint: "next-source",
            summary: "",
            premiseSignals: [],
            conflictSignals: [],
            stakeSignals: [],
            arcSignals: [],
            endingSignals: [],
            characterObservations: [
              {
                id: "next-observation",
                characterId: "next-observed",
                field: "history",
                detail: "Noted",
                evidence: [],
              },
            ],
            unknownCharacterObservations: [],
          },
        },
      },
    };

    const grounding = buildOutlinePlannerGrounding(
      {
        chapters,
        meta: plannerMeta,
        targetChapterId: "b",
        previous: manuscript("a"),
        target: manuscript("b"),
        next: manuscript("c"),
      },
      1_000,
    );
    const value = JSON.parse(grounding.split("\n").slice(1).join("\n")) as {
      characters: Array<{
        id: string;
        profile?: ReturnType<typeof emptyCharacterProfile>;
      }>;
    };

    expect(
      value.characters
        .filter((character) => character.profile !== undefined)
        .map((character) => character.id),
    ).toEqual([
      "previous",
      "target",
      "card",
      "next",
      "observed",
      "previous-observed",
      "next-observed",
    ]);
    expect(
      value.characters.find((character) => character.id === "unrelated"),
    ).toEqual({
      id: "unrelated",
      name: "Unrelated",
      role: "Pilot",
    });
  });
});
