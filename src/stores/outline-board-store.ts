// outline-board-store.ts -- ephemeral board navigation state.

import { create } from "zustand";

interface OutlineBoardState {
  openChapterId: string | null;
  highlightedCardId: string | null;
  openChapter: (id: string) => void;
  closeChapter: () => void;
  highlightCard: (id: string | null) => void;
}

export const useOutlineBoardStore = create<OutlineBoardState>()((set) => ({
  openChapterId: null,
  highlightedCardId: null,
  openChapter: (openChapterId) => set({ openChapterId }),
  closeChapter: () => set({ openChapterId: null }),
  highlightCard: (highlightedCardId) => set({ highlightedCardId }),
}));
