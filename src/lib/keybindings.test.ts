import { describe, it, expect } from "vitest";
import { matchesCombo, bindingFor, comboTokens, formatCombo, primaryTokens, primaryLabel, KEYBINDINGS } from "@/lib/keybindings";
import type { KeybindingId } from "@/lib/keybindings";

const ev = (p: Partial<KeyboardEvent>): KeyboardEvent =>
  ({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: "", ...p }) as KeyboardEvent;

describe("matchesCombo", () => {
  it("treats Cmd and Ctrl as the same modifier", () => {
    expect(matchesCombo(ev({ metaKey: true, key: "s" }), { mod: true, key: "s" })).toBe(true);
    expect(matchesCombo(ev({ ctrlKey: true, key: "s" }), { mod: true, key: "s" })).toBe(true);
  });
  it("requires the exact shift state", () => {
    expect(matchesCombo(ev({ metaKey: true, shiftKey: true, key: "z" }), { mod: true, key: "z" })).toBe(false);
    expect(matchesCombo(ev({ metaKey: true, shiftKey: true, key: "z" }), { mod: true, shift: true, key: "z" })).toBe(true);
  });
});

describe("bindingFor", () => {
  it("resolves each shortcut, and null for unbound keys", () => {
    expect(bindingFor(ev({ metaKey: true, key: "s" }))?.id).toBe("save-build");
    expect(bindingFor(ev({ metaKey: true, key: "Enter" }))?.id).toBe("split");
    expect(bindingFor(ev({ metaKey: true, key: "z" }))?.id).toBe("undo");
    expect(bindingFor(ev({ metaKey: true, shiftKey: true, key: "z" }))?.id).toBe("redo");
    expect(bindingFor(ev({ ctrlKey: true, key: "y" }))?.id).toBe("redo");
    expect(bindingFor(ev({ key: "a" }))).toBeNull();
  });
});

describe("comboTokens / formatCombo", () => {
  it("renders platform-specific chords", () => {
    expect(comboTokens({ mod: true, shift: true, key: "z" }, true)).toEqual(["⌘", "⇧", "Z"]);
    expect(comboTokens({ mod: true, shift: true, key: "z" }, false)).toEqual(["Ctrl", "Shift", "Z"]);
    expect(comboTokens({ mod: true, key: "Enter" }, true)).toEqual(["⌘", "↵"]);
    expect(formatCombo({ mod: true, key: "s" }, true)).toBe("⌘S");
    expect(formatCombo({ mod: true, key: "s" }, false)).toBe("Ctrl+S");
  });
});

describe("primaryTokens / primaryLabel", () => {
  it("returns the primary combo, platform-aware", () => {
    expect(primaryTokens("save-build", true)).toEqual(["⌘", "S"]);
    expect(primaryLabel("save-build", true)).toBe("⌘S");
    expect(primaryLabel("save-build", false)).toBe("Ctrl+S");
    expect(primaryTokens("redo", false)).toEqual(["Ctrl", "Shift", "Z"]);
  });
  it("returns empty for an unknown id", () => {
    expect(primaryTokens("nope" as KeybindingId, true)).toEqual([]);
    expect(primaryLabel("nope" as KeybindingId, true)).toBe("");
  });
});

describe("KEYBINDINGS registry", () => {
  it("has exactly the expected ids, no duplicates", () => {
    const ids = KEYBINDINGS.map((b) => b.id);
    expect(ids.length).toBe(4);
    expect(new Set(ids)).toEqual(new Set(["save-build", "split", "undo", "redo"]));
  });
});
