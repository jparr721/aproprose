// ai-cache-store.ts — in-memory cache for the right-panel AI results.
//
// Each AI tab (Suggest, Critique, Continuity, Cast) fires a gpt-5.4-nano call on
// mount. Radix unmounts inactive tabs and App.tsx unmounts the whole panel
// whenever the AI panel or focus mode toggles, so without a cache every tab
// switch / panel toggle / reopen re-runs the model and burns tokens for a result
// we already have. Entries are keyed by "<op>:<scope>" (scope = the chapter, plus
// the suggest nonce) so a genuine change of scene still refetches, but a remount
// reuses the cached result. A request fires only on the first sight of a key or on
// an explicit run() — the tabs' "Try again" / "Refresh" buttons.

import { create } from "zustand";

export interface AiCacheEntry {
  /** Resolved result, or null until the first request for this key settles. */
  data: unknown;
  /** True while a request for this key is in flight. */
  loading: boolean;
  /** Stringified error from the last failed request, or null. */
  error: string | null;
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
