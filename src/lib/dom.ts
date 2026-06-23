// dom.ts — element predicates used to scope keyboard shortcuts.
//
// Ported from warlock/apps/reaper. `isKeyboardCaptured` is the universal opt-out:
// any subtree marked `[data-capture-keyboard]` (e.g. a future code editor that
// owns its own keymap) suppresses every app shortcut. `isInAuxSurface` is the
// narrower guard editor history uses so undo/redo keep native behavior inside the
// AI panel and dialogs.

export function isKeyboardCaptured(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return element.closest("[data-capture-keyboard]") !== null;
}

const AUX_SURFACE_SELECTOR = '[data-ai-root],[role="dialog"],[role="alertdialog"]';

export function isInAuxSurface(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return element.closest(AUX_SURFACE_SELECTOR) !== null;
}
