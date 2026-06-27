// beat-types.ts -- presentation table + title->type migration for beat structure.

import type { BeatType } from "@/lib/types";

export interface BeatTypeMeta {
  label: string;
}

export const BEAT_TYPE_META: Record<BeatType, BeatTypeMeta> = {
  "plot-point": { label: "Plot Point" },
  inciting: { label: "Inciting" },
  pinch: { label: "Pinch" },
  action: { label: "Action" },
  midpoint: { label: "Midpoint" },
  climax: { label: "Climax" },
  resolution: { label: "Resolution" },
};

/** Ordered list for the type Select and any "all types" iteration. */
export const BEAT_TYPES: BeatType[] = [
  "plot-point",
  "inciting",
  "pinch",
  "action",
  "midpoint",
  "climax",
  "resolution",
];

/** Map a seeded/known beat title to its structural type; "plot-point" otherwise. */
export function beatTypeFromTitle(title: string): BeatType {
  const t = title.trim().toLowerCase();
  if (t.includes("inciting")) return "inciting";
  if (t.includes("midpoint")) return "midpoint";
  if (t.includes("climax")) return "climax";
  if (t.includes("resolution")) return "resolution";
  if (t.includes("pinch")) return "pinch";
  return "plot-point";
}
