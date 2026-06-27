// view-store.ts -- view state shared across the chrome.
//
// Panel visibility (AI / PDF / focus) and the AI panel's active tab / collapse
// are read+written by the top bar, the editor layout, and the command palette,
// so per CLAUDE.md it's a store rather than a context. It also owns the
// "discard unsaved edits?" guard: any state-wiping action (open project, switch
// chapter, close) routes through requestGuarded, which defers to a confirm
// dialog when the chapter is dirty.
//
// Only `aiTab` is persisted (to the app config dir, via the Tauri-backed storage
// adapter) so the panel reopens on the tab the author last used; the rest of the
// state is ephemeral and the `pending` callback is not serializable.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { LayoutMode } from "@/lib/types";
import { tauriStateStorage } from "@/lib/storage";
import { useProjectStore } from "@/stores/project-store";

export type AiTab =
  | "outline"
  | "suggest"
  | "edit"
  | "critique"
  | "brainstorm"
  | "continuity"
  | "cast";

interface ViewState {
  aiOpen: boolean;
  pdfOpen: boolean;
  focus: boolean;
  /** Whether the build-error viewer dialog is open. Lifted here so the badge,
   *  the failure toast, and the command palette can all open the same viewer. */
  buildErrorsOpen: boolean;
  /** A pending state-wiping action awaiting confirmation, or null. */
  pending: (() => void) | null;

  /** Active AI panel tab. */
  aiTab: AiTab;
  /** Bumped to focus the Suggest ask box (e.g. from the spark). Never runs the model. */
  suggestFocusTick: number;
  /** True when the panel is collapsed to just the icon rail (ephemeral). */
  aiCollapsed: boolean;

  toggleAi: () => void;
  togglePdf: () => void;
  setBuildErrorsOpen: (open: boolean) => void;
  applyLayoutPreset: (preset: LayoutMode) => void;
  setAiTab: (tab: AiTab) => void;
  setAiCollapsed: (v: boolean) => void;
  /** Open + expand the AI panel and switch to `tab` in one step (command palette). */
  openAiTab: (tab: AiTab) => void;
  /** Open the AI panel, focus Suggest, and put the cursor in the ask box. Does not infer. */
  triggerSuggest: () => void;

  /** Run `action` now, or stage it behind the confirm dialog if edits are unsaved. */
  requestGuarded: (action: () => void) => void;
  confirmPending: () => void;
  cancelPending: () => void;
}

export const useViewStore = create<ViewState>()(
  persist(
    (set, get) => ({
      aiOpen: true,
      pdfOpen: false,
      focus: false,
      buildErrorsOpen: false,

      pending: null,

      aiTab: "suggest",
      suggestFocusTick: 0,
      aiCollapsed: false,

      toggleAi: () => set((s) => ({ aiOpen: !s.aiOpen, focus: false })),
      togglePdf: () => set((s) => ({ pdfOpen: !s.pdfOpen, focus: false })),
      setBuildErrorsOpen: (buildErrorsOpen) => set({ buildErrorsOpen }),

      applyLayoutPreset: (preset) => {
        if (preset === "focus") set({ focus: true });
        else if (preset === "two") set({ focus: false, aiOpen: true, pdfOpen: false });
        else set({ focus: false, aiOpen: true, pdfOpen: true });
      },

      setAiTab: (tab) => set({ aiTab: tab }),
      setAiCollapsed: (v) => set({ aiCollapsed: v }),
      openAiTab: (tab) =>
        set({ aiOpen: true, focus: false, aiTab: tab, aiCollapsed: false }),
      triggerSuggest: () =>
        set((s) => ({
          aiOpen: true,
          focus: false,
          aiTab: "suggest",
          aiCollapsed: false,
          suggestFocusTick: s.suggestFocusTick + 1,
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
    }),
    {
      name: "view",
      storage: createJSONStorage(() => tauriStateStorage),
      // Only the selected tab persists; visibility toggles, the settings sheet,
      // and the collapse flag are ephemeral and `pending` is not serializable.
      partialize: ({ aiTab }) => ({ aiTab }),
    },
  ),
);
