// command-palette-store.ts - open state, current sub-page, and the MRU list.
//
// Open-state is written from the Cmd/Ctrl+K keybinding (and could be from a button),
// so it's a store rather than local state. The most-recently-used ids are persisted
// the same way settings are (app config dir via the Tauri-backed storage adapter).

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { tauriStateStorage } from "@/lib/storage";
import type { PageId } from "@/commands/types";

/** How many recent commands to keep. */
const MRU_CAP = 5;

type Page = "root" | PageId;

interface CommandPaletteState {
  open: boolean;
  page: Page;
  /** Ids of recently-run static commands, most-recent first. Persisted. */
  recentIds: string[];

  /** Open the palette at the root page. */
  openPalette: () => void;
  closePalette: () => void;
  /** Cmd/Ctrl+K: open at root when closed, close when open. */
  togglePalette: () => void;
  pushPage: (page: PageId) => void;
  popToRoot: () => void;
  /** Move `id` to the front of the recents (deduped, capped). */
  recordRun: (id: string) => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>()(
  persist(
    (set) => ({
      open: false,
      page: "root",
      recentIds: [],

      openPalette: () => set({ open: true, page: "root" }),
      closePalette: () => set({ open: false }),
      togglePalette: () =>
        set((s) => (s.open ? { open: false } : { open: true, page: "root" })),
      pushPage: (page) => set({ page }),
      popToRoot: () => set({ page: "root" }),
      recordRun: (id) =>
        set((s) => ({
          recentIds: [id, ...s.recentIds.filter((x) => x !== id)].slice(0, MRU_CAP),
        })),
    }),
    {
      name: "command-palette",
      storage: createJSONStorage(() => tauriStateStorage),
      partialize: ({ recentIds }) => ({ recentIds }),
    },
  ),
);
