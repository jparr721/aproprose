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
