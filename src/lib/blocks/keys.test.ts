import { describe, it, expect } from "vitest";
import { proseKeyAction } from "@/lib/blocks/keys";
import type { BlockType } from "@/lib/types";

const base = {
  key: "Enter",
  shift: false,
  mod: false,
  selectionStart: 5,
  selectionEnd: 5,
  valueLength: 20,
  blockType: "narration" as BlockType,
  blockEmpty: false,
  carriesFields: false,
  prevType: "narration" as BlockType | null,
};

describe("proseKeyAction - Enter", () => {
  it("splits at the caret mid-text", () => {
    expect(proseKeyAction(base)).toEqual({ kind: "split", at: 5 });
  });

  it("inserts a continuation block when the caret is at the end", () => {
    expect(proseKeyAction({ ...base, selectionStart: 20, selectionEnd: 20 })).toEqual({
      kind: "insert-after",
      type: "narration",
    });
  });

  it.each([
    ["dialogue", "dialogue"],
    ["chapter", "narration"],
    ["lore", "narration"],
    ["scratchpad", "narration"],
  ] as const)("%s at the end continues as %s", (blockType, next) => {
    expect(
      proseKeyAction({ ...base, blockType, selectionStart: 20, selectionEnd: 20 }),
    ).toEqual({ kind: "insert-after", type: next });
  });

  it("keeps the native newline for Shift+Enter", () => {
    expect(proseKeyAction({ ...base, shift: true })).toEqual({ kind: "none" });
  });

  it("defers chords to the keybinding registry", () => {
    expect(proseKeyAction({ ...base, mod: true })).toEqual({ kind: "none" });
  });

  it("does nothing with a non-collapsed selection", () => {
    expect(proseKeyAction({ ...base, selectionEnd: 9 })).toEqual({ kind: "none" });
  });

  it("does nothing at the very start of the text", () => {
    expect(proseKeyAction({ ...base, selectionStart: 0, selectionEnd: 0 })).toEqual({
      kind: "none",
    });
  });
});

describe("proseKeyAction - Backspace", () => {
  const backspace = { ...base, key: "Backspace", selectionStart: 0, selectionEnd: 0 };

  it("merges into the previous same-type block at offset 0", () => {
    expect(proseKeyAction(backspace)).toEqual({ kind: "merge" });
  });

  it("deletes an empty block instead of merging", () => {
    expect(proseKeyAction({ ...backspace, blockEmpty: true })).toEqual({ kind: "delete-empty" });
  });

  it("does nothing on the first block", () => {
    expect(proseKeyAction({ ...backspace, prevType: null })).toEqual({ kind: "none" });
  });

  it("never merges dialogue (speakers would fold together)", () => {
    expect(
      proseKeyAction({ ...backspace, blockType: "dialogue", prevType: "dialogue" }),
    ).toEqual({ kind: "none" });
  });

  it("never merges across types", () => {
    expect(proseKeyAction({ ...backspace, prevType: "dialogue" })).toEqual({ kind: "none" });
  });

  it("refuses when a beat/title would be dropped", () => {
    expect(proseKeyAction({ ...backspace, carriesFields: true })).toEqual({ kind: "none" });
    expect(
      proseKeyAction({ ...backspace, blockEmpty: true, carriesFields: true }),
    ).toEqual({ kind: "none" });
  });

  it("does nothing mid-text", () => {
    expect(proseKeyAction({ ...backspace, selectionStart: 3, selectionEnd: 3 })).toEqual({
      kind: "none",
    });
  });
});
