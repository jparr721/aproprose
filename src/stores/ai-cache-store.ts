// ai-cache-store.ts -- in-memory cache for the right-panel AI results.
//
// The generating AI functions (Suggest, Critique, Continuity) are idle-first:
// nothing runs until the author submits. The panel mounts only the active function
// and App.tsx unmounts the whole panel whenever the AI panel or focus mode toggles,
// so without a cache a generated result would be lost on every switch / panel
// toggle / reopen and the author would have to re-ask. Entries are keyed by
// "<op>:<chapter>:<block>" so a genuine change of scene/cursor reads as idle, but
// a remount within the same scene reuses the result. A request fires only from an
// explicit run(). The instruction that produced a result is stored alongside it so
// a remounted tab can caption it (see AskedCaption); ai-persistence snapshots these
// entries so results also survive an app restart.

import { create } from "zustand";

export interface AiCacheEntry {
  /** Resolved result, or null until the first request for this key settles. */
  data: unknown;
  /** True while a request for this key is in flight. */
  loading: boolean;
  /** Stringified error from the last failed request, or null. */
  error: string | null;
  /** The ask-box instruction that produced `data`, so a remounted tab can
   *  restore its box and keep it in sync with the result shown. */
  instruction?: string;
}

interface AiCacheState {
  entries: Record<string, AiCacheEntry>;
  /** Merge a partial entry into the cache for `key`. */
  patch: (key: string, entry: Partial<AiCacheEntry>) => void;
  /** Replace all entries (used when a project's saved AI state loads). Any
   *  persisted `loading` flag is forced false -- a request can't be in flight. */
  hydrate: (entries: Record<string, AiCacheEntry>) => void;
  /** Drop all entries (used when the open project changes or closes). */
  reset: () => void;
}

export const useAiCacheStore = create<AiCacheState>((set) => ({
  entries: {},
  patch: (key, entry) =>
    set((s) => ({
      entries: { ...s.entries, [key]: { ...s.entries[key], ...entry } },
    })),
  hydrate: (entries) =>
    set(() => {
      const next: Record<string, AiCacheEntry> = {};
      for (const [key, e] of Object.entries(entries)) {
        next[key] = { ...e, loading: false };
      }
      return { entries: next };
    }),
  reset: () => set(() => ({ entries: {} })),
}));
