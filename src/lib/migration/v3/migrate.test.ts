import { describe, expect, it } from "vitest";
import { runMigrations, CURRENT_VERSION } from "@/lib/migration";

const blob = (flags: unknown[]) => ({
  version: 2,
  characters: [],
  lore: [],
  statuses: {},
  outline: { premise: "" },
  chapters: {
    ch1: {
      act: null, plotPoint: null, premise: "", goal: "", conflict: "", turn: "",
      characterIds: [],
      cards: [{ id: "card1", title: "Beat", intention: "", characterIds: [], loreIds: [], continuityFlags: flags }],
    },
  },
});

describe("v3 migration (continuity flag blockIds)", () => {
  it("is registered: CURRENT_VERSION is 3", () => {
    expect(CURRENT_VERSION).toBe(3);
  });

  it("backfills blockIds: [] on persisted flags that lack it", () => {
    const m = runMigrations(blob([{ sev: "warn", tag: "Cast", text: "Who is present?" }]));
    expect(m.chapters.ch1.cards[0].continuityFlags).toEqual([
      { sev: "warn", tag: "Cast", text: "Who is present?", blockIds: [] },
    ]);
    expect(m.version).toBe(3);
  });

  it("preserves blockIds already present on a flag (round-trip safety)", () => {
    const m = runMigrations(blob([{ sev: "flag", tag: "Props", text: "The knife moved.", blockIds: ["b-1", "b-2"] }]));
    expect(m.chapters.ch1.cards[0].continuityFlags[0].blockIds).toEqual(["b-1", "b-2"]);
  });
});
