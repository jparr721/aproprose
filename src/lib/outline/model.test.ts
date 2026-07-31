import { describe, expect, it } from "vitest";
import {
  actPacing,
  addCard,
  addCharacterToChapter,
  applyGuidedOutlinePlan,
  chapterMatchesGuidedOutlinePlan,
  editCard,
  emptyChapterOutline,
  moveCardToChapter,
  moveCardWithin,
  removeCard,
  removeCharacterFromChapter,
  setChapterAct,
} from "@/lib/outline/model";
import type {
  ChapterOutline,
  ChapterRef,
  GuidedOutlinePlan,
} from "@/lib/types";

const ref = (id: string, wordCount: number): ChapterRef => ({
  id, label: id, title: id, file: `${id}.tex`, wordCount,
});

describe("card ops", () => {
  it("adds a card to a (possibly missing) chapter and returns its id", () => {
    const { chapters, cardId } = addCard({}, "ch1");
    expect(chapters.ch1.cards.map((c) => c.id)).toEqual([cardId]);
    expect(chapters.ch1.act).toBeNull();
  });

  it("edits a card's title/intention immutably", () => {
    const a = addCard({}, "ch1");
    const next = editCard(a.chapters, "ch1", a.cardId, { title: "T", intention: "I" });
    expect(next.ch1.cards[0]).toMatchObject({ title: "T", intention: "I" });
    expect(a.chapters.ch1.cards[0].title).toBe(""); // input untouched
  });

  it("reorders cards within a chapter", () => {
    let chapters = addCard({}, "ch1").chapters;
    const second = addCard(chapters, "ch1");
    chapters = second.chapters;
    const firstId = chapters.ch1.cards[0].id;
    const moved = moveCardWithin(chapters, "ch1", firstId, 1);
    expect(moved.ch1.cards[1].id).toBe(firstId);
  });

  it("moves a card between chapters (re-parenting)", () => {
    const a = addCard({}, "ch1");
    const moved = moveCardToChapter(a.chapters, "ch1", "ch2", a.cardId, 0);
    expect(moved.ch1.cards).toHaveLength(0);
    expect(moved.ch2.cards.map((c) => c.id)).toEqual([a.cardId]);
  });

  it("removes a card", () => {
    const a = addCard({}, "ch1");
    expect(removeCard(a.chapters, "ch1", a.cardId).ch1.cards).toHaveLength(0);
  });
});

describe("actPacing", () => {
  it("sums word counts by each chapter's act; shares are over placed chapters", () => {
    const chapters: Record<string, ChapterOutline> = {
      ch1: { ...emptyChapterOutline(), act: "setup" },
      ch2: { ...emptyChapterOutline(), act: "confrontation" },
    };
    const p = actPacing(chapters, [ref("ch1", 250), ref("ch2", 750)]);
    expect(p.setup.words).toBe(250);
    expect(p.confrontation.actualShare).toBeCloseTo(0.75);
    expect(p.resolution.words).toBe(0);
  });
});

describe("applyGuidedOutlinePlan", () => {
  it("replaces the chapter spine and ordered beats with the reviewed plan", () => {
    const plan: GuidedOutlinePlan = {
      chapterId: "ch1",
      summary: "Mara chooses the dangerous route.",
      act: "confrontation",
      plotPoint: "midpoint",
      premise: "Mara learns the road is watched.",
      goal: "Cross the border unseen.",
      conflict: "The patrol knows her disguise.",
      turn: "She burns the papers and takes the mountain pass.",
      characterIds: ["mara"],
      beats: [
        {
          sourceCardId: null,
          title: "The checkpoint",
          intention: "Force Mara to choose between her cover and the mission.",
          characterIds: ["mara"],
          loreIds: ["north-road"],
        },
        {
          sourceCardId: null,
          title: "The papers burn",
          intention: "Make her choice irreversible.",
          characterIds: ["mara"],
          loreIds: [],
        },
      ],
    };

    const result = applyGuidedOutlinePlan({}, "ch1", plan).ch1;

    expect(result).toMatchObject({
      act: "confrontation",
      plotPoint: "midpoint",
      premise: "Mara learns the road is watched.",
      goal: "Cross the border unseen.",
      conflict: "The patrol knows her disguise.",
      turn: "She burns the papers and takes the mountain pass.",
      characterIds: ["mara"],
    });
    expect(result.cards.map(({ title, intention, characterIds, loreIds }) => ({
      title,
      intention,
      characterIds,
      loreIds,
    }))).toEqual([
      {
        title: "The checkpoint",
        intention: "Force Mara to choose between her cover and the mission.",
        characterIds: ["mara"],
        loreIds: ["north-road"],
      },
      {
        title: "The papers burn",
        intention: "Make her choice irreversible.",
        characterIds: ["mara"],
        loreIds: [],
      },
    ]);
  });

  it("preserves the identity and continuity findings of a referenced card", () => {
    const existing: ChapterOutline = {
      ...emptyChapterOutline(),
      cards: [
        {
          id: "card-1",
          title: "Old checkpoint",
          intention: "Get stopped.",
          characterIds: ["mara"],
          loreIds: [],
          continuityFlags: [
            { sev: "warn", tag: "Props", text: "The papers changed color.", blockIds: [] },
          ],
        },
      ],
    };
    const plan: GuidedOutlinePlan = {
      chapterId: "ch1",
      summary: "Tighten the checkpoint.",
      act: null,
      plotPoint: null,
      premise: "",
      goal: "",
      conflict: "",
      turn: "",
      characterIds: ["mara"],
      beats: [
        {
          sourceCardId: "card-1",
          title: "The checkpoint closes",
          intention: "Force Mara to abandon the papers.",
          characterIds: ["mara"],
          loreIds: [],
        },
      ],
    };

    const result = applyGuidedOutlinePlan({ ch1: existing }, "ch1", plan).ch1.cards[0];

    expect(result.id).toBe("card-1");
    expect(result.continuityFlags).toEqual([
      { sev: "warn", tag: "Props", text: "The papers changed color.", blockIds: [] },
    ]);
  });

  it("reports whether the visible outline still matches the reviewed plan", () => {
    const plan: GuidedOutlinePlan = {
      chapterId: "ch1",
      summary: "A choice becomes irreversible.",
      act: "setup",
      plotPoint: "inciting",
      premise: "Mara receives the summons.",
      goal: "Keep her family out of the war.",
      conflict: "The summons names her brother.",
      turn: "Mara answers in his place.",
      characterIds: ["mara"],
      beats: [
        {
          sourceCardId: null,
          title: "The seal breaks",
          intention: "Reveal the demand.",
          characterIds: ["mara"],
          loreIds: ["summons"],
        },
      ],
    };
    const applied = applyGuidedOutlinePlan({}, "ch1", plan).ch1;

    expect(chapterMatchesGuidedOutlinePlan(applied, plan)).toBe(true);
    expect(chapterMatchesGuidedOutlinePlan(
      { ...applied, turn: "Mara burns the summons." },
      plan,
    )).toBe(false);
  });

  it("requires Apply when a new beat would discard a card's continuity findings", () => {
    const plan: GuidedOutlinePlan = {
      chapterId: "ch1",
      summary: "A choice becomes irreversible.",
      act: null,
      plotPoint: null,
      premise: "",
      goal: "",
      conflict: "",
      turn: "",
      characterIds: [],
      beats: [{
        sourceCardId: null,
        title: "The seal breaks",
        intention: "Reveal the demand.",
        characterIds: [],
        loreIds: [],
      }],
    };
    const chapter = applyGuidedOutlinePlan({}, "ch1", plan).ch1;
    const withContinuityFinding: ChapterOutline = {
      ...chapter,
      cards: [{
        ...chapter.cards[0],
        continuityFlags: [{ sev: "warn", tag: "Props", text: "The seal is already broken.", blockIds: [] }],
      }],
    };

    expect(chapterMatchesGuidedOutlinePlan(withContinuityFinding, plan)).toBe(false);
  });

  it("requires Apply when a beat targets a different card with the same content", () => {
    const plan: GuidedOutlinePlan = {
      chapterId: "ch1",
      summary: "A choice becomes irreversible.",
      act: null,
      plotPoint: null,
      premise: "",
      goal: "",
      conflict: "",
      turn: "",
      characterIds: [],
      beats: [{
        sourceCardId: "card-2",
        title: "The seal breaks",
        intention: "Reveal the demand.",
        characterIds: [],
        loreIds: [],
      }],
    };
    const chapter: ChapterOutline = {
      ...emptyChapterOutline(),
      cards: [{
        id: "card-1",
        title: "The seal breaks",
        intention: "Reveal the demand.",
        characterIds: [],
        loreIds: [],
        continuityFlags: [],
      }],
    };

    expect(chapterMatchesGuidedOutlinePlan(chapter, plan)).toBe(false);
  });
});

describe("setChapterAct", () => {
  it("sets the act, lazily creating the entry", () => {
    expect(setChapterAct({}, "ch1", "resolution").ch1.act).toBe("resolution");
  });
});

describe("chapter cast", () => {
  it("adds a character to a (possibly missing) chapter, deduping", () => {
    const once = addCharacterToChapter({}, "ch1", "c1");
    expect(once.ch1.characterIds).toEqual(["c1"]);
    const twice = addCharacterToChapter(once, "ch1", "c1");
    expect(twice.ch1.characterIds).toEqual(["c1"]);
  });

  it("removes a character without touching others", () => {
    const seeded = addCharacterToChapter(addCharacterToChapter({}, "ch1", "c1"), "ch1", "c2");
    expect(removeCharacterFromChapter(seeded, "ch1", "c1").ch1.characterIds).toEqual(["c2"]);
  });

  it("does not mutate the input map", () => {
    const seeded = addCharacterToChapter({}, "ch1", "c1");
    addCharacterToChapter(seeded, "ch1", "c2");
    expect(seeded.ch1.characterIds).toEqual(["c1"]);
  });
});
