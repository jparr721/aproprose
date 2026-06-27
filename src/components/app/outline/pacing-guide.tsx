// pacing-guide.tsx -- three-act target zones vs where the words actually sit.
//
// Bars are sized by each act's share of LINKED words; dashed gridlines at 25% and
// 75% mark the three-act targets. A one-line note calls out the largest overrun.
// Hidden until at least one chapter is linked (nothing to measure otherwise).
//
// Segment widths are genuinely dynamic (computed percentages) so they go through
// a CSS custom property per CLAUDE.md: style={{ "--seg-w": `${n}%` }} + w-[var(--seg-w)].

import { useProjectStore } from "@/stores/project-store";
import { TypographyEyebrow, TypographyMuted } from "@/components/ui/typography";
import { actPacing, ACT_TARGETS } from "@/lib/outline/model";
import { cn } from "@/lib/utils";
import type { ActKind } from "@/lib/types";

const ACTS: ActKind[] = ["setup", "confrontation", "resolution"];

const SEG_TINT: Record<ActKind, string> = {
  setup: "bg-warning/70",
  confrontation: "bg-accent-ink/70",
  resolution: "bg-muted-foreground/30",
};

type SegStyle = React.CSSProperties & Record<"--seg-w", string>;

export function PacingGuide() {
  const outline = useProjectStore((s) => s.meta.outline);
  const project = useProjectStore((s) => s.project);
  const chapters = project?.chapters ?? [];
  const pacing = actPacing(outline, chapters);

  const anyLinked = ACTS.some((k) => pacing[k].words > 0);
  if (!anyLinked) return null;

  const titleOf = (k: ActKind) => outline.acts.find((a) => a.kind === k)!.title;

  // Largest positive deviation from target, for the note.
  const worst = ACTS.map((k) => ({ k, over: pacing[k].actualShare - ACT_TARGETS[k] })).sort(
    (a, b) => b.over - a.over,
  )[0];
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const overruns = worst.over > 0.05;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <TypographyEyebrow>Pacing</TypographyEyebrow>
        {overruns ? (
          <span className="text-xs font-medium text-warning">{titleOf(worst.k)} running long</span>
        ) : null}
      </div>
      <div className="relative flex h-7 overflow-hidden rounded-lg border border-border bg-muted">
        {ACTS.map((k) => (
          <div
            key={k}
            className={cn(
              "flex items-center justify-center overflow-hidden px-1 text-xs text-foreground/70 w-[var(--seg-w)]",
              SEG_TINT[k],
            )}
            style={{ "--seg-w": `${pacing[k].actualShare * 100}%` } as SegStyle}
          >
            <span className="truncate">{pacing[k].actualShare > 0.12 ? titleOf(k) : ""}</span>
          </div>
        ))}
        <span className="pointer-events-none absolute inset-y-0 left-1/4 border-l border-dashed border-muted-foreground/70" />
        <span className="pointer-events-none absolute inset-y-0 left-3/4 border-l border-dashed border-muted-foreground/70" />
      </div>
      <TypographyMuted className="text-xs leading-snug">
        {titleOf(worst.k)} holds {pct(pacing[worst.k].actualShare)} of your linked words (target{" "}
        {pct(ACT_TARGETS[worst.k])}). Dashed lines are the three-act targets; bars are where your
        words sit.
      </TypographyMuted>
    </div>
  );
}
