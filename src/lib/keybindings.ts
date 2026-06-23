// keybindings.ts — the single registry of app keyboard shortcuts.
//
// Ported from warlock/apps/reaper's keybinding module: one typed definition per
// shortcut, translated to a `react-hotkeys-hook` combo string at bind time and to
// a human label for on-screen hints. Components bind a definition with the
// `useKeybinding` hook rather than hand-rolling `window` keydown listeners, so the
// shortcut surface stays declarative and discoverable from one place.
//
// `modifiers.ctrl` means the platform command key — Cmd on macOS, Ctrl elsewhere
// — because it lowers to react-hotkeys-hook's "mod" token.

export interface KeybindingDefinition {
  /** Stable kebab id, handy as a React key / persistence handle. */
  id: string;
  /** react-hotkeys-hook key token (e.g. "s", "enter", "z"). */
  key: string;
  /** "ctrl" lowers to the "mod" key (Cmd on macOS, Ctrl elsewhere). */
  modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean };
  description: string;
  category: "document" | "view" | "editor";
  label: string;
}

export const KEYBINDINGS = {
  SAVE_CHAPTER: {
    id: "save-chapter",
    key: "s",
    modifiers: { ctrl: true },
    description: "Save the active chapter and rebuild the PDF",
    category: "document",
    label: "Save & build",
  },
  COMPILE: {
    id: "compile",
    key: "enter",
    modifiers: { ctrl: true },
    description: "Compile the manuscript",
    category: "document",
    label: "Compile",
  },
  TOGGLE_PDF: {
    id: "toggle-pdf",
    key: "p",
    modifiers: { ctrl: true, shift: true },
    description: "Toggle the PDF preview pane",
    category: "view",
    label: "Toggle PDF",
  },
  TOGGLE_AI: {
    id: "toggle-ai",
    key: "a",
    modifiers: { ctrl: true, shift: true },
    description: "Toggle the AI panel",
    category: "view",
    label: "Toggle AI",
  },
  TOGGLE_SETTINGS: {
    id: "toggle-settings",
    key: ",",
    modifiers: { ctrl: true },
    description: "Toggle the settings sheet",
    category: "view",
    label: "Toggle settings",
  },
  UNDO: {
    id: "undo",
    key: "z",
    modifiers: { ctrl: true },
    description: "Undo the last editor change",
    category: "editor",
    label: "Undo",
  },
  REDO: {
    id: "redo",
    key: "z",
    modifiers: { ctrl: true, shift: true },
    description: "Redo the last undone editor change",
    category: "editor",
    label: "Redo",
  },
  REDO_ALT: {
    id: "redo-alt",
    key: "y",
    modifiers: { ctrl: true },
    description: "Redo the last undone editor change",
    category: "editor",
    label: "Redo",
  },
  SPLIT_BLOCK: {
    id: "split-block",
    key: "enter",
    modifiers: { ctrl: true, shift: true },
    description: "Split the block at the cursor, or isolate the selection",
    category: "editor",
    label: "Split block",
  },
} satisfies Record<string, KeybindingDefinition>;

export type KeybindingId = keyof typeof KEYBINDINGS;

/** `{ SAVE_CHAPTER: "SAVE_CHAPTER", … }` — lets call sites pass ids type-safely. */
export const KEYBINDING_IDS = Object.fromEntries(
  Object.keys(KEYBINDINGS).map((k) => [k, k]),
) as { [K in KeybindingId]: K };

// Punctuation keys whose literal differs from react-hotkeys-hook's token. The
// comma doubles as react-hotkeys-hook's hotkey delimiter, so it must lower to the
// "comma" token (not a bare ",") or the settings combo never binds.
const KEY_ALIASES: Record<string, string> = { ",": "comma" };

/** Lower a definition to a react-hotkeys-hook combo string (e.g. "mod+shift+p"). */
export function toHotkeyString(keybinding: Pick<KeybindingDefinition, "key" | "modifiers">): string {
  if (!keybinding.key) {
    throw new Error("toHotkeyString: key must be a non-empty string");
  }
  const parts: string[] = [];
  if (keybinding.modifiers.ctrl) parts.push("mod");
  if (keybinding.modifiers.shift) parts.push("shift");
  if (keybinding.modifiers.alt) parts.push("alt");
  parts.push(KEY_ALIASES[keybinding.key] ?? keybinding.key);
  return parts.join("+");
}

// Compact glyphs for on-screen hints. Only the command modifier differs by
// platform — ⌘ on macOS, ⌃ (control) elsewhere; shift / alt and the key glyphs
// are shared.
const KEY_SYMBOLS: Record<string, string> = { enter: "↵" };

function formatKey(key: string): string {
  if (KEY_SYMBOLS[key]) return KEY_SYMBOLS[key];
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * The display glyphs of a shortcut, in press order — e.g. `["⌘", "⇧", "P"]` on
 * macOS, `["⌃", "⇧", "P"]` elsewhere. Render each in its own `<Kbd>` (see
 * `KeybindingHint`). Pass `IS_MAC` from `@/lib/platform`.
 */
export function keybindingParts(
  keybinding: Pick<KeybindingDefinition, "key" | "modifiers">,
  isMac: boolean,
): string[] {
  const parts: string[] = [];
  if (keybinding.modifiers.ctrl) parts.push(isMac ? "⌘" : "⌃");
  if (keybinding.modifiers.shift) parts.push("⇧");
  if (keybinding.modifiers.alt) parts.push("⌥");
  parts.push(formatKey(keybinding.key));
  return parts;
}
