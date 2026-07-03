// outline-board-store.ts -- ephemeral board UI state.
//
// Holds which chapter subview is open and the in-flight AI sculpt proposal +
// per-change review decisions. None of this persists: a sculpt proposal is a
// transient, reviewable gate, and the open-chapter resets when the board
// unmounts. The durable outline lives in project-store/meta.json.

import { create } from "zustand";
import type { SculptProposal } from "@/lib/types";

interface OutlineBoardState {
  /** The chapter whose subview is open, or null for the board overview. */
  openChapterId: string | null;
  proposal: SculptProposal | null;
  decisions: Record<number, "keep" | "skip">;
  sculptingChapterId: string | null;
  sculptError: string | null;
  openChapter: (id: string) => void;
  closeChapter: () => void;
  startSculpt: (chapterId: string) => void;
  setProposal: (p: SculptProposal | null) => void;
  setSculptError: (e: string | null) => void;
  setDecision: (index: number, d: "keep" | "skip") => void;
  rejectAll: () => void;
  clearProposal: () => void;
}

export const useOutlineBoardStore = create<OutlineBoardState>()((set) => ({
  openChapterId: null,
  proposal: null,
  decisions: {},
  sculptingChapterId: null,
  sculptError: null,
  openChapter: (openChapterId) => set({ openChapterId }),
  closeChapter: () => set({ openChapterId: null }),
  startSculpt: (chapterId) =>
    set({ sculptingChapterId: chapterId, proposal: null, sculptError: null, decisions: {} }),
  setProposal: (p) => set({ proposal: p, decisions: {} }),
  setSculptError: (e) => set({ sculptError: e }),
  setDecision: (index, d) => set((s) => ({ decisions: { ...s.decisions, [index]: d } })),
  rejectAll: () => set({ proposal: null, decisions: {}, sculptingChapterId: null }),
  // Accepting a proposal ends the sculpt lifecycle like rejecting does: clear
  // the chapter marker too, so the column's in-flight derivation (marker set,
  // no proposal, no error) reads idle again instead of spinning forever.
  clearProposal: () => set({ proposal: null, decisions: {}, sculptingChapterId: null }),
}));
