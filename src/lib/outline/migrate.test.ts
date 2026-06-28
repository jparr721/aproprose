import { describe, expect, it } from "vitest";
import { isNewShapeMeta, migrateLegacyMeta } from "@/lib/outline/migrate";

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

describe("migrateLegacyMeta", () => {
  it("keeps the global premise", () => {
    expect(migrateLegacyMeta(legacy).outline.premise).toBe("A logline.");
  });
  it("turns a linked beat into a card under its chapter and sets act + plotPoint", () => {
    const ch1 = migrateLegacyMeta(legacy).chapters.ch1;
    expect(ch1.act).toBe("setup");
    expect(ch1.plotPoint).toBe("inciting");
    expect(ch1.cards).toHaveLength(1);
    expect(ch1.cards[0]).toMatchObject({ title: "Inciting", intention: "kick off", characterIds: ["c1"] });
  });
  it("carries goal/conflict/turn from chapterBeats", () => {
    expect(migrateLegacyMeta(legacy).chapters.ch1).toMatchObject({ goal: "G", conflict: "C", turn: "T" });
  });
  it("drops beats that linked to no chapter", () => {
    const all = Object.values(migrateLegacyMeta(legacy).chapters).flatMap((c) => c.cards);
    expect(all.some((c) => c.title === "Orphan")).toBe(false);
  });
  it("produces empty chapters/premise from an empty blob", () => {
    const m = migrateLegacyMeta({});
    expect(m.chapters).toEqual({});
    expect(m.outline.premise).toBe("");
  });
});

describe("isNewShapeMeta", () => {
  it("is false for legacy and true for migrated", () => {
    expect(isNewShapeMeta(legacy)).toBe(false);
    expect(isNewShapeMeta(migrateLegacyMeta(legacy))).toBe(true);
  });
});
