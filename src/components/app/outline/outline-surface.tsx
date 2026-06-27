// outline-surface.tsx -- the Outline surface body in the right sidebar.

import { ScrollArea } from "@/components/ui/scroll-area";
import { PremiseCard } from "@/components/app/outline/premise-card";
import { ThisChapterCard } from "@/components/app/outline/this-chapter-card";

export function OutlineSurface() {
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3.5 p-3.5">
        <PremiseCard />
        <ThisChapterCard />
      </div>
    </ScrollArea>
  );
}
