// ai-cache-store.ts — in-memory cache for the right-panel AI results.
//
// The generating AI tabs (Suggest, Critique, Continuity, Cast) are idle-first:
// nothing runs until the author clicks Generate. Radix unmounts inactive tabs and
// App.tsx unmounts the whole panel whenever the AI panel or focus mode toggles,
// so without a cache a generated result would be lost on every tab switch / panel
// toggle / reopen and the author would have to re-ask. Entries are keyed by
// "<op>:<chapter>:<block>" so a genuine change of scene/cursor reads as idle, but
// a remount within the same scene reuses the result. A request fires only from an
// explicit run() — the tabs' Generate / Try again / Refresh. The ask-box
// instruction that produced a result is stored alongside it so a remounted tab
// can restore the box and keep it in sync with the result shown.

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
}

export const useAiCacheStore = create<AiCacheState>((set) => ({
  entries: {},
  patch: (key, entry) =>
    set((s) => ({
      entries: { ...s.entries, [key]: { ...s.entries[key], ...entry } },
    })),
}));
