import { describe, it, expect } from "vitest";
import { renderStoryStructure } from "@/lib/outline/grounding";
import { defaultOutline, assignChapter, editPremise } from "@/lib/outline/model";
import type { ChapterRef } from "@/lib/types";

const chapters: ChapterRef[] = [
  { id: "c1", label: "1", title: "One", file: "c1.tex", wordCount: 0 },
];

describe("renderStoryStructure", () => {
  it("returns null when nothing is set (the no-op guarantee)", () => {
    const out = renderStoryStructure({
      outline: defaultOutline(),
      chapterBeats: {},
      activeChapterId: "c1",
      chapters,
    });
    expect(out).toBeNull();
  });

  it("includes premise, the served beat, and the chapter arc when present", () => {
    let o = defaultOutline();
    o = editPremise(o, "An archivist is watched.");
    const beatId = o.acts[1].beats[1].id; // Midpoint
    o = assignChapter(o, "c1", beatId);
    const out = renderStoryStructure({
      outline: o,
      chapterBeats: { c1: { goal: "Prove it.", conflict: "It is real.", turn: "" } },
      activeChapterId: "c1",
      chapters,
    });
    expect(out).toContain("Premise: An archivist is watched.");
    expect(out).toContain("This scene is in Act II - Confrontation");
    expect(out).toContain('It serves the beat "Midpoint"');
    expect(out).toContain("Goal: Prove it.");
    expect(out).toContain("Conflict: It is real.");
    expect(out).not.toContain("Turn:"); // empty fields dropped
  });

  it("says the scene is unplaced when the chapter is linked to no beat", () => {
    const o = editPremise(defaultOutline(), "A logline.");
    const out = renderStoryStructure({
      outline: o,
      chapterBeats: {},
      activeChapterId: "c1",
      chapters,
    });
    expect(out).toContain("Premise: A logline.");
    expect(out).toContain("This scene is not yet placed on the outline.");
  });
});
