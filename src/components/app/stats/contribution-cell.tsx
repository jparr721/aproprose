import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils";
import type { CellLevel } from "@/lib/stats/stats";

// Five levels ramp foreground opacity over the bg-card chart surface so the grid
// stays legible in every theme (a muted empty level can collapse into the card).
export const CELL_LEVEL_CLASSES = [
  "bg-foreground/10",
  "bg-foreground/25",
  "bg-foreground/45",
  "bg-foreground/65",
  "bg-foreground/90",
];

export function ContributionCell({
  level,
  className,
  ...rest
}: ComponentPropsWithRef<"div"> & { level: CellLevel }) {
  return (
    <div
      {...rest}
      className={cn("size-3 rounded-[3px]", CELL_LEVEL_CLASSES[level], className)}
    />
  );
}
