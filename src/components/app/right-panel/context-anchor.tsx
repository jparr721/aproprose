// context-anchor.tsx -- the "you are here" pill above every composer's input.

import { IconArrowDown } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { scrollSelectedIntoView } from "@/components/app/editor";
import { useProjectStore } from "@/stores/project-store";
import { TypographyEyebrow, TypographyMuted } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

/** The "you are here": the grounding the AI operation anchors to. Sits just above
 *  the composer's text input. In cursor/block mode it names the block under the
 *  caret (its text wraps over up to two lines so a longer tail reads naturally);
 *  in whole-chapter mode the caret is irrelevant, so it names the chapter being
 *  read instead of claiming to continue after the selected block. */
export function ContextAnchor({ wholeChapter }: { wholeChapter: boolean }) {
  const selectedId = useProjectStore((s) => s.selectedId);
  const blocks = useProjectStore((s) => s.blocks);
  const chapterTitle = useProjectStore((s) =>
    s.project?.chapters.find((c) => c.id === s.activeChapterId)?.title,
  );
  const block =
    !wholeChapter && selectedId ? blocks.find((b) => b.id === selectedId) : undefined;
  const text = block?.text.trim();

  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-ai-tint/40 px-2.5 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <TypographyEyebrow className="text-ai-ink">
          {wholeChapter ? "Whole chapter" : block ? `Continuing after ${block.type}` : "Cursor"}
        </TypographyEyebrow>
        {block && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Scroll to block in editor"
                onClick={() => scrollSelectedIntoView()}
              >
                <IconArrowDown className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Go to block</TooltipContent>
          </Tooltip>
        )}
      </div>
      <TypographyMuted
        className={cn("line-clamp-2 text-xs", !wholeChapter && !text && "text-muted-foreground")}
      >
        {wholeChapter
          ? chapterTitle ?? "Reading every block in this chapter."
          : text || "Place your cursor in the manuscript."}
      </TypographyMuted>
    </div>
  );
}
