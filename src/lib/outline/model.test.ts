import { describe, it, expect } from "vitest";
import {
  ACT_TARGETS,
  defaultOutline,
  beatForChapter,
  findBeat,
  assignChapter,
  unassignChapter,
  addBeat,
  removeBeat,
  moveBeat,
  moveBeatTo,
  editBeat,
  editPremise,
  actPacing,
  unplacedChapters,
  setBeatType,
  addCharacterToBeat,
  removeCharacterFromBeat,
  addLoreToBeat,
  removeLoreFromBeat,
  setBeatContinuityFlags,
  applySculpt,
} from "@/lib/outline/model";
import type { ChapterRef, ContinuityFlag, SculptProposal } from "@/lib/types";

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

describe("setBeatType", () => {
  it("sets the type immutably", () => {
    const o = defaultOutline();
    const id = o.acts[0].beats[0].id;
    const next = setBeatType(o, id, "climax");
    expect(next.acts[0].beats[0].type).toBe("climax");
    expect(o.acts[0].beats[0].type).toBe("plot-point");
  });
});

describe("addCharacterToBeat / removeCharacterFromBeat", () => {
  it("adds without duplicating and removes cleanly", () => {
    const o = defaultOutline();
    const id = o.acts[0].beats[0].id;
    const a = addCharacterToBeat(o, id, "ch1");
    const b = addCharacterToBeat(a, id, "ch1"); // idempotent
    expect(b.acts[0].beats[0].characterIds).toEqual(["ch1"]);
    const c = removeCharacterFromBeat(b, id, "ch1");
    expect(c.acts[0].beats[0].characterIds).toEqual([]);
    expect(o.acts[0].beats[0].characterIds).toEqual([]); // input untouched
  });
});

describe("addLoreToBeat / removeLoreFromBeat", () => {
  it("adds without duplicating and removes cleanly", () => {
    const o = defaultOutline();
    const id = o.acts[1].beats[0].id;
    const a = addLoreToBeat(o, id, "l1");
    const b = addLoreToBeat(a, id, "l1"); // idempotent
    expect(b.acts[1].beats[0].loreIds).toEqual(["l1"]);
    const c = removeLoreFromBeat(b, id, "l1");
    expect(c.acts[1].beats[0].loreIds).toEqual([]);
  });
});

describe("setBeatContinuityFlags", () => {
  it("replaces the flags array immutably", () => {
    const o = defaultOutline();
    const id = o.acts[0].beats[0].id;
    const flags: ContinuityFlag[] = [{ sev: "warn", tag: "Timeline", text: "Off by a day." }];
    const next = setBeatContinuityFlags(o, id, flags);
    expect(next.acts[0].beats[0].continuityFlags).toEqual(flags);
    expect(o.acts[0].beats[0].continuityFlags).toEqual([]);
  });
});

describe("moveBeatTo", () => {
  it("reorders within the same act, clamping the index", () => {
    const o = defaultOutline();
    const firstId = o.acts[0].beats[0].id;
    const moved = moveBeatTo(o, firstId, "setup", 2);
    expect(moved.acts[0].beats[2].id).toBe(firstId);
    const clampedHigh = moveBeatTo(o, firstId, "setup", 99);
    expect(clampedHigh.acts[0].beats.at(-1)!.id).toBe(firstId);
    const clampedLow = moveBeatTo(o, firstId, "setup", -5);
    expect(clampedLow.acts[0].beats[0].id).toBe(firstId);
    expect(clampedLow.acts[0].beats).toHaveLength(3); // no growth
  });

  it("moves a beat across acts, preserving its fields", () => {
    let o = defaultOutline();
    o = setBeatType(o, o.acts[0].beats[0].id, "climax");
    const beatId = o.acts[0].beats[0].id;
    const next = moveBeatTo(o, beatId, "resolution", 0);
    expect(next.acts[0].beats.find((b) => b.id === beatId)).toBeUndefined();
    expect(next.acts[2].beats[0].id).toBe(beatId);
    expect(next.acts[2].beats[0].type).toBe("climax"); // carried over
    expect(o.acts[0].beats[0].id).toBe(beatId); // input untouched
  });
});

describe("findBeat", () => {
  it("returns the beat across any act", () => {
    const o = defaultOutline();
    const target = o.acts[1].beats[0];
    expect(findBeat(o, target.id)).toEqual(target);
  });

  it("returns null when the id is absent", () => {
    expect(findBeat(defaultOutline(), "nope")).toBeNull();
  });
});

describe("Beat type fields (1.1 + 1.3)", () => {
  it("seeds every beat with the new typed fields", () => {
    const o = defaultOutline();
    const b = o.acts[0].beats[0];
    expect(b.type).toBeDefined();
    expect(b.characterIds).toEqual([]);
    expect(b.loreIds).toEqual([]);
    expect(b.continuityFlags).toEqual([]);
  });

  it("seeds beats with a structural type matching their title", () => {
    const o = defaultOutline();
    expect(o.acts[0].beats.map((b) => b.type)).toEqual([
      "plot-point",
      "inciting",
      "plot-point",
    ]);
    expect(o.acts[1].beats[1].type).toBe("midpoint");
    expect(o.acts[2].beats[0].type).toBe("climax");
  });

  it("addBeat creates a neutral 'action' beat with empty link arrays", () => {
    const o = defaultOutline();
    const { outline, beatId } = addBeat(o, "setup", null);
    const b = outline.acts[0].beats.find((x) => x.id === beatId)!;
    expect(b.type).toBe("action");
    expect(b.characterIds).toEqual([]);
    expect(b.loreIds).toEqual([]);
    expect(b.continuityFlags).toEqual([]);
  });
});

describe("applySculpt", () => {
  it("applies only kept changes, in proposal order, via the model fns", () => {
    const o = defaultOutline();
    const setupBeats = o.acts[0].beats; // Opening Image, Inciting Incident, Plot Point 1
    const rewriteId = setupBeats[0].id;
    const moveId = setupBeats[2].id;
    const removeId = setupBeats[1].id;

    const proposal: SculptProposal = {
      actKind: "setup",
      summary: "Tighten the opening.",
      changes: [
        {
          kind: "rewrite",
          beatId: rewriteId,
          title: "Cold Open",
          intention: "Drop us mid-action.",
          type: "inciting",
          toIndex: null,
          reason: "Hook faster.",
        },
        {
          kind: "add",
          beatId: null,
          title: "Threshold",
          intention: "Door closes behind them.",
          type: "plot-point",
          toIndex: null,
          reason: "Needs a commit beat.",
        },
        {
          kind: "move",
          beatId: moveId,
          title: null,
          intention: null,
          type: null,
          toIndex: 0,
          reason: "Pull the turn earlier.",
        },
        {
          kind: "remove",
          beatId: removeId,
          title: null,
          intention: null,
          type: null,
          toIndex: null,
          reason: "Redundant.",
        },
      ],
    };

    // Keep rewrite (0) and add (1); skip move (2) and remove (3).
    const next = applySculpt(o, proposal, [0, 1]);
    const beats = next.acts[0].beats;

    const rewritten = beats.find((b) => b.id === rewriteId);
    expect(rewritten?.title).toBe("Cold Open");
    expect(rewritten?.intention).toBe("Drop us mid-action.");
    expect(rewritten?.type).toBe("inciting");

    // add appended a NEW beat with the proposed fields and a fresh id
    const added = beats.find((b) => b.title === "Threshold");
    expect(added).toBeDefined();
    expect(added?.type).toBe("plot-point");
    expect(added?.intention).toBe("Door closes behind them.");

    // skipped move/remove left these untouched
    expect(beats.find((b) => b.id === moveId)).toBeDefined();
    expect(beats.find((b) => b.id === removeId)).toBeDefined();
  });

  it("applies move and remove when kept", () => {
    const o = defaultOutline();
    const moveId = o.acts[0].beats[2].id;
    const removeId = o.acts[0].beats[1].id;
    const proposal: SculptProposal = {
      actKind: "setup",
      summary: "",
      changes: [
        { kind: "move", beatId: moveId, title: null, intention: null, type: null, toIndex: 0, reason: "" },
        { kind: "remove", beatId: removeId, title: null, intention: null, type: null, toIndex: null, reason: "" },
      ],
    };
    const next = applySculpt(o, proposal, [0, 1]);
    expect(next.acts[0].beats[0].id).toBe(moveId);
    expect(next.acts[0].beats.find((b) => b.id === removeId)).toBeUndefined();
  });

  it("with no kept indices returns an equivalent outline and never mutates input", () => {
    const o = defaultOutline();
    const proposal: SculptProposal = {
      actKind: "setup",
      summary: "",
      changes: [
        { kind: "remove", beatId: o.acts[0].beats[0].id, title: null, intention: null, type: null, toIndex: null, reason: "" },
      ],
    };
    const next = applySculpt(o, proposal, []);
    expect(next.acts[0].beats).toHaveLength(o.acts[0].beats.length);
    expect(o.acts[0].beats).toHaveLength(3); // input untouched
  });
});
