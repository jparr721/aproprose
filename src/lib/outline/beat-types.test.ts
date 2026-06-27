import { describe, it, expect } from "vitest";
import {
  BEAT_TYPE_META,
  BEAT_TYPES,
  beatTypeFromTitle,
} from "@/lib/outline/beat-types";
import type { BeatType } from "@/lib/types";

const ALL: BeatType[] = [
  "plot-point",
  "inciting",
  "pinch",
  "action",
  "midpoint",
  "climax",
  "resolution",
];

describe("BEAT_TYPES / BEAT_TYPE_META", () => {
  it("lists every BeatType once, in order", () => {
    expect(BEAT_TYPES).toEqual(ALL);
    expect(new Set(BEAT_TYPES).size).toBe(BEAT_TYPES.length);
  });

  it("has a label for every type", () => {
    for (const t of ALL) {
      const meta = BEAT_TYPE_META[t];
      expect(meta.label.length).toBeGreaterThan(0);
    }
    expect(BEAT_TYPE_META["plot-point"].label).toBe("Plot Point");
  });
});

describe("beatTypeFromTitle (migration)", () => {
  it("maps seeded titles to their structural type", () => {
    expect(beatTypeFromTitle("Inciting Incident")).toBe("inciting");
    expect(beatTypeFromTitle("Midpoint")).toBe("midpoint");
    expect(beatTypeFromTitle("Climax")).toBe("climax");
    expect(beatTypeFromTitle("Resolution")).toBe("resolution");
    expect(beatTypeFromTitle("Plot Point 1")).toBe("plot-point");
    expect(beatTypeFromTitle("Plot Point 2")).toBe("plot-point");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(beatTypeFromTitle("  inciting incident  ")).toBe("inciting");
  });

  it("falls back to plot-point for unknown titles", () => {
    expect(beatTypeFromTitle("Some Custom Beat")).toBe("plot-point");
    expect(beatTypeFromTitle("")).toBe("plot-point");
  });
});
