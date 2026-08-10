// outline-board-store.ts -- ephemeral board navigation state.

import { create } from "zustand";

interface OutlineBoardState {
  openChapterId: string | null;
  chapterView: "manual" | "planner";
  highlightedCardId: string | null;
  openChapter: (id: string) => void;
  openPlanner: (id: string) => void;
  showManual: () => void;
  closeChapter: () => void;
  highlightCard: (id: string | null) => void;
}

export const useOutlineBoardStore = create<OutlineBoardState>()((set) => ({
  openChapterId: null,
  chapterView: "manual",
  highlightedCardId: null,
  openChapter: (openChapterId) => set({ openChapterId, chapterView: "manual" }),
  openPlanner: (openChapterId) => set({ openChapterId, chapterView: "planner" }),
  showManual: () => set({ chapterView: "manual" }),
  closeChapter: () => set({ openChapterId: null, chapterView: "manual" }),
  highlightCard: (highlightedCardId) => set({ highlightedCardId }),
}));
