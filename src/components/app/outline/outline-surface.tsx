// outline-surface.tsx -- the Outline surface body in the right sidebar.

import { ScrollArea } from "@/components/ui/scroll-area";
import { TypographyMuted } from "@/components/ui/typography";

export function OutlineSurface() {
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-3.5">
        <TypographyMuted className="font-sans text-sm">Outline</TypographyMuted>
      </div>
    </ScrollArea>
  );
}
