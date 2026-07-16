// muse-store.ts -- the Muse tab's run state: status, the directive being (or
// last) run, the live activity feed, and whether the finished run staged a
// proposal into the Edit tab. Purely ephemeral (sculpt precedent): runs are
// never persisted; only the staged proposal survives, in ai-cache-store. The
// AbortController lives in a ref inside muse-tab.tsx, not here (not
// serializable state, one owner).

import { create } from "zustand";
import type { AgentStep, MuseScope } from "@/lib/ai/agent";

export type MuseStatus = "idle" | "running" | "done" | "failed";

export interface MuseRun {
  chapterId: string;
  scope: MuseScope;
  targetIds: string[];
}

interface MuseState {
  status: MuseStatus;
  /** Chapter, scope, and targets frozen when the current run starts. */
  chapterId: string | null;
  scope: MuseScope;
  targetIds: string[];
  /** Directive of the current/last run ("" when idle-fresh). */
  directive: string;
  steps: AgentStep[];
  error: string | null;
  /** True when the finished run staged a proposal to the Edit tab. */
  staged: boolean;
  start: (directive: string, run: MuseRun) => void;
  addStep: (step: AgentStep) => void;
  finishStaged: () => void;
  finishEmpty: () => void;
  fail: (error: string) => void;
  reset: () => void;
}

export const useMuseStore = create<MuseState>((set) => ({
  status: "idle",
  chapterId: null,
  scope: "chapter",
  targetIds: [],
  directive: "",
  steps: [],
  error: null,
  staged: false,
  start: (directive, run) =>
    set({
      status: "running",
      chapterId: run.chapterId,
      scope: run.scope,
      targetIds: [...run.targetIds],
      directive,
      steps: [],
      error: null,
      staged: false,
    }),
  addStep: (step) => set((s) => ({ steps: [...s.steps, step] })),
  finishStaged: () => set({ status: "done", staged: true }),
  finishEmpty: () => set({ status: "done", staged: false }),
  fail: (error) => set({ status: "failed", error }),
  reset: () =>
    set({
      status: "idle",
      chapterId: null,
      scope: "chapter",
      targetIds: [],
      directive: "",
      steps: [],
      error: null,
      staged: false,
    }),
}));
