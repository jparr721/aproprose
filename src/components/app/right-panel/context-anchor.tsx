// context-anchor.tsx -- the "you are here" pill above every composer's input.

import { IconArrowDown } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { scrollBlockIntoView } from "@/components/app/editor";
import { useProjectStore } from "@/stores/project-store";
import { TypographyEyebrow, TypographyMuted } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

/** What grounding the anchor describes, per the page's scope:
 *  - `"cursor"`        the caret block: reads/acts up to it ("Continuing after X").
 *  - `"chapter"`       the whole chapter, caret irrelevant (Critique/Continuity/
 *                      Brainstorm/Edit wide scope).
 *  - `"chapter-insert"` reads the whole chapter but still inserts at the caret, so
 *                      it shows *both* the read scope and the insertion point (Suggest
 *                      wide scope). */
export type AnchorMode = "cursor" | "chapter" | "chapter-insert";

/** The "you are here": the grounding the AI operation anchors to. Sits just above
 *  the composer's text input. The caret-block text (and the Suggest insertion line)
 *  wrap over up to two lines so a longer tail reads naturally. `anchorId` overrides
 *  the live caret when a tab has frozen its anchor to a specific block (Suggest
 *  keeps a chapter-scope continuation pinned to the block it was generated against);
 *  it falls back to the live selection when absent. */
export function ContextAnchor({ mode, anchorId }: { mode: AnchorMode; anchorId?: string }) {
  const selectedId = useProjectStore((s) => s.selectedId);
  const blocks = useProjectStore((s) => s.blocks);
  const chapterTitle = useProjectStore((s) =>
    s.project?.chapters.find((c) => c.id === s.activeChapterId)?.title,
  );
  // The effective block backs the cursor anchor and the Suggest insertion point;
  // plain chapter scope ignores it entirely.
  const effectiveId = anchorId ?? selectedId;
  const block =
    mode !== "chapter" && effectiveId ? blocks.find((b) => b.id === effectiveId) : undefined;
  const text = block?.text.trim();

  // Eyebrow names the read scope in both chapter modes; the caret block otherwise.
  const eyebrow =
    mode === "cursor" ? (block ? `Continuing after ${block.type}` : "Cursor") : "Whole chapter";

  // Body: caret-block text in cursor mode; the chapter title in plain chapter mode
  // (caret irrelevant); the insertion point in chapter-insert mode (the whole chapter
  // is read, but the result still lands at the caret).
  let body: string;
  let dim = false;
  if (mode === "chapter") {
    body = chapterTitle ?? "Reading every block in this chapter.";
  } else if (mode === "chapter-insert") {
    body = block
      ? `Continues after ${block.type}${text ? ` - ${text}` : ""}`
      : "Continues at the end of the chapter.";
  } else {
    body = text || "Place your cursor in the manuscript.";
    dim = !text;
  }

  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-ai-tint/40 px-2.5 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <TypographyEyebrow className="text-ai-ink">{eyebrow}</TypographyEyebrow>
        {block && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Scroll to block in editor"
                onClick={() => scrollBlockIntoView(block.id)}
              >
                <IconArrowDown className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Go to block</TooltipContent>
          </Tooltip>
        )}
      </div>
      <TypographyMuted className={cn("line-clamp-2 text-xs", dim && "text-muted-foreground")}>
        {body}
      </TypographyMuted>
    </div>
  );
}
