// lore-sheet-store.ts — the lore detail sheet's open/close state.
//
// One store, one concern. A single loreId at a time; opening a different entry
// replaces the open one.

import { create } from "zustand";

interface LoreSheetState {
  loreId: string | null;
  open: (id: string) => void;
  close: () => void;
}

export const useLoreSheetStore = create<LoreSheetState>((set) => ({
  loreId: null,
  open: (id) => set({ loreId: id }),
  close: () => set({ loreId: null }),
}));