// view-store.ts -- view state shared across the chrome.
//
// Panel visibility (AI / PDF / focus) and the AI panel's active tab / collapse
// are read+written by the top bar, the editor layout, and the command palette,
// so per CLAUDE.md it's a store rather than a context. It also owns the
// "discard unsaved edits?" guard: any state-wiping action (open project, switch
// chapter, close) routes through requestGuarded, which defers to a confirm
// dialog when the chapter is dirty.
//
// `aiTab`, the right-panel width, and the PDF / Outline open flags are persisted
// (to the app config dir, via the Tauri-backed storage adapter) so a relaunch
// reopens the same layout the author left; the rest of the state is ephemeral and
// the `pending` callback is not serializable.

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
  /** Whether the full-page Outline storyboard replaces the editor (persisted). */
  outlineOpen: boolean;
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
  /** Persisted px width of the right panel's resizable content column. */
  rightPanelWidth: number;

  toggleAi: () => void;
  togglePdf: () => void;
  toggleOutline: () => void;
  setBuildErrorsOpen: (open: boolean) => void;
  applyLayoutPreset: (preset: LayoutMode) => void;
  setAiTab: (tab: AiTab) => void;
  setAiCollapsed: (v: boolean) => void;
  setRightPanelWidth: (px: number) => void;
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
      outlineOpen: false,
      focus: false,
      buildErrorsOpen: false,

      pending: null,

      aiTab: "suggest",
      suggestFocusTick: 0,
      aiCollapsed: false,
      rightPanelWidth: 360,

      // Clear aiCollapsed on every toggle so reopening always restores the panel
      // content, never a bare icon rail (aiOpen + aiCollapsed must agree on "is
      // content visible"). Matches openAiTab / triggerSuggest.
      toggleAi: () => set((s) => ({ aiOpen: !s.aiOpen, focus: false, aiCollapsed: false })),
      togglePdf: () => set((s) => ({ pdfOpen: !s.pdfOpen, focus: false })),
      toggleOutline: () => set((s) => ({ outlineOpen: !s.outlineOpen, focus: false })),
      setBuildErrorsOpen: (buildErrorsOpen) => set({ buildErrorsOpen }),

      applyLayoutPreset: (preset) => {
        if (preset === "focus") set({ focus: true });
        else if (preset === "two")
          set({ focus: false, aiOpen: true, pdfOpen: false, aiCollapsed: false });
        else set({ focus: false, aiOpen: true, pdfOpen: true, aiCollapsed: false });
      },

      setAiTab: (tab) => set({ aiTab: tab }),
      setAiCollapsed: (v) => set({ aiCollapsed: v }),
      setRightPanelWidth: (rightPanelWidth) => set({ rightPanelWidth }),
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
      // Persisted so a relaunch lands back in the same layout: the selected tab,
      // the right-panel width, and whether the PDF / Outline surfaces were open.
      // The AI-panel and collapse flags stay ephemeral and `pending` isn't
      // serializable.
      partialize: ({ aiTab, rightPanelWidth, pdfOpen, outlineOpen }) => ({
        aiTab,
        rightPanelWidth,
        pdfOpen,
        outlineOpen,
      }),
    },
  ),
);
