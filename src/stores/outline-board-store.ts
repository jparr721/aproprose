// outline-board-store.ts -- ephemeral board UI state.
//
// Holds the selected beat and the in-flight AI sculpt proposal + per-change
// review decisions. None of this persists: a sculpt proposal is a transient,
// reviewable gate, and the selection resets when the board unmounts.
// The durable outline lives in project-store/meta.json; this store only
// tracks what the author is currently looking at.

import { create } from "zustand";
import type { ActKind, SculptProposal } from "@/lib/types";

interface OutlineBoardState {
  selectedBeatId: string | null;
  proposal: SculptProposal | null;
  decisions: Record<number, "keep" | "skip">;
  sculptingAct: ActKind | null;
  sculptError: string | null;
  selectBeat: (id: string | null) => void;
  startSculpt: (act: ActKind) => void;
  setProposal: (p: SculptProposal | null) => void;
  setSculptError: (e: string | null) => void;
  setDecision: (index: number, d: "keep" | "skip") => void;
  rejectAll: () => void;
  clearProposal: () => void;
}

export const useOutlineBoardStore = create<OutlineBoardState>()((set) => ({
  selectedBeatId: null,
  proposal: null,
  decisions: {},
  sculptingAct: null,
  sculptError: null,
  selectBeat: (selectedBeatId) => set({ selectedBeatId }),
  startSculpt: (act) => set({ sculptingAct: act, proposal: null, sculptError: null, decisions: {} }),
  // A fresh proposal resets review decisions so prior keep/skip choices never
  // bleed across runs (default-treated-as-keep happens at apply time).
  setProposal: (p) => set({ proposal: p, decisions: {} }),
  setSculptError: (e) => set({ sculptError: e }),
  setDecision: (index, d) =>
    set((s) => ({ decisions: { ...s.decisions, [index]: d } })),
  rejectAll: () => set({ proposal: null, decisions: {}, sculptingAct: null }),
  clearProposal: () => set({ proposal: null, decisions: {} }),
}));
