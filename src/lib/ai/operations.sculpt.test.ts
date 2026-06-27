import { describe, it, expect } from "vitest";
import { sanitizeSculpt } from "@/lib/ai/operations";
import type { SculptProposal } from "@/lib/types";

const base = (changes: SculptProposal["changes"]): SculptProposal => ({
  actKind: "setup",
  summary: "s",
  changes,
});

describe("sanitizeSculpt", () => {
  it("drops rewrite/move/remove changes whose beatId is not in the act", () => {
    const p = base([
      { kind: "rewrite", beatId: "ghost", title: "X", intention: null, type: null, toIndex: null, reason: "r" },
      { kind: "move", beatId: "ghost", title: null, intention: null, type: null, toIndex: 1, reason: "r" },
      { kind: "remove", beatId: "ghost", title: null, intention: null, type: null, toIndex: null, reason: "r" },
    ]);
    expect(sanitizeSculpt(p, ["b1", "b2"]).changes).toEqual([]);
  });

  it("keeps add changes (beatId null) and valid-target changes", () => {
    const p = base([
      { kind: "add", beatId: null, title: "New", intention: "i", type: "action", toIndex: null, reason: "r" },
      { kind: "rewrite", beatId: "b1", title: "T", intention: null, type: "midpoint", toIndex: null, reason: "r" },
    ]);
    const out = sanitizeSculpt(p, ["b1", "b2"]);
    expect(out.changes).toHaveLength(2);
    expect(out.changes[0].kind).toBe("add");
    expect(out.changes[1].beatId).toBe("b1");
  });

  it("drops a move whose toIndex is null (nowhere to move)", () => {
    const p = base([
      { kind: "move", beatId: "b1", title: null, intention: null, type: null, toIndex: null, reason: "r" },
    ]);
    expect(sanitizeSculpt(p, ["b1"]).changes).toEqual([]);
  });

  it("drops a rewrite that proposes no title, intention, or type (a no-op)", () => {
    const p = base([
      { kind: "rewrite", beatId: "b1", title: null, intention: null, type: null, toIndex: null, reason: "r" },
    ]);
    expect(sanitizeSculpt(p, ["b1"]).changes).toEqual([]);
  });

  it("does not mutate the input proposal", () => {
    const p = base([
      { kind: "remove", beatId: "ghost", title: null, intention: null, type: null, toIndex: null, reason: "r" },
    ]);
    sanitizeSculpt(p, ["b1"]);
    expect(p.changes).toHaveLength(1);
  });
});
