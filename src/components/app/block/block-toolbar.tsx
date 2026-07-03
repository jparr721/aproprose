// block-toolbar.tsx -- the hover/selection action row floating above a block: the
// type/speaker chip, dictation mic, AI "suggest what comes next" spark, and the
// more-menu (move / insert / AI cleanup / delete).

import { toast } from "sonner";
import { IconDotsVertical, IconMicrophone, IconSparkles } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/stores/project-store";
import { dispatchAiIntent } from "@/stores/ai-intent-store";
import type { Block as BlockT, Character } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TypeChip } from "./type-chip";
import { BlockActionItems, type BlockAction } from "./block-actions";

export function BlockToolbar({
  block,
  characters,
  dictation,
  selected,
  actions,
}: {
  block: BlockT;
  characters: Character[];
  dictation: { supported: boolean; listening: boolean; toggle: () => void };
  selected: boolean;
  actions: BlockAction[][];
}) {
  const select = useProjectStore((s) => s.select);

  const onMic = () => {
    select(block.id);
    if (!dictation.supported) {
      toast.info("Dictation isn't available in this webview", {
        description: "Use your OS dictation shortcut — it types into the focused block.",
      });
      return;
    }
    dictation.toggle();
  };

  return (
    <div
      // Mounted only while hovered/selected (see Block); the mount fade gives
      // the same 150ms materialize as the grip, and the opacity gating handles
      // the mounted-but-idle case (menu just closed, pointer elsewhere).
      className={cn(
        "absolute right-2 -top-2 flex -translate-y-1/2 items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-sm",
        "animate-in fade-in-0 duration-150",
        "pointer-events-none opacity-0 transition-opacity duration-150",
        "group-hover:pointer-events-auto group-hover:opacity-100",
        "has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100",
        selected && "pointer-events-auto opacity-100",
      )}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <TypeChip block={block} characters={characters} />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dictate into this block"
            aria-pressed={dictation.listening && selected}
            className={cn(dictation.listening && selected && "text-destructive")}
            onClick={onMic}
          >
            <IconMicrophone className={cn(dictation.listening && selected && "animate-pulse")} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Dictate into this block</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Suggest what comes next here"
            onClick={() => {
              select(block.id);
              dispatchAiIntent({ tab: "suggest" });
            }}
          >
            <IconSparkles className="text-ai-ink" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Suggest what comes next here</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More actions">
                <IconDotsVertical />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>More actions</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-48">
          <BlockActionItems groups={actions} Item={DropdownMenuItem} Separator={DropdownMenuSeparator} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
