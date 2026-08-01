// ai-activity-store.ts -- per-tab AI job status for the right-panel rail.
//
// The rail shows a small indicator on a tab's icon when work is happening on a
// function the author isn't currently watching: a pulsing dot while a job runs,
// a solid dot once it finishes, cleared when that tab is opened. The results
// themselves live in ai-cache-store / brainstorm-store and survive regardless;
// this store only drives the "you have something to look at over here" nudge for
// the navigate-away / several-jobs-at-once cases. It's purely ephemeral UI state
// (never persisted) and is reset alongside the AI stores on project switch.

import { create } from "zustand";
import type { LegacyAssistantTab } from "@/stores/ai-intent-store";
import { useViewStore } from "@/stores/view-store";

export type AiActivity = "running" | "done" | "failed";

interface AiActivityState {
  /** Per-tab status; absent means nothing to surface. */
  status: Partial<Record<LegacyAssistantTab, AiActivity>>;
  start: (tab: LegacyAssistantTab) => void;
  finish: (tab: LegacyAssistantTab, outcome: "done" | "failed") => void;
  markSeen: (tab: LegacyAssistantTab) => void;
  reset: () => void;
}

/** True when the shared console is visible. A legacy job that settles while the
 *  console is visible needs no off-screen indicator. */
function isWatched(): boolean {
  const v = useViewStore.getState();
  return v.aiOpen && !v.focus;
}

export const useAiActivityStore = create<AiActivityState>((set) => ({
  status: {},
  start: (tab) => set((s) => ({ status: { ...s.status, [tab]: "running" } })),
  finish: (tab, outcome) =>
    set((s) => {
      const next = { ...s.status };
      if (isWatched()) delete next[tab];
      else next[tab] = outcome;
      return { status: next };
    }),
  // Opening a tab clears its settled badge (done or failed -- the body now shows
  // the result or the error), but a still-running job keeps its indicator so
  // navigating away again re-surfaces it.
  markSeen: (tab) =>
    set((s) => {
      if (s.status[tab] === "running" || s.status[tab] === undefined) return s;
      const next = { ...s.status };
      delete next[tab];
      return { status: next };
    }),
  reset: () => set(() => ({ status: {} })),
}));
