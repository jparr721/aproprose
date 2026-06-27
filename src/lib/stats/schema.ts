// schema.ts -- Zod shapes for the persisted writing-stats log, so a corrupt or
// outdated app-config file deserializes in a validated, structured way (and
// falls back to empty instead of crashing).

import { z } from "zod";

export const DayActivitySchema = z.object({
  added: z.number().int().nonnegative(),   // gross words added that day (sum of positive per-save deltas)
  removed: z.number().int().nonnegative(), // gross words removed that day (sum of |negative deltas|)
  saves: z.number().int().nonnegative(),   // genuine writing saves that day
});
export type DayActivity = z.infer<typeof DayActivitySchema>;

export const WritingStatsSchema = z.object({
  baselines: z.record(z.string(), z.number().int().nonnegative()), // projectRoot -> last total word count seen
  days: z.record(z.string(), DayActivitySchema),                   // local "YYYY-MM-DD" -> activity
});
export type WritingStats = z.infer<typeof WritingStatsSchema>;

export const EMPTY_STATS: WritingStats = { baselines: {}, days: {} };
