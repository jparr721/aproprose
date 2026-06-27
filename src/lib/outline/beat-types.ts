// beat-types.ts -- presentation table + title->type migration for beat structure.
//
// `tintVar` is a CSS variable TOKEN NAME (declared in src/index.css), never a
// literal color: components read it through a per-instance CSS variable so the
// badge tint retunes with the theme, not the call site.

import type { BeatType } from "@/lib/types";

export interface BeatTypeMeta {
  label: string;
  /** CSS-var token name for the badge tint, e.g. "--beat-inciting-tint". */
  tintVar: string;
}

export const BEAT_TYPE_META: Record<BeatType, BeatTypeMeta> = {
  "plot-point": { label: "Plot Point", tintVar: "--beat-plot-point-tint" },
  inciting: { label: "Inciting", tintVar: "--beat-inciting-tint" },
  pinch: { label: "Pinch", tintVar: "--beat-pinch-tint" },
  action: { label: "Action", tintVar: "--beat-action-tint" },
  midpoint: { label: "Midpoint", tintVar: "--beat-midpoint-tint" },
  climax: { label: "Climax", tintVar: "--beat-climax-tint" },
  resolution: { label: "Resolution", tintVar: "--beat-resolution-tint" },
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
