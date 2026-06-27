// beat-type-badge.tsx -- the structural-role pill for a beat.
//
// Tint comes from the @theme inline --color-beat-*-tint tokens (Task 1.2).
// Since there are exactly 7 fixed BeatType values, a static TINT_CLASS map
// covers all cases without a style object or dynamic class construction.

import { Badge } from "@/components/ui/badge";
import { BEAT_TYPE_META } from "@/lib/outline/beat-types";
import { cn } from "@/lib/utils";
import type { BeatType } from "@/lib/types";

const TINT_CLASS: Record<BeatType, string> = {
  "plot-point": "bg-beat-plot-point-tint",
  inciting: "bg-beat-inciting-tint",
  pinch: "bg-beat-pinch-tint",
  action: "bg-beat-action-tint",
  midpoint: "bg-beat-midpoint-tint",
  climax: "bg-beat-climax-tint",
  resolution: "bg-beat-resolution-tint",
};

export function BeatTypeBadge({ type }: { type: BeatType }) {
  return (
    <Badge
      variant="outline"
      className={cn("border-border text-foreground", TINT_CLASS[type])}
    >
      {BEAT_TYPE_META[type].label}
    </Badge>
  );
}
