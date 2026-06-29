// dom.ts — element predicates used to scope keyboard shortcuts.
//
// Ported from warlock/apps/reaper. `isKeyboardCaptured` is the universal opt-out:
// any subtree marked `[data-capture-keyboard]` (e.g. a future code editor that
// owns its own keymap) suppresses every app shortcut. `isInAuxSurface` is the
// narrower guard editor history uses so undo/redo keep native behavior inside the
// right panel and dialogs.

export function isKeyboardCaptured(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return element.closest("[data-capture-keyboard]") !== null;
}

const AUX_SURFACE_SELECTOR =
  '[data-right-panel],[data-find-widget],[role="dialog"],[role="alertdialog"]';

export function isInAuxSurface(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return element.closest(AUX_SURFACE_SELECTOR) !== null;
}

/**
 * True when the event/focus target is an editable field (`<input>`, `<textarea>`,
 * or contenteditable). Used by global single-letter chords that must yield to
 * in-field editing - e.g. the sidebar's Cmd+B must not fire while the writer is
 * bolding text in a block.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}
