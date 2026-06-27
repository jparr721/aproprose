import { describe, it, expect } from "vitest";
import {
  ACT_TARGETS,
  defaultOutline,
  beatForChapter,
  assignChapter,
  unassignChapter,
  addBeat,
  removeBeat,
  moveBeat,
  editBeat,
  editPremise,
  actPacing,
  unplacedChapters,
} from "@/lib/outline/model";
import type { ChapterRef } from "@/lib/types";

const ch = (id: string, wordCount: number): ChapterRef => ({
  id,
  label: id,
  title: id,
  file: `${id}.tex`,
  wordCount,
});

describe("defaultOutline", () => {
  it("seeds three acts in order with seeded beats and teaching copy", () => {
    const o = defaultOutline();
    expect(o.premise).toBe("");
    expect(o.acts.map((a) => a.kind)).toEqual(["setup", "confrontation", "resolution"]);
    expect(o.acts[0].beats.map((b) => b.title)).toEqual([
      "Opening Image",
      "Inciting Incident",
      "Plot Point 1",
    ]);
    expect(o.acts[0].beats[0].intention.length).toBeGreaterThan(0);
    expect(o.acts[0].beats[0].chapterIds).toEqual([]);
    // every beat id is unique
    const ids = o.acts.flatMap((a) => a.beats.map((b) => b.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("assignChapter (one-beat-per-chapter invariant)", () => {
  it("links a chapter and finds it back", () => {
    const o = defaultOutline();
    const beatId = o.acts[1].beats[1].id; // Midpoint
    const next = assignChapter(o, "c1", beatId);
    const found = beatForChapter(next, "c1");
    expect(found?.beat.id).toBe(beatId);
    expect(found?.act.kind).toBe("confrontation");
  });

  it("re-assigning moves the chapter, never duplicates it", () => {
    const o = defaultOutline();
    const first = o.acts[0].beats[0].id;
    const second = o.acts[2].beats[0].id;
    const a = assignChapter(o, "c1", first);
    const b = assignChapter(a, "c1", second);
    const allLinks = b.acts.flatMap((act) => act.beats.flatMap((bt) => bt.chapterIds));
    expect(allLinks.filter((x) => x === "c1")).toEqual(["c1"]); // exactly once
    expect(beatForChapter(b, "c1")?.beat.id).toBe(second);
  });

  it("does not mutate the input outline", () => {
    const o = defaultOutline();
    const beatId = o.acts[0].beats[0].id;
    assignChapter(o, "c1", beatId);
    expect(o.acts[0].beats[0].chapterIds).toEqual([]);
  });
});

describe("unassignChapter", () => {
  it("removes the chapter from wherever it is linked", () => {
    const base = defaultOutline();
    const beatId = base.acts[0].beats[0].id;
    const linked = assignChapter(base, "c1", beatId);
    const next = unassignChapter(linked, "c1");
    expect(beatForChapter(next, "c1")).toBeNull();
  });
});

describe("addBeat / removeBeat / moveBeat / editBeat", () => {
  it("adds a beat after a given beat and returns its id", () => {
    const o = defaultOutline();
    const after = o.acts[0].beats[0].id;
    const { outline, beatId } = addBeat(o, "setup", after);
    const titles = outline.acts[0].beats.map((b) => b.id);
    expect(titles).toHaveLength(4);
    expect(titles[1]).toBe(beatId); // inserted right after the first
  });

  it("removeBeat drops the beat and frees its chapters", () => {
    const o = defaultOutline();
    const beatId = o.acts[0].beats[0].id;
    const linked = assignChapter(o, "c1", beatId);
    const next = removeBeat(linked, beatId);
    expect(next.acts[0].beats.find((b) => b.id === beatId)).toBeUndefined();
    expect(beatForChapter(next, "c1")).toBeNull();
  });

  it("moveBeat reorders within its act and clamps at the ends", () => {
    const o = defaultOutline();
    const firstId = o.acts[0].beats[0].id;
    const down = moveBeat(o, firstId, 1);
    expect(down.acts[0].beats[1].id).toBe(firstId);
    const clamped = moveBeat(o, firstId, -1);
    expect(clamped.acts[0].beats[0].id).toBe(firstId);
  });

  it("editBeat patches title and intention only", () => {
    const o = defaultOutline();
    const id = o.acts[0].beats[0].id;
    const next = editBeat(o, id, { title: "New Title", intention: "New intention." });
    expect(next.acts[0].beats[0].title).toBe("New Title");
    expect(next.acts[0].beats[0].intention).toBe("New intention.");
  });
});

describe("editPremise", () => {
  it("sets the premise immutably", () => {
    const o = defaultOutline();
    const next = editPremise(o, "A logline.");
    expect(next.premise).toBe("A logline.");
    expect(o.premise).toBe("");
  });
});

describe("actPacing", () => {
  it("computes each act's share of linked words against its target", () => {
    let o = defaultOutline();
    o = assignChapter(o, "a", o.acts[0].beats[0].id); // setup
    o = assignChapter(o, "b", o.acts[1].beats[0].id); // confrontation
    const chapters = [ch("a", 380), ch("b", 620), ch("unlinked", 1000)];
    const p = actPacing(o, chapters);
    expect(p.setup.targetShare).toBe(ACT_TARGETS.setup);
    expect(p.setup.words).toBe(380);
    expect(p.confrontation.words).toBe(620);
    // shares are over LINKED words only (380 + 620 = 1000)
    expect(p.setup.actualShare).toBeCloseTo(0.38, 5);
    expect(p.confrontation.actualShare).toBeCloseTo(0.62, 5);
    expect(p.resolution.actualShare).toBe(0);
  });

  it("returns zero shares when nothing is linked", () => {
    const p = actPacing(defaultOutline(), [ch("a", 100)]);
    expect(p.setup.actualShare).toBe(0);
  });
});

describe("unplacedChapters", () => {
  it("lists chapters not linked to any beat", () => {
    const base = defaultOutline();
    const beatId = base.acts[0].beats[0].id;
    const linked = assignChapter(base, "a", beatId);
    const out = unplacedChapters(linked, [ch("a", 1), ch("b", 1)]);
    expect(out.map((c) => c.id)).toEqual(["b"]);
  });
});
