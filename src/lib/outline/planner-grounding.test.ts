import { describe, expect, it } from "vitest";
import { buildOutlinePlannerGrounding } from "@/lib/outline/planner-grounding";
import {
  emptyCharacterProfile,
  emptyProjectKnowledge,
} from "@/lib/story-knowledge/model";
import type { ChapterRef, ProjectMeta } from "@/lib/types";

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
  blocks: [{ type: "narration" as const, text: `Prose ${chapterId}` }],
});

describe("buildOutlinePlannerGrounding", () => {
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
    expect(grounding).toContain('"prose": "Prose a"');
    expect(grounding).toContain('"prose": "Prose c"');
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
    expect(grounding).toContain('"prose": "Prose c"');
    expect(grounding).toContain('"prose": "Prose b"');
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

  it("limits the combined neighbor manuscript text to the supplied budget", () => {
    const longManuscript = (chapterId: string) => ({
      chapterId,
      title: chapterId.toUpperCase(),
      blocks: [
        {
          type: "narration" as const,
          text: `HEAD-${chapterId}-TAIL-${chapterId}`,
        },
      ],
    });

    const grounding = buildOutlinePlannerGrounding({
      chapters,
      meta,
      targetChapterId: "b",
      previous: longManuscript("a"),
      target: longManuscript("b"),
      next: longManuscript("c"),
    }, 18);
    const value = JSON.parse(grounding.split("\n").slice(1).join("\n")) as {
      manuscript: Record<
        "previous" | "target" | "next",
        { prose: string; truncated: boolean }
      >;
    };
    const manuscriptChapters = Object.values(value.manuscript);

    expect(
      manuscriptChapters.reduce(
        (total, chapter) => total + chapter.prose.length,
        0,
      ),
    ).toBeLessThanOrEqual(18);
    expect(manuscriptChapters.every((chapter) => chapter.truncated)).toBe(true);
    expect(grounding).not.toContain("TAIL");
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
