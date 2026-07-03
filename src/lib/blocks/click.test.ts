import { describe, it, expect } from "vitest";
import { blockClickAction } from "@/lib/blocks/click";

describe("blockClickAction", () => {
  it("ignores non-left buttons (right-click must not select)", () => {
    expect(
      blockClickAction({ button: 2, modifier: false, shift: false, selected: true, multiActive: false, editing: false }),
    ).toBe("none");
  });

  it("Cmd/Ctrl + left click toggles the multi-selection", () => {
    expect(
      blockClickAction({ button: 0, modifier: true, shift: false, selected: false, multiActive: false, editing: false }),
    ).toBe("toggle");
  });

  it("Cmd/Ctrl-click toggles even on the active block (never edits)", () => {
    expect(
      blockClickAction({ button: 0, modifier: true, shift: false, selected: true, multiActive: false, editing: true }),
    ).toBe("toggle");
  });

  it("a plain click on an unselected block selects it", () => {
    expect(
      blockClickAction({ button: 0, modifier: false, shift: false, selected: false, multiActive: false, editing: false }),
    ).toBe("select");
  });

  it("a plain click while a multi-selection is active collapses to single (select, not edit)", () => {
    expect(
      blockClickAction({ button: 0, modifier: false, shift: false, selected: true, multiActive: true, editing: false }),
    ).toBe("select");
  });

  it("a second plain click on the selected block enters edit mode", () => {
    expect(
      blockClickAction({ button: 0, modifier: false, shift: false, selected: true, multiActive: false, editing: false }),
    ).toBe("edit");
  });

  it("a plain click on the block already in edit mode does nothing", () => {
    expect(
      blockClickAction({ button: 0, modifier: false, shift: false, selected: true, multiActive: false, editing: true }),
    ).toBe("none");
  });

  it("Shift + left click selects the range from the active block", () => {
    expect(
      blockClickAction({ button: 0, modifier: false, shift: true, selected: false, multiActive: false, editing: false }),
    ).toBe("range");
  });

  it("Shift-click ranges even from edit mode or a multi-selection", () => {
    expect(
      blockClickAction({ button: 0, modifier: false, shift: true, selected: true, multiActive: false, editing: true }),
    ).toBe("range");
    expect(
      blockClickAction({ button: 0, modifier: true, shift: true, selected: false, multiActive: true, editing: false }),
    ).toBe("range");
  });

  it("Shift + right click still does nothing", () => {
    expect(
      blockClickAction({ button: 2, modifier: false, shift: true, selected: false, multiActive: false, editing: false }),
    ).toBe("none");
  });
});
