// clipboard.ts — copy helpers that survive the Tauri WebKitGTK webview.
//
// `navigator.clipboard.writeText` is the happy path, but on Linux/WebKitGTK it
// can be missing or reject even inside a gesture, so we fall back to a hidden
// `<textarea>` + `execCommand("copy")`. Both run from a menu-item click — a real
// user gesture — which is what keeps the fallback reliable.

/** Copy `text` to the clipboard. Resolves to whether the copy succeeded. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the execCommand path
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const prev = document.activeElement as HTMLElement | null;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  // Off-screen so the transient element never flashes or scrolls into view.
  ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
  document.body.appendChild(ta);
  // WebKitGTK only copies the *focused* element's selection, so focus before
  // selecting — `.select()` alone isn't enough on the very platform this targets.
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  prev?.focus?.({ preventScroll: true });
  return ok;
}

/**
 * The text the user currently has selected — from a focused input/textarea if
 * one owns the caret (WebKitGTK doesn't surface those via `getSelection`), else
 * the document selection. Empty string when nothing is selected.
 */
export function currentSelectionText(): string {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const { selectionStart, selectionEnd, value } = el;
    if (selectionStart != null && selectionEnd != null && selectionEnd > selectionStart) {
      return value.slice(selectionStart, selectionEnd);
    }
  }
  return window.getSelection()?.toString() ?? "";
}
