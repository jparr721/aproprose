import { describe, it, expect } from "vitest";
import { KEYBINDINGS, toHotkeyString, keybindingParts } from "@/lib/keybindings";

describe("keybindings registry", () => {
  it("binds split-block to mod+shift+enter", () => {
    expect(toHotkeyString(KEYBINDINGS.SPLIT_BLOCK)).toBe("mod+shift+enter");
  });
  it("keeps save on mod+s and labels it Save & build", () => {
    expect(toHotkeyString(KEYBINDINGS.SAVE_CHAPTER)).toBe("mod+s");
    expect(KEYBINDINGS.SAVE_CHAPTER.label).toBe("Save & build");
  });
  it("renders platform glyphs for split-block", () => {
    expect(keybindingParts(KEYBINDINGS.SPLIT_BLOCK, true)).toEqual(["⌘", "⇧", "↵"]);
    expect(keybindingParts(KEYBINDINGS.SPLIT_BLOCK, false)).toEqual(["⌃", "⇧", "↵"]);
  });
});

describe("block nav/edit keybindings", () => {
  it("binds the unmodified nav and edit keys", () => {
    expect(toHotkeyString(KEYBINDINGS.NAV_PREV_BLOCK)).toBe("up");
    expect(toHotkeyString(KEYBINDINGS.NAV_NEXT_BLOCK)).toBe("down");
    expect(toHotkeyString(KEYBINDINGS.EDIT_BLOCK)).toBe("i");
    expect(toHotkeyString(KEYBINDINGS.EXIT_BLOCK)).toBe("escape");
  });

  it("only the exit binding fires while a textarea/input is focused", () => {
    expect(KEYBINDINGS.EXIT_BLOCK.firesWhileEditing).toBe(true);
    expect(KEYBINDINGS.NAV_PREV_BLOCK.firesWhileEditing).toBeUndefined();
    expect(KEYBINDINGS.NAV_NEXT_BLOCK.firesWhileEditing).toBeUndefined();
    expect(KEYBINDINGS.EDIT_BLOCK.firesWhileEditing).toBeUndefined();
  });

  it("renders arrow / escape glyphs for the nav keys", () => {
    expect(keybindingParts(KEYBINDINGS.NAV_PREV_BLOCK, true)).toEqual(["↑"]);
    expect(keybindingParts(KEYBINDINGS.NAV_NEXT_BLOCK, true)).toEqual(["↓"]);
    expect(keybindingParts(KEYBINDINGS.EXIT_BLOCK, true)).toEqual(["⎋"]);
  });
});
