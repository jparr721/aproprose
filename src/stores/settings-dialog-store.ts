// settings-dialog-store.ts -- open state + active tab for the settings dialog.
//
// One store, one concern (per CLAUDE.md). Ephemeral: the dialog is not persisted,
// so it always reopens closed. Lifted into a store so the sidebar button, the
// Cmd/Ctrl+, keybinding, the command palette, and the AI panel can all open it
// (and deep-link to a tab via openWithTab).

import { create } from "zustand";

export const SETTINGS_TABS = {
  APPEARANCE: "appearance",
  AI: "ai",
  BACKUP: "backup",
  KEYBOARD: "keyboard",
  STATS: "stats",
} as const;

export type SettingsTab = (typeof SETTINGS_TABS)[keyof typeof SETTINGS_TABS];

export function isSettingsTab(value: string): value is SettingsTab {
  return (Object.values(SETTINGS_TABS) as string[]).includes(value);
}

interface SettingsDialogState {
  open: boolean;
  tab: SettingsTab;
  setOpen: (open: boolean) => void;
  setTab: (tab: SettingsTab) => void;
  openWithTab: (tab: SettingsTab) => void;
}

export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  open: false,
  tab: SETTINGS_TABS.APPEARANCE,
  setOpen: (open) => set({ open }),
  setTab: (tab) => set({ tab }),
  openWithTab: (tab) => set({ open: true, tab }),
}));
