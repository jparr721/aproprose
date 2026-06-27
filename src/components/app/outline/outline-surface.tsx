// outline-surface.tsx -- the Outline surface body in the right sidebar.

import { ScrollArea } from "@/components/ui/scroll-area";
import { PremiseCard } from "@/components/app/outline/premise-card";
import { PacingGuide } from "@/components/app/outline/pacing-guide";
import { ThisChapterCard } from "@/components/app/outline/this-chapter-card";
import { ActSection } from "@/components/app/outline/act-section";
import { TypographyEyebrow } from "@/components/ui/typography";
import type { ActKind } from "@/lib/types";

const ACTS: ActKind[] = ["setup", "confrontation", "resolution"];

export function OutlineSurface() {
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3.5 p-3.5">
        <PremiseCard />
        <PacingGuide />
        <ThisChapterCard />
        <div className="flex items-center gap-2">
          <TypographyEyebrow className="text-muted-foreground">Story spine</TypographyEyebrow>
          <span className="h-px flex-1 bg-border" />
        </div>
        {ACTS.map((kind) => (
          <ActSection key={kind} actKind={kind} />
        ))}
      </div>
    </ScrollArea>
  );
}
