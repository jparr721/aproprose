// view-store.ts — ephemeral view state shared across the chrome.
//
// Panel visibility (AI / PDF / focus) is read+written by the top bar, the editor
// layout, and the settings sheet, so per CLAUDE.md it's a store rather than a
// context. It also owns the "discard unsaved edits?" guard: any state-wiping
// action (open project, switch chapter, close) is routed through requestGuarded,
// which defers to a confirm dialog when the current chapter is dirty.

import { create } from "zustand";
import type { LayoutMode } from "@/lib/types";
import { useProjectStore } from "@/stores/project-store";

export type AiTab = "suggest" | "critique" | "brainstorm" | "continuity" | "cast";

interface ViewState {
  aiOpen: boolean;
  pdfOpen: boolean;
  focus: boolean;
  /** A pending state-wiping action awaiting confirmation, or null. */
  pending: (() => void) | null;

  /** Active AI panel tab. */
  aiTab: AiTab;
  /** Bumped to ask the Suggest tab to (re)run for the current cursor. */
  suggestNonce: number;

  toggleAi: () => void;
  togglePdf: () => void;
  applyLayoutPreset: (preset: LayoutMode) => void;
  setAiTab: (tab: AiTab) => void;
  /** Open the AI panel, focus Suggest, and request a fresh continuation. */
  triggerSuggest: () => void;

  /** Run `action` now, or stage it behind the confirm dialog if edits are unsaved. */
  requestGuarded: (action: () => void) => void;
  confirmPending: () => void;
  cancelPending: () => void;
}

export const useViewStore = create<ViewState>((set, get) => ({
  aiOpen: true,
  pdfOpen: false,
  focus: false,

  pending: null,

  aiTab: "suggest",
  suggestNonce: 0,

  toggleAi: () => set((s) => ({ aiOpen: !s.aiOpen, focus: false })),
  togglePdf: () => set((s) => ({ pdfOpen: !s.pdfOpen, focus: false })),

  applyLayoutPreset: (preset) => {
    if (preset === "focus") set({ focus: true });
    else if (preset === "two") set({ focus: false, aiOpen: true, pdfOpen: false });
    else set({ focus: false, aiOpen: true, pdfOpen: true });
  },

  setAiTab: (tab) => set({ aiTab: tab }),
  triggerSuggest: () =>
    set((s) => ({
      aiOpen: true,
      focus: false,
      aiTab: "suggest",
      suggestNonce: s.suggestNonce + 1,
    })),

  requestGuarded: (action) => {
    if (useProjectStore.getState().chapterDirty) set({ pending: () => action() });
    else action();
  },
  confirmPending: () => {
    const { pending } = get();
    pending?.();
    set({ pending: null });
  },
  cancelPending: () => set({ pending: null }),
}));
