// use-keybinding.ts — bind a registry shortcut from the component that owns it.
//
// Ported from warlock/apps/reaper: a thin wrapper over react-hotkeys-hook that
// reads a definition out of the keybinding registry and applies the app's focus
// policy. Components call this co-located with their action instead of wiring a
// shared `window` keydown listener.

import { useHotkeys } from "react-hotkeys-hook";
import { isKeyboardCaptured } from "@/lib/dom";
import {
  KEYBINDINGS,
  type KeybindingDefinition,
  type KeybindingId,
  toHotkeyString,
} from "@/lib/keybindings";

export interface UseKeybindingOptions {
  enabled: boolean;
  ignoreEventWhen: (event: KeyboardEvent) => boolean;
}

const DEFAULT_OPTIONS: UseKeybindingOptions = {
  enabled: true,
  ignoreEventWhen: () => false,
};

export function useKeybinding(id: KeybindingId, callback: () => void): void {
  useKeybindingWithOptions(id, callback, DEFAULT_OPTIONS);
}

export function useKeybindingWithOptions(
  id: KeybindingId,
  callback: () => void,
  options: UseKeybindingOptions,
): void {
  const definition: KeybindingDefinition = KEYBINDINGS[id];
  const hotkey = toHotkeyString(definition);
  // Chord shortcuts (carry a mod/alt) fire even while a form input is focused, so
  // Cmd+S / Cmd+Shift+P work from the editor's block textareas. Per-binding
  // `ignoreEventWhen` still narrows that — editor undo/redo bows out inside the AI
  // panel and dialogs so their inputs keep native history.
  const isChord = Boolean(definition.modifiers.ctrl || definition.modifiers.alt);

  useHotkeys(
    hotkey,
    () => callback(),
    {
      preventDefault: true,
      enabled: options.enabled,
      enableOnFormTags: isChord,
      enableOnContentEditable: isChord,
      ignoreEventWhen: (event) => {
        if (isKeyboardCaptured(event.target as Element | null)) return true;
        return options.ignoreEventWhen(event);
      },
    },
    [callback, options.enabled],
  );
}
