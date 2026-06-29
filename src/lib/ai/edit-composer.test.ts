import { describe, it, expect } from "vitest";
import { editComposerState } from "@/lib/ai/edit-composer";

describe("editComposerState", () => {
  it("is enabled with a prompt when the scope resolves to targets", () => {
    expect(editComposerState({ scope: "block", targetCount: 1, hasBlockSelection: true })).toEqual({
      placeholder: "Describe the edit, e.g. fix typos, tighten, make her colder",
      disabled: false,
    });
    expect(editComposerState({ scope: "chapter", targetCount: 4, hasBlockSelection: false })).toEqual({
      placeholder: "Describe the edit, e.g. fix typos, tighten, make her colder",
      disabled: false,
    });
  });

  // The reported bug: block scope, nothing selected. It must disable the input and
  // tell the user to select a block — not the old "Place your cursor" copy.
  it("disables and asks to select a block when nothing is selected", () => {
    expect(editComposerState({ scope: "block", targetCount: 0, hasBlockSelection: false })).toEqual({
      placeholder: "Select a block to edit",
      disabled: true,
    });
  });

  // Broader case: a block IS selected, but it's a non-editable type (lore /
  // scratchpad / latex / scene break), so the scope still resolves to 0 targets.
  it("disables and points at editable types when the selection can't be edited", () => {
    expect(editComposerState({ scope: "block", targetCount: 0, hasBlockSelection: true })).toEqual({
      placeholder: "Select an editable block (prose or a heading)",
      disabled: true,
    });
  });

  it("disables under chapter scope when the chapter has no editable prose", () => {
    expect(editComposerState({ scope: "chapter", targetCount: 0, hasBlockSelection: false })).toEqual({
      placeholder: "No editable prose in this chapter yet",
      disabled: true,
    });
  });
});
