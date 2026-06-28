import { IconLayoutKanban, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { TypographySmall } from "@/components/ui/typography";
import { OutlineBoard } from "@/components/app/outline/outline-board";
import { ChapterSubview } from "@/components/app/outline/chapter-subview";
import { useOutlineBoardStore } from "@/stores/outline-board-store";
import { useViewStore } from "@/stores/view-store";

export function OutlinePane() {
  const closeOutline = useViewStore((s) => s.toggleOutline);
  const openChapterId = useOutlineBoardStore((s) => s.openChapterId);

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
      <div className="min-h-0 flex-1">{openChapterId ? <ChapterSubview /> : <OutlineBoard />}</div>
    </aside>
  );
}
