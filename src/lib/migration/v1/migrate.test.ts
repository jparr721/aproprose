import { describe, expect, it } from "vitest";
import { runMigrations } from "@/lib/migration";

const legacy = {
  characters: [{ id: "c1", name: "Mara", color: "oklch(0 0 0)", role: "POV" }],
  lore: [],
  statuses: {},
  outline: {
    premise: "A logline.",
    acts: [
      { kind: "setup", title: "Setup", summary: "", beats: [
        { id: "b1", title: "Inciting", intention: "kick off", chapterIds: ["ch1"], type: "inciting", characterIds: ["c1"], loreIds: [], continuityFlags: [] },
        { id: "b2", title: "Orphan", intention: "no chapter", chapterIds: [], type: "plot-point", characterIds: [], loreIds: [], continuityFlags: [] },
      ] },
      { kind: "confrontation", title: "Confrontation", summary: "", beats: [] },
      { kind: "resolution", title: "Resolution", summary: "", beats: [] },
    ],
  },
  chapterBeats: { ch1: { goal: "G", conflict: "C", turn: "T" } },
};

describe("v1 migration", () => {
  it("keeps the global premise", () => {
    expect(runMigrations(legacy).outline.premise).toBe("A logline.");
  });
  it("turns a linked beat into a card under its chapter and sets act + plotPoint", () => {
    const ch1 = runMigrations(legacy).chapters.ch1;
    expect(ch1.act).toBe("setup");
    expect(ch1.plotPoint).toBe("inciting");
    expect(ch1.cards).toHaveLength(1);
    expect(ch1.cards[0]).toMatchObject({ title: "Inciting", intention: "kick off", characterIds: ["c1"] });
  });
  it("carries goal/conflict/turn from chapterBeats", () => {
    expect(runMigrations(legacy).chapters.ch1).toMatchObject({ goal: "G", conflict: "C", turn: "T" });
  });
  it("drops beats that linked to no chapter", () => {
    const all = Object.values(runMigrations(legacy).chapters).flatMap((c) => c.cards);
    expect(all.some((c: { title: string }) => c.title === "Orphan")).toBe(false);
  });
  it("produces empty chapters/premise from an empty blob", () => {
    const m = runMigrations({});
    expect(m.chapters).toEqual({});
    expect(m.outline.premise).toBe("");
  });
  it("stamps version 2 on legacy blobs", () => {
    expect(runMigrations(legacy).version).toBe(2);
  });
});

describe("new-shape pass-through", () => {
  it("preserves chapters in new-shape blobs", () => {
    const m = runMigrations({
      outline: { premise: "X" },
      chapters: { ch1: { act: "setup", plotPoint: null, premise: "", goal: "", conflict: "", turn: "", characterIds: [], cards: [] } },
    } as never);
    expect(m.chapters.ch1.act).toBe("setup");
    expect(m.chapters.ch1.characterIds).toEqual([]);
  });
});

describe("v2 migration (lore backfill)", () => {
  it("backfills description/characterIds/tags on bare lore entries", () => {
    const m = runMigrations({
      version: 1,
      characters: [],
      lore: [{ id: "l1", title: "Tile" }],
      statuses: {},
      outline: { premise: "" },
      chapters: {},
    } as never);
    expect(m.lore[0]).toMatchObject({ id: "l1", title: "Tile", description: "", characterIds: [], tags: [] });
    expect(m.version).toBe(2);
  });
  it("passes through already-full lore entries unchanged", () => {
    const m = runMigrations({
      version: 1,
      characters: [],
      lore: [{ id: "l1", title: "Tile", description: "A tile", characterIds: ["c1"], tags: ["magic"] }],
      statuses: {},
      outline: { premise: "" },
      chapters: {},
    } as never);
    expect(m.lore[0]).toMatchObject({ id: "l1", title: "Tile", description: "A tile", characterIds: ["c1"], tags: ["magic"] });
  });
});