// stats-store.ts -- the global writing-activity log (words added/removed/saves
// per local day, plus a per-project word-count baseline used to compute deltas).
// Persisted to the app config dir via the Tauri-backed adapter, validated with
// Zod on rehydrate so a corrupt file degrades to empty instead of crashing.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { tauriStateStorage } from "@/lib/storage";
import { localDateKey } from "@/lib/stats/stats";
import { WritingStatsSchema, type WritingStats } from "@/lib/stats/schema";

interface StatsState extends WritingStats {
  noteBaseline: (root: string, total: number) => void;
  recordSave: (root: string, total: number) => void;
}

export const useStatsStore = create<StatsState>()(
  persist(
    (set) => ({
      baselines: {},
      days: {},

      noteBaseline: (root, total) =>
        set((s) => ({ baselines: { ...s.baselines, [root]: total } })),

      recordSave: (root, total) =>
        set((s) => {
          const prev = s.baselines[root] ?? total;
          const delta = total - prev;
          const key = localDateKey(new Date());
          const day = s.days[key] ?? { added: 0, removed: 0, saves: 0 };
          const next = {
            added: day.added + (delta > 0 ? delta : 0),
            removed: day.removed + (delta < 0 ? -delta : 0),
            saves: day.saves + 1,
          };
          return {
            baselines: { ...s.baselines, [root]: total },
            days: { ...s.days, [key]: next },
          };
        }),
    }),
    {
      name: "writing-stats",
      version: 1,
      storage: createJSONStorage(() => tauriStateStorage),
      partialize: ({ baselines, days }) => ({ baselines, days }),
      merge: (persisted, current) => {
        const parsed = WritingStatsSchema.safeParse(persisted);
        if (!parsed.success) return current;
        return { ...current, baselines: parsed.data.baselines, days: parsed.data.days };
      },
    },
  ),
);
