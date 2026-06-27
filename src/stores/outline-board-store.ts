// outline-board-store.ts -- ephemeral state for the storyboard view.
//
// Nothing here is persisted: the selected beat (and, from Task 5.5, the
// in-flight AI sculpt proposal) are session-only working state. Per CLAUDE.md
// this is a store, not context, because the board, the detail rail, and the
// sculpt overlay all read+write it. The durable outline lives in
// project-store/meta.json; this store only tracks what the author is currently
// looking at.

import { create } from "zustand";

interface OutlineBoardState {
  selectedBeatId: string | null;
  selectBeat: (id: string | null) => void;
}

export const useOutlineBoardStore = create<OutlineBoardState>()((set) => ({
  selectedBeatId: null,
  selectBeat: (selectedBeatId) => set({ selectedBeatId }),
}));
