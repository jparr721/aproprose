// muse-store.ts -- the Muse tab's run state: status, the directive being (or
// last) run, the live activity feed, and whether the finished run staged a
// proposal into the Edit tab. Purely ephemeral (sculpt precedent): runs are
// never persisted; only the staged proposal survives, in ai-cache-store. The
// AbortController lives at module scope in muse-tab.tsx, not here (not
// serializable state, one owner).

import { create } from "zustand";
import type { AgentStep, MuseScope } from "@/lib/ai/agent";

export type MuseStatus = "idle" | "running" | "done" | "failed";

/** A run's frozen chapter + scope. Because MuseScope's block variant carries a
 *  non-empty target set, a block run with no targets is unrepresentable. */
export type MuseRun = { chapterId: string } & MuseScope;

interface MuseState {
  status: MuseStatus;
  /** The current/last run's frozen chapter + scope + targets; null when idle. */
  run: MuseRun | null;
  /** Directive of the current/last run ("" when idle-fresh). */
  directive: string;
  steps: AgentStep[];
  error: string | null;
  /** True when the finished run staged a proposal to the Edit tab. */
  staged: boolean;
  /** True when a block run staged only changes that fell outside its selection. */
  outOfScope: boolean;
  start: (directive: string, run: MuseRun) => void;
  addStep: (step: AgentStep) => void;
  finishStaged: () => void;
  finishEmpty: () => void;
  finishOutOfScope: () => void;
  fail: (error: string) => void;
  reset: () => void;
}

const IDLE = {
  status: "idle" as const,
  run: null,
  directive: "",
  steps: [] as AgentStep[],
  error: null,
  staged: false,
  outOfScope: false,
};

// Copy the block variant's targets so a caller mutating its array after start
// cannot retarget a run already in flight.
function freezeRun(run: MuseRun): MuseRun {
  return run.kind === "block"
    ? { chapterId: run.chapterId, kind: "block", targetIds: [...run.targetIds] }
    : run;
}

export const useMuseStore = create<MuseState>((set) => ({
  ...IDLE,
  start: (directive, run) =>
    set({
      status: "running",
      run: freezeRun(run),
      directive,
      steps: [],
      error: null,
      staged: false,
      outOfScope: false,
    }),
  addStep: (step) => set((s) => ({ steps: [...s.steps, step] })),
  finishStaged: () => set({ status: "done", staged: true, outOfScope: false }),
  finishEmpty: () => set({ status: "done", staged: false, outOfScope: false }),
  finishOutOfScope: () => set({ status: "done", staged: false, outOfScope: true }),
  fail: (error) => set({ status: "failed", error }),
  reset: () => set({ ...IDLE }),
}));
