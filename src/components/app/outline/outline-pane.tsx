// outline-pane.tsx -- full-page storyboard surface (mirrors pdf-pane.tsx).
//
// A frameless aside: a thin header (title + close, which routes through the same
// toggleOutline the sidebar button uses) over the OutlineBoard. The board owns its
// own scrolling; the pane is just the chrome around it.

import { IconLayoutKanban, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { TypographySmall } from "@/components/ui/typography";
import { OutlineBoard } from "@/components/app/outline/outline-board";
import { useViewStore } from "@/stores/view-store";

export function OutlinePane() {
  const closeOutline = useViewStore((s) => s.toggleOutline);

  return (
    <aside className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-10 items-center justify-between border-b border-border bg-background px-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <IconLayoutKanban className="size-4" />
          <TypographySmall className="font-medium">Storyboard</TypographySmall>
        </div>
        <Button variant="ghost" size="icon-sm" title="Close storyboard" onClick={closeOutline}>
          <IconX />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <OutlineBoard />
      </div>
    </aside>
  );
}
