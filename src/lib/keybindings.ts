// keybindings.ts — single source of truth for app keyboard shortcuts.
//
// The global keydown dispatcher (App.tsx) and the read-only Settings list both
// read KEYBINDINGS, so documented shortcuts can't drift from the handlers.
// Pure module: platform detection (IS_MAC from @/lib/platform) is passed in by
// callers, so this stays unit-testable in node. `mod` = Cmd on macOS / Ctrl else.

export interface Combo {
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** KeyboardEvent.key, compared case-insensitively (e.g. "s", "Enter"). */
  key: string;
}

export type KeybindingId = "save-build" | "split" | "undo" | "redo";

export interface Keybinding {
  id: KeybindingId;
  label: string;
  description: string;
  /** Matches if ANY listed combo matches the event. */
  combos: Combo[];
  scope: "global" | "editor";
}

export const KEYBINDINGS: Keybinding[] = [
  {
    id: "save-build",
    label: "Save & build PDF",
    description: "Write the chapter to disk and recompile the PDF.",
    combos: [{ mod: true, key: "s" }],
    scope: "global",
  },
  {
    id: "split",
    label: "Split block at cursor",
    description: "Break the current block into two at the caret.",
    combos: [{ mod: true, key: "Enter" }],
    scope: "editor",
  },
  {
    id: "undo",
    label: "Undo",
    description: "Undo the last editor change.",
    combos: [{ mod: true, key: "z" }],
    scope: "editor",
  },
  {
    id: "redo",
    label: "Redo",
    description: "Redo the last undone change.",
    combos: [
      { mod: true, shift: true, key: "z" },
      { mod: true, key: "y" },
    ],
    scope: "editor",
  },
];

export function matchesCombo(e: KeyboardEvent, combo: Combo): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (!!combo.mod !== mod) return false;
  if (!!combo.shift !== e.shiftKey) return false;
  if (!!combo.alt !== e.altKey) return false;
  return e.key.toLowerCase() === combo.key.toLowerCase();
}

export function bindingFor(e: KeyboardEvent): Keybinding | null {
  for (const binding of KEYBINDINGS) {
    if (binding.combos.some((c) => matchesCombo(e, c))) return binding;
  }
  return null;
}

function keyLabel(key: string, mac: boolean): string {
  switch (key.toLowerCase()) {
    case "enter":
      return mac ? "↵" : "Enter";
    case "escape":
      return "Esc";
    case " ":
      return "Space";
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

/** Tokens for a chord, one per <Kbd> chip (e.g. ["⌘","⇧","Z"]). */
export function comboTokens(combo: Combo, mac: boolean): string[] {
  const tokens: string[] = [];
  if (combo.mod) tokens.push(mac ? "⌘" : "Ctrl");
  if (combo.shift) tokens.push(mac ? "⇧" : "Shift");
  if (combo.alt) tokens.push(mac ? "⌥" : "Alt");
  tokens.push(keyLabel(combo.key, mac));
  return tokens;
}

/** Flat string form for title/aria-label use. */
export function formatCombo(combo: Combo, mac: boolean): string {
  const tokens = comboTokens(combo, mac);
  return mac ? tokens.join("") : tokens.join("+");
}

/** Tokens for a binding's primary combo — for inline hints. */
export function primaryTokens(id: KeybindingId, mac: boolean): string[] {
  const binding = KEYBINDINGS.find((b) => b.id === id);
  if (!binding) return [];
  return comboTokens(binding.combos[0], mac);
}
