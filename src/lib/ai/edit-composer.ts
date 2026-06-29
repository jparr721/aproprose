// edit-composer.ts — the Edit tab composer's placeholder + enabled state, kept
// pure so the "nothing to edit" messaging can be unit-tested without rendering
// the panel (mirrors lib/blocks/click.ts). The composer is inert whenever the
// chosen scope resolves to zero editable blocks; the placeholder names the action
// that fixes it (select a block) rather than the old "place your cursor" framing.

export interface EditComposerState {
  /** Placeholder shown in the composer textarea. */
  placeholder: string;
  /** Inert because nothing in scope can be edited — disables the textarea. */
  disabled: boolean;
}

const DESCRIBE = "Describe the edit, e.g. fix typos, tighten, make her colder";

export function editComposerState(opts: {
  scope: "block" | "chapter";
  /** Editable blocks the current scope resolves to (after the isEditable filter). */
  targetCount: number;
  /** Whether any block is selected at all, before that filter. */
  hasBlockSelection: boolean;
}): EditComposerState {
  if (opts.targetCount > 0) return { placeholder: DESCRIBE, disabled: false };
  if (opts.scope === "chapter")
    return { placeholder: "No editable prose in this chapter yet", disabled: true };
  return {
    placeholder: opts.hasBlockSelection
      ? "Select an editable block (prose or a heading)"
      : "Select a block to edit",
    disabled: true,
  };
}
