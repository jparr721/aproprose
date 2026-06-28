import { describe, expect, it } from "vitest";
import { renderStoryStructure } from "@/lib/outline/grounding";
import { emptyChapterOutline } from "@/lib/outline/model";
import type { Character } from "@/lib/types";

const roster: Character[] = [
  { id: "c1", name: "Mara", color: "oklch(0.5 0 0)", role: "lead" },
  { id: "c2", name: "Joren", color: "oklch(0.5 0 0)", role: "foil" },
];

describe("renderStoryStructure", () => {
  it("returns null when nothing is filled", () => {
    expect(renderStoryStructure({ outline: { premise: "" }, chapters: {}, characters: [], activeChapterId: null })).toBeNull();
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
      characters: [],
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
      characters: [],
      activeChapterId: "ch1",
    });
    expect(out).toContain("Goal: G");
    expect(out).not.toContain("Act ");
  });
  it("renders the expected cast (resolved names) when the chapter has one", () => {
    const out = renderStoryStructure({
      outline: { premise: "" },
      chapters: { ch1: { ...emptyChapterOutline(), characterIds: ["c1", "c2", "missing"] } },
      characters: roster,
      activeChapterId: "ch1",
    });
    expect(out).toBe("Expected cast in this chapter: Mara, Joren.");
  });
  it("emits no cast line for an empty or fully-dangling cast", () => {
    expect(
      renderStoryStructure({
        outline: { premise: "" },
        chapters: { ch1: { ...emptyChapterOutline(), characterIds: ["missing"] } },
        characters: roster,
        activeChapterId: "ch1",
      }),
    ).toBeNull();
  });
});
