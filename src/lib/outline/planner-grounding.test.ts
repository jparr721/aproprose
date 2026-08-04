import { describe, expect, it } from "vitest";
import { buildOutlinePlannerGrounding } from "@/lib/outline/planner-grounding";
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
    });

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
    });
    const last = buildOutlinePlannerGrounding({
      chapters,
      meta,
      targetChapterId: "c",
      previous: manuscript("b"),
      target: manuscript("c"),
      next: null,
    });

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
    });

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
    });

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
      }),
    ).toThrow("Outline planner chapter not found: b");
  });
});
