import { describe, expect, it } from "vitest";
import { KEYBINDINGS, KEYBINDING_IDS, toHotkeyString } from "@/lib/keybindings";

describe("TOGGLE_OUTLINE keybinding", () => {
  it("is registered with id, key, modifiers, category", () => {
    const k = KEYBINDINGS.TOGGLE_OUTLINE;
    expect(k.id).toBe("toggle-outline");
    expect(k.key).toBe("o");
    expect(k.modifiers).toStrictEqual({ ctrl: true, shift: true });
    expect(k.category).toBe("view");
    expect(k.label).toBe("Toggle Outline");
  });

  it("auto-generates KEYBINDING_IDS.TOGGLE_OUTLINE", () => {
    expect(KEYBINDING_IDS.TOGGLE_OUTLINE).toBe("TOGGLE_OUTLINE");
  });

  it("lowers to the mod+shift+o combo", () => {
    expect(toHotkeyString(KEYBINDINGS.TOGGLE_OUTLINE)).toBe("mod+shift+o");
  });
});
