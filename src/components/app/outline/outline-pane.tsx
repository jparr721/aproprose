// outline-pane.tsx -- the full-page Outline view.
//
// Replaces the editor in the main pane when outlineOpen (and not focus). Mirrors
// pdf-pane.tsx's shell: a titled header with a close button that flips
// outlineOpen, over a scroll body. For now the body is the existing
// OutlineSurface full-width; the storyboard <OutlineBoard/> lands in Phase 3.

import { IconLayoutList, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { OutlineSurface } from "@/components/app/outline/outline-surface";
import { useViewStore } from "@/stores/view-store";

export function OutlinePane() {
  const closeOutline = useViewStore((s) => s.toggleOutline);

  return (
    <aside className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-10 items-center justify-between border-b border-border bg-background px-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <IconLayoutList className="size-4" />
          <span className="font-sans text-xs">Storyboard</span>
        </div>
        <Button variant="ghost" size="icon-sm" title="Close outline" onClick={closeOutline}>
          <IconX />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <OutlineSurface />
      </div>
    </aside>
  );
}
