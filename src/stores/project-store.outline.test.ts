import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "@/lib/migration";
import { useProjectStore } from "@/stores/project-store";

beforeEach(() => {
  useProjectStore.setState({
    project: null,
    meta: { version: 2, characters: [], lore: [], statuses: {}, outline: { premise: "" }, chapters: {} },
  } as never);
});

describe("runMigrations", () => {
  it("migrates a legacy blob and keeps premise", () => {
    const m = runMigrations({
      outline: { premise: "P", acts: [{ kind: "setup", beats: [
        { title: "b", intention: "i", chapterIds: ["ch1"], type: "inciting" },
      ] }] },
      chapterBeats: { ch1: { goal: "g", conflict: "", turn: "" } },
    } as never);
    expect(m.outline.premise).toBe("P");
    expect(m.chapters.ch1.cards[0].title).toBe("b");
    expect(m.chapters.ch1.goal).toBe("g");
  });
  it("passes a new-shape blob through", () => {
    const m = runMigrations({ outline: { premise: "X" }, chapters: { ch1: { act: "setup", plotPoint: null, premise: "", goal: "", conflict: "", turn: "", cards: [] } } } as never);
    expect(m.chapters.ch1.act).toBe("setup");
  });
  it("backfills characterIds on chapters that predate the field", () => {
    const m = runMigrations({ outline: { premise: "X" }, chapters: { ch1: { act: "setup", plotPoint: null, premise: "", goal: "", conflict: "", turn: "", cards: [] } } } as never);
    expect(m.chapters.ch1.characterIds).toEqual([]);
  });
});

describe("card + chapter actions", () => {
  it("adds and edits a card", () => {
    const id = useProjectStore.getState().addCard("ch1");
    useProjectStore.getState().editCard("ch1", id, { title: "Hello" });
    expect(useProjectStore.getState().meta.chapters.ch1.cards[0].title).toBe("Hello");
  });
  it("moves a card between chapters", () => {
    const id = useProjectStore.getState().addCard("ch1");
    useProjectStore.getState().moveCardToChapter("ch1", "ch2", id, 0);
    expect(useProjectStore.getState().meta.chapters.ch2.cards.map((c) => c.id)).toEqual([id]);
  });
  it("sets a chapter act and field", () => {
    useProjectStore.getState().setChapterAct("ch1", "confrontation");
    useProjectStore.getState().setChapterField("ch1", { goal: "win" });
    const ch = useProjectStore.getState().meta.chapters.ch1;
    expect(ch).toMatchObject({ act: "confrontation", goal: "win" });
  });
  it("assigns and unassigns a chapter cast", () => {
    useProjectStore.getState().addCharacterToChapter("ch1", "c1");
    useProjectStore.getState().addCharacterToChapter("ch1", "c2");
    expect(useProjectStore.getState().meta.chapters.ch1.characterIds).toEqual(["c1", "c2"]);
    useProjectStore.getState().removeCharacterFromChapter("ch1", "c1");
    expect(useProjectStore.getState().meta.chapters.ch1.characterIds).toEqual(["c2"]);
  });
});