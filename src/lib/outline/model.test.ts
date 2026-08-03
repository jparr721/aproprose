import { describe, expect, it } from "vitest";
import {
  actPacing,
  addCard,
  addCharacterToChapter,
  applySculpt,
  editCard,
  emptyChapterOutline,
  moveCardToChapter,
  moveCardWithin,
  removeCard,
  removeCharacterFromChapter,
  setChapterAct,
} from "@/lib/outline/model";
import type { ChapterOutline, ChapterRef, SculptProposal } from "@/lib/types";

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

describe("applySculpt over cards", () => {
  it("applies only kept add/rewrite changes to the chapter's cards", () => {
    const seeded = addCard({}, "ch1");
    const proposal: SculptProposal = {
      chapterId: "ch1",
      summary: "tighten",
      changes: [
        { kind: "rewrite", cardId: seeded.cardId, title: "New", intention: null, toIndex: null, reason: "x" },
        { kind: "add", cardId: null, title: "Added", intention: "i", toIndex: null, reason: "y" },
      ],
    };
    const out = applySculpt(seeded.chapters, "ch1", proposal, [0, 1]);
    expect(out.ch1.cards[0].title).toBe("New");
    expect(out.ch1.cards.some((c) => c.title === "Added")).toBe(true);
  });

  it("skips a change whose card no longer exists", () => {
    const proposal: SculptProposal = {
      chapterId: "ch1", summary: "", changes: [
        { kind: "remove", cardId: "missing", title: null, intention: null, toIndex: null, reason: "z" },
      ],
    };
    expect(applySculpt({}, "ch1", proposal, [0])).toEqual({});
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
