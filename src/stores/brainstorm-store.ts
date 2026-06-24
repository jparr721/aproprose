// brainstorm-store.ts -- per-chapter Brainstorm chat threads.
//
// A Brainstorm thread belongs to its chapter. Only COMMITTED messages live here;
// the in-flight streaming buffer stays component-local in the panel so streaming
// deltas never trigger disk writes. ai-persistence loads/saves these threads per
// project so they survive tab switches, panel toggles, and app restarts.

import { create } from "zustand";
import type { ChatMessage } from "@/lib/types";

interface BrainstormState {
  /** Committed chat messages, keyed by chapter id. */
  threads: Record<string, ChatMessage[]>;
  /** Replace a single chapter's thread. */
  setThread: (chapterId: string, messages: ChatMessage[]) => void;
  /** Replace all threads (used when a project's saved AI state loads). */
  hydrate: (threads: Record<string, ChatMessage[]>) => void;
  /** Drop all threads (used when the open project changes or closes). */
  reset: () => void;
}

export const useBrainstormStore = create<BrainstormState>((set) => ({
  threads: {},
  setThread: (chapterId, messages) =>
    set((s) => ({ threads: { ...s.threads, [chapterId]: messages } })),
  hydrate: (threads) => set(() => ({ threads })),
  reset: () => set(() => ({ threads: {} })),
}));
