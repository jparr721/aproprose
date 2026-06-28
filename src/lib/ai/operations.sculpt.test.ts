import { describe, it, expect } from "vitest";
import { sanitizeSculpt } from "@/lib/ai/operations";
import type { SculptProposal } from "@/lib/types";

const base = (changes: SculptProposal["changes"]): SculptProposal => ({
  chapterId: "ch1",
  summary: "s",
  changes,
});

describe("sanitizeSculpt", () => {
  it("drops rewrite/move/remove changes whose cardId is not in the chapter", () => {
    const p = base([
      { kind: "rewrite", cardId: "ghost", title: "X", intention: null, toIndex: null, reason: "r" },
      { kind: "move", cardId: "ghost", title: null, intention: null, toIndex: 1, reason: "r" },
      { kind: "remove", cardId: "ghost", title: null, intention: null, toIndex: null, reason: "r" },
    ]);
    expect(sanitizeSculpt(p, ["b1", "b2"]).changes).toEqual([]);
  });

  it("keeps add changes (cardId null) and valid-target changes", () => {
    const p = base([
      { kind: "add", cardId: null, title: "New", intention: "i", toIndex: null, reason: "r" },
      { kind: "rewrite", cardId: "b1", title: "T", intention: null, toIndex: null, reason: "r" },
    ]);
    const out = sanitizeSculpt(p, ["b1", "b2"]);
    expect(out.changes).toHaveLength(2);
    expect(out.changes[0].kind).toBe("add");
    expect(out.changes[1].cardId).toBe("b1");
  });

  it("drops a move whose toIndex is null (nowhere to move)", () => {
    const p = base([
      { kind: "move", cardId: "b1", title: null, intention: null, toIndex: null, reason: "r" },
    ]);
    expect(sanitizeSculpt(p, ["b1"]).changes).toEqual([]);
  });

  it("drops a rewrite that proposes no title or intention (a no-op)", () => {
    const p = base([
      { kind: "rewrite", cardId: "b1", title: null, intention: null, toIndex: null, reason: "r" },
    ]);
    expect(sanitizeSculpt(p, ["b1"]).changes).toEqual([]);
  });

  it("does not mutate the input proposal", () => {
    const p = base([
      { kind: "remove", cardId: "ghost", title: null, intention: null, toIndex: null, reason: "r" },
    ]);
    sanitizeSculpt(p, ["b1"]);
    expect(p.changes).toHaveLength(1);
  });
});
