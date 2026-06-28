import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BeatType } from "@/lib/types";

export const BEAT_TYPE_LABEL: Record<BeatType, string> = {
  "plot-point": "Plot Point",
  inciting: "Inciting Incident",
  pinch: "Pinch",
  action: "Rising Action",
  midpoint: "Midpoint",
  climax: "Climax",
  resolution: "Resolution",
};

export const BEAT_TYPE_ORDER: BeatType[] = [
  "plot-point",
  "inciting",
  "pinch",
  "action",
  "midpoint",
  "climax",
  "resolution",
];

export function PlotPointBadge(props: { type: BeatType; className?: string }) {
  return (
    <Badge variant="outline" className={cn("border-border text-muted-foreground", props.className)}>
      {BEAT_TYPE_LABEL[props.type]}
    </Badge>
  );
}
