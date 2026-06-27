// beat-signals.ts -- presentation-agnostic continuity-health signal for a beat.
//
// Mirrors the SEV_DOT severity coloring used by the right-panel ContinuityTab so
// the storyboard card and the detail rail read continuity health the same way.

import type { ContinuityFlag, ContinuitySeverity } from "@/lib/types";

const SEV_RANK: Record<ContinuitySeverity, number> = { ok: 0, warn: 1, flag: 2 };

export const SEV_DOT: Record<ContinuitySeverity, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  flag: "bg-destructive",
};

export function worstSev(flags: ContinuityFlag[]): ContinuitySeverity | null {
  if (flags.length === 0) return null;
  return flags.reduce<ContinuitySeverity>(
    (worst, f) => (SEV_RANK[f.sev] > SEV_RANK[worst] ? f.sev : worst),
    flags[0].sev,
  );
}
