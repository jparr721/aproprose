import { describe, expect, it } from "vitest";
import type { Block, Character } from "@/lib/types";
import { applyAssignments, buildStructureProposal } from "./structure-proposal";

const cast: Character[] = [{ id: "c-brian", name: "Brian", color: "#000", role: "" }];

describe("applyAssignments", () => {
  it("sets speaker ids on dialogue blocks by name, ignoring narration", () => {
    const seed: Block[] = [
      { id: "1", type: "narration", text: "x", raw: "", dirty: true },
      { id: "2", type: "dialogue", text: "Hi", raw: "", dirty: true },
    ];
    const out = applyAssignments(seed, [{ index: 1, speaker: "Brian" }], cast);
    expect(out[0].speaker).toBeUndefined();
    expect(out[1].speaker).toBe("c-brian");
  });
});

describe("buildStructureProposal", () => {
  it("inserts refined blocks after the target, then removes the target", () => {
    const refined: Block[] = [
      { id: "n", type: "narration", text: "Brian said.", raw: "", dirty: true },
      { id: "d", type: "dialogue", text: "Hi", raw: "", dirty: true, speaker: "c-brian" },
    ];
    const p = buildStructureProposal("ch1", "target", refined, cast);
    expect(p.changes.map((c) => c.kind)).toEqual(["insert", "insert", "remove"]);
    expect(p.changes[0]).toMatchObject({ afterId: "target", type: "narration", newText: "Brian said." });
    expect(p.changes[1]).toMatchObject({ afterId: "target", type: "dialogue", speaker: "Brian" });
    expect(p.changes[2]).toMatchObject({ kind: "remove", blockId: "target" });
  });
});
