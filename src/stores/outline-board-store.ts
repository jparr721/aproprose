// outline-board-store.ts -- ephemeral board UI state.
//
// Holds which chapter subview is open. This state resets when the board
// unmounts; the durable outline lives in project-store/meta.json.

import { create } from "zustand";

export type OutlineChapterView = "edit" | "guide";

interface OutlineBoardState {
  /** The chapter whose subview is open, or null for the board overview. */
  openChapterId: string | null;
  chapterView: OutlineChapterView;
  openChapter: (id: string) => void;
  openChapterGuide: (id: string) => void;
  setChapterView: (view: OutlineChapterView) => void;
  closeChapter: () => void;
}

export const useOutlineBoardStore = create<OutlineBoardState>()((set) => ({
  openChapterId: null,
  chapterView: "edit",
  openChapter: (openChapterId) => set({ openChapterId, chapterView: "edit" }),
  openChapterGuide: (openChapterId) => set({ openChapterId, chapterView: "guide" }),
  setChapterView: (chapterView) => set({ chapterView }),
  closeChapter: () => set({ openChapterId: null }),
}));
