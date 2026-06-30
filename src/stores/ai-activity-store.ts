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
import { useViewStore, type AiTab } from "@/stores/view-store";

export type AiActivity = "running" | "done";

interface AiActivityState {
  /** Per-tab status; absent means nothing to surface. */
  status: Partial<Record<AiTab, AiActivity>>;
  start: (tab: AiTab) => void;
  finish: (tab: AiTab) => void;
  markSeen: (tab: AiTab) => void;
  reset: () => void;
}

/** True when `tab` is the one the author is actively looking at: the panel is
 *  open, expanded, not in focus mode, and this tab is selected. A job that
 *  settles while its tab is watched needs no indicator. */
function isWatched(tab: AiTab): boolean {
  const v = useViewStore.getState();
  return v.aiOpen && !v.focus && !v.aiCollapsed && v.aiTab === tab;
}

export const useAiActivityStore = create<AiActivityState>((set) => ({
  status: {},
  start: (tab) => set((s) => ({ status: { ...s.status, [tab]: "running" } })),
  finish: (tab) =>
    set((s) => {
      const next = { ...s.status };
      if (isWatched(tab)) delete next[tab];
      else next[tab] = "done";
      return { status: next };
    }),
  // Opening a tab clears its finished badge, but a still-running job keeps its
  // indicator so navigating away again re-surfaces it.
  markSeen: (tab) =>
    set((s) => {
      if (s.status[tab] !== "done") return s;
      const next = { ...s.status };
      delete next[tab];
      return { status: next };
    }),
  reset: () => set(() => ({ status: {} })),
}));
