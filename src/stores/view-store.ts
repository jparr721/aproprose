// view-store.ts -- view state shared across the chrome.
//
// Panel visibility (AI / PDF / focus) is read+written by the top bar, the editor
// layout, and the command palette,
// so it belongs in a shared store rather than a context. It also owns the
// "discard unsaved edits?" guard: any state-wiping action (open project, switch
// chapter, close) routes through requestGuarded, which defers to a confirm
// dialog when the chapter is dirty.
//
// The right dock width and PDF / Outline open flags are persisted to the app
// config dir through the Tauri-backed storage adapter. The rest of the state is
// ephemeral and the pending guarded action is not serializable.

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
  pdfOpen: boolean;
  /** Whether the full-page Outline storyboard replaces the editor (persisted). */
  outlineOpen: boolean;
  focus: boolean;
  /** Whether the build-error viewer dialog is open. Lifted here so the badge,
   *  the failure toast, and the command palette can all open the same viewer. */
  buildErrorsOpen: boolean;
  /** A pending state-wiping action awaiting confirmation, or null. */
  pending: PendingGuardedAction | null;

  /** Persisted px width of the right panel's resizable content column. */
  rightPanelWidth: number;

  toggleAi: () => void;
  setAiOpen: (open: boolean) => void;
  openAiConsole: () => void;
  togglePdf: () => void;
  toggleOutline: () => void;
  openOutline: () => void;
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
  };
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

      rightPanelWidth: 360,

      toggleAi: () => set((s) => ({ aiOpen: !s.aiOpen, focus: false })),
      setAiOpen: (aiOpen) => set({ aiOpen }),
      openAiConsole: () => set({ aiOpen: true, focus: false }),
      togglePdf: () => set((s) => ({ pdfOpen: !s.pdfOpen, focus: false })),
      toggleOutline: () => set((s) => ({ outlineOpen: !s.outlineOpen, focus: false })),
      openOutline: () => set({ outlineOpen: true, focus: false }),
      setBuildErrorsOpen: (buildErrorsOpen) => set({ buildErrorsOpen }),

      applyLayoutPreset: (preset) => {
        if (preset === "focus") set({ focus: true });
        else if (preset === "two")
          set({ focus: false, aiOpen: true, pdfOpen: false });
        else set({ focus: false, aiOpen: true, pdfOpen: true });
      },

      setRightPanelWidth: (rightPanelWidth) => set({ rightPanelWidth }),

      requestGuarded: (action) => {
        get().pending?.cancel();
        const request = new Promise<
          GuardedActionResult<Awaited<ReturnType<typeof action>>>
        >((resolve, reject) => {
          const pending: PendingGuardedAction = {
            run: () => {
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
          if (useProjectStore.getState().chapterDirty) {
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
      // Persisted so a relaunch lands back in the same layout: the right dock
      // width and whether the PDF / Outline surfaces were open. AI visibility
      // stays ephemeral and `pending` is not serializable.
      partialize: ({ rightPanelWidth, pdfOpen, outlineOpen }) => ({
        rightPanelWidth,
        pdfOpen,
        outlineOpen,
      }),
      merge: mergePersistedViewState,
    },
  ),
);
