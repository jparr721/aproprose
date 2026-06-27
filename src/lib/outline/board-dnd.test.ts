import { describe, it, expect } from "vitest";
import { defaultOutline, moveBeatTo } from "@/lib/outline/model";
import { resolveBeatDrop, COLUMN_IDS } from "@/lib/outline/board-dnd";
import type { ActKind } from "@/lib/types";

// COLUMN_IDS maps an ActKind to the droppable id its column registers, so a drop
// on an empty column resolves even when no card is under the pointer.
const colId = (k: ActKind) => COLUMN_IDS[k];

describe("resolveBeatDrop", () => {
  it("over a sibling beat -> that beat's act + that beat's index", () => {
    const o = defaultOutline();
    const active = o.acts[0].beats[0].id; // setup #0
    const over = o.acts[0].beats[2].id; // setup #2
    expect(resolveBeatDrop(o, active, over)).toEqual({ toActKind: "setup", toIndex: 2 });
  });

  it("over a beat in another act -> that act + that beat's index", () => {
    const o = defaultOutline();
    const active = o.acts[0].beats[0].id; // setup #0
    const over = o.acts[1].beats[1].id; // confrontation #1 (Midpoint)
    expect(resolveBeatDrop(o, active, over)).toEqual({ toActKind: "confrontation", toIndex: 1 });
  });

  it("over a column id (empty/gap drop) -> that act, appended at the end", () => {
    const o = defaultOutline();
    const active = o.acts[0].beats[0].id; // setup #0
    // resolution has 2 seeded beats -> append index is 2
    expect(resolveBeatDrop(o, active, colId("resolution"))).toEqual({
      toActKind: "resolution",
      toIndex: 2,
    });
  });

  it("over its own column id appends the active beat to its current act", () => {
    const o = defaultOutline();
    const active = o.acts[0].beats[0].id; // setup #0, 3 beats in setup
    expect(resolveBeatDrop(o, active, colId("setup"))).toEqual({
      toActKind: "setup",
      toIndex: 3,
    });
  });

  it("dropping on itself is a no-op (null)", () => {
    const o = defaultOutline();
    const active = o.acts[0].beats[0].id;
    expect(resolveBeatDrop(o, active, active)).toBeNull();
  });

  it("an unknown over id is ignored (null)", () => {
    const o = defaultOutline();
    expect(resolveBeatDrop(o, o.acts[0].beats[0].id, "nope")).toBeNull();
  });

  it("its result feeds moveBeatTo to perform a cross-act move", () => {
    const o = defaultOutline();
    const active = o.acts[0].beats[0].id; // "Opening Image"
    const over = o.acts[2].beats[0].id; // resolution #0 ("Climax")
    const r = resolveBeatDrop(o, active, over)!;
    const next = moveBeatTo(o, active, r.toActKind, r.toIndex);
    expect(next.acts[2].beats[0].id).toBe(active);
    expect(next.acts[0].beats.some((b) => b.id === active)).toBe(false);
  });
});
