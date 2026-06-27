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
  /**
   * Opt this binding into firing while a `textarea`/`input` is focused (the
   * default leaves non-chord keys inert in form fields). Used by `Esc` so it can
   * exit a block's edit mode from inside the textarea; scoped to form tags only,
   * so Radix menus / dialogs still own their own `Esc`.
   */
  firesWhileEditing?: boolean;
}

export const KEYBINDINGS = {
  OPEN_COMMAND_PALETTE: {
    id: "open-command-palette",
    key: "k",
    modifiers: { ctrl: true },
    description: "Open the command palette",
    category: "view",
    label: "Command palette",
  },
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
  TOGGLE_OUTLINE: {
    id: "toggle-outline",
    key: "o",
    modifiers: { ctrl: true, shift: true },
    description: "Toggle the full-page Outline storyboard",
    category: "view",
    label: "Toggle Outline",
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
    description: "Toggle the settings dialog",
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
  FORMAT_BOLD: {
    id: "format-bold",
    key: "b",
    modifiers: { ctrl: true },
    description: "Bold the selected text",
    category: "editor",
    label: "Bold",
  },
  FORMAT_ITALIC: {
    id: "format-italic",
    key: "i",
    modifiers: { ctrl: true },
    description: "Italicize the selected text",
    category: "editor",
    label: "Italic",
  },
  // Block nav/edit modal keys. Unmodified so they're inert while a textarea is
  // focused (the editing surface), and so they read like vim motions in nav mode.
  NAV_PREV_BLOCK: {
    id: "nav-prev-block",
    key: "up",
    modifiers: {},
    description: "Select the previous block",
    category: "editor",
    label: "Previous block",
  },
  NAV_NEXT_BLOCK: {
    id: "nav-next-block",
    key: "down",
    modifiers: {},
    description: "Select the next block",
    category: "editor",
    label: "Next block",
  },
  EDIT_BLOCK: {
    id: "edit-block",
    key: "i",
    modifiers: {},
    description: "Edit the selected block",
    category: "editor",
    label: "Edit block",
  },
  EXIT_BLOCK: {
    id: "exit-block",
    key: "escape",
    modifiers: {},
    description: "Exit edit mode, or deselect the block",
    category: "editor",
    label: "Exit block",
    firesWhileEditing: true,
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
const KEY_SYMBOLS: Record<string, string> = {
  enter: "↵",
  up: "↑",
  down: "↓",
  escape: "⎋",
};

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
