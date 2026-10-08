// view-store.ts -- view state shared across the chrome.
//
// Panel visibility (Changes / AI / PDF / focus) is read+written by the top bar, the editor
// layout, and the command palette,
// so it belongs in a shared store rather than a context. It also owns the
// "discard unsaved edits?" guard: any state-wiping action (open project, switch
// chapter, close) routes through requestGuarded, which defers to a confirm
// dialog when the chapter is dirty.
//
// The right dock surface/width and PDF / Outline flags are persisted through
// the Tauri-backed storage adapter. Selection and guarded actions are ephemeral.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { z } from "zod";
import type { LayoutMode } from "@/lib/types";
import { tauriStateStorage } from "@/lib/storage";
import { useProjectStore } from "@/stores/project-store";

export type GuardedActionResult<Result> =
  | { status: "ran"; value: Result }
  | { status: "canceled" };

interface PendingGuardedAction {
  run: () => void;
  cancel: () => void;
}

interface ViewState {
  aiOpen: boolean;
  changesOpen: boolean;
  selectedChange: { sessionKey: string; proposalId: string } | null;
  pdfOpen: boolean;
  /** Whether the full-page Outline storyboard replaces the editor (persisted). */
  outlineOpen: boolean;
  manuscriptReviewProposalId: string | null;
  focus: boolean;
  /** An ephemeral request consumed by the project AI composer after it mounts. */
  aiComposerFocusRequested: boolean;
  /** Whether the build-error viewer dialog is open. Lifted here so the badge,
   *  the failure toast, and the command palette can all open the same viewer. */
  buildErrorsOpen: boolean;
  /** A pending state-wiping action awaiting confirmation, or null. */
  pending: PendingGuardedAction | null;

  /** Persisted px width of the right panel's resizable content column. */
  rightPanelWidth: number;

  toggleAi: () => void;
  toggleChanges: () => void;
  setChangesOpen: (open: boolean) => void;
  openChanges: () => void;
  selectChange: (sessionKey: string, proposalId: string) => void;
  clearChangeSelection: () => void;
  setAiOpen: (open: boolean) => void;
  openAiConsole: () => void;
  requestAiComposerFocus: () => void;
  consumeAiComposerFocusRequest: () => void;
  togglePdf: () => void;
  toggleOutline: () => void;
  openOutline: () => void;
  openManuscriptReview: (proposalId: string) => void;
  closeManuscriptReview: () => void;
  setBuildErrorsOpen: (open: boolean) => void;
  applyLayoutPreset: (preset: LayoutMode) => void;
  setRightPanelWidth: (px: number) => void;

  /** Run `action` now, or stage it behind the confirm dialog if edits are unsaved. */
  requestGuarded: <Result>(
    action: () => Result | Promise<Result>,
  ) => Promise<GuardedActionResult<Awaited<Result>>>;
  confirmPending: () => void;
  cancelPending: () => void;
}

const persistedViewStateSchema = z.object({
  rightPanelWidth: z.number().finite(),
  pdfOpen: z.boolean(),
  outlineOpen: z.boolean(),
  rightSurface: z.enum(["ai", "changes"]).nullable().optional(),
});

function mergePersistedViewState(
  persistedState: unknown,
  currentState: ViewState,
): ViewState {
  if (persistedState === undefined) return currentState;
  const parsed = persistedViewStateSchema.parse(persistedState);
  return {
    ...currentState,
    rightPanelWidth: parsed.rightPanelWidth,
    pdfOpen: parsed.pdfOpen,
    outlineOpen: parsed.outlineOpen,
    ...(parsed.rightSurface === undefined
      ? {}
      : {
          aiOpen: parsed.rightSurface === "ai",
          changesOpen: parsed.rightSurface === "changes",
        }),
  };
}

export const useViewStore = create<ViewState>()(
  persist(
    (set, get) => ({
      aiOpen: true,
      changesOpen: false,
      selectedChange: null,
      pdfOpen: false,
      outlineOpen: false,
      manuscriptReviewProposalId: null,
      focus: false,
      buildErrorsOpen: false,
      aiComposerFocusRequested: false,

      pending: null,

      rightPanelWidth: 360,

      toggleAi: () =>
        set((s) => ({ aiOpen: !s.aiOpen, changesOpen: false, focus: false })),
      toggleChanges: () =>
        set((s) => ({ changesOpen: !s.changesOpen, aiOpen: false, focus: false })),
      setChangesOpen: (changesOpen) =>
        set(changesOpen ? { changesOpen, aiOpen: false, focus: false } : { changesOpen }),
      openChanges: () => set({ changesOpen: true, aiOpen: false, focus: false }),
      selectChange: (sessionKey, proposalId) =>
        set({
          selectedChange: { sessionKey, proposalId },
          changesOpen: true,
          aiOpen: false,
          focus: false,
        }),
      clearChangeSelection: () => set({ selectedChange: null }),
      setAiOpen: (aiOpen) =>
        set(aiOpen ? { aiOpen, changesOpen: false, focus: false } : { aiOpen }),
      openAiConsole: () =>
        set({
          aiOpen: true,
          changesOpen: false,
          focus: false,
        }),
      requestAiComposerFocus: () =>
        set({
          aiOpen: true,
          changesOpen: false,
          focus: false,
          aiComposerFocusRequested: true,
        }),
      consumeAiComposerFocusRequest: () =>
        set({ aiComposerFocusRequested: false }),
      togglePdf: () => set((s) => ({ pdfOpen: !s.pdfOpen, focus: false })),
      toggleOutline: () =>
        set((s) => {
          const outlineOpen = !s.outlineOpen;
          return {
            outlineOpen,
            focus: false,
            ...(outlineOpen ? { manuscriptReviewProposalId: null } : {}),
          };
        }),
      openOutline: () =>
        set({
          outlineOpen: true,
          manuscriptReviewProposalId: null,
          focus: false,
        }),
      openManuscriptReview: (manuscriptReviewProposalId) =>
        set({
          manuscriptReviewProposalId,
          outlineOpen: false,
          focus: false,
        }),
      closeManuscriptReview: () => set({ manuscriptReviewProposalId: null }),
      setBuildErrorsOpen: (buildErrorsOpen) => set({ buildErrorsOpen }),

      applyLayoutPreset: (preset) => {
        if (preset === "focus") set({ focus: true });
        else if (preset === "two")
          set({ focus: false, aiOpen: true, changesOpen: false, pdfOpen: false });
        else set({ focus: false, aiOpen: true, changesOpen: false, pdfOpen: true });
      },

      setRightPanelWidth: (rightPanelWidth) => set({ rightPanelWidth }),

      requestGuarded: (action) => {
        get().pending?.cancel();
        const { lifecycleGeneration, activeChapterId } = useProjectStore.getState();
        const request = new Promise<
          GuardedActionResult<Awaited<ReturnType<typeof action>>>
        >((resolve, reject) => {
          const pending: PendingGuardedAction = {
            run: () => {
              const live = useProjectStore.getState();
              if (live.lifecycleGeneration !== lifecycleGeneration || live.activeChapterId !== activeChapterId) {
                resolve({ status: "canceled" });
                return;
              }
              try {
                void Promise.resolve(action()).then(
                  (value) => resolve({ status: "ran", value }),
                  reject,
                );
              } catch (error) {
                reject(error);
              }
            },
            cancel: () => resolve({ status: "canceled" }),
          };
          if (useProjectStore.getState().chapterDirty || useProjectStore.getState().remoteDivergence !== null) {
            set({ pending });
          } else {
            set({ pending: null });
            pending.run();
          }
        });
        return request;
      },
      confirmPending: () => {
        const { pending } = get();
        set({ pending: null });
        pending?.run();
      },
      cancelPending: () => {
        const { pending } = get();
        set({ pending: null });
        pending?.cancel();
      },
    }),
    {
      name: "view",
      storage: createJSONStorage(() => tauriStateStorage),
      // Restore the workspace layout without persisting proposal payloads or guards.
      partialize: ({ rightPanelWidth, pdfOpen, outlineOpen, aiOpen, changesOpen }) => ({
        rightPanelWidth,
        pdfOpen,
        outlineOpen,
        rightSurface: changesOpen ? "changes" : aiOpen ? "ai" : null,
      }),
      merge: mergePersistedViewState,
    },
  ),
);
