import { describe, expect, it } from "vitest";
import { renderStoryStructure } from "@/lib/outline/grounding";
import { emptyChapterOutline } from "@/lib/outline/model";

describe("renderStoryStructure", () => {
  it("returns null when nothing is filled", () => {
    expect(renderStoryStructure({ outline: { premise: "" }, chapters: {}, activeChapterId: null })).toBeNull();
  });
  it("renders premise + chapter act + arc + cards", () => {
    const out = renderStoryStructure({
      outline: { premise: "A logline." },
      chapters: {
        ch1: {
          ...emptyChapterOutline(),
          act: "confrontation",
          premise: "Mara leaves.",
          goal: "G", conflict: "C", turn: "T",
          cards: [{ id: "x", title: "Reads letter", intention: "kick off", characterIds: [], loreIds: [], continuityFlags: [] }],
        },
      },
      activeChapterId: "ch1",
    });
    expect(out).toContain("Premise: A logline.");
    expect(out).toContain("Act II - Confrontation");
    expect(out).toContain("Goal: G");
    expect(out).toContain("Reads letter");
  });
  it("omits the act line when the chapter has no act", () => {
    const out = renderStoryStructure({
      outline: { premise: "" },
      chapters: { ch1: { ...emptyChapterOutline(), goal: "G" } },
      activeChapterId: "ch1",
    });
    expect(out).toContain("Goal: G");
    expect(out).not.toContain("Act ");
  });
});
