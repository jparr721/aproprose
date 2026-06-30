// block-toolbar.tsx — the hover/selection action row floating above a block: the
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
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
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
  const triggerSuggest = useViewStore((s) => s.triggerSuggest);

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
      className={cn(
        "absolute right-2 -top-2 hidden -translate-y-1/2 items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-sm",
        "group-hover:flex has-[[data-state=open]]:flex",
        selected && "flex",
      )}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <TypeChip block={block} characters={characters} />
      <Button
        variant="ghost"
        size="icon-sm"
        title="Dictate into this block"
        aria-pressed={dictation.listening && selected}
        className={cn(dictation.listening && selected && "text-destructive")}
        onClick={onMic}
      >
        <IconMicrophone className={cn(dictation.listening && selected && "animate-pulse")} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        title="Suggest what comes next here"
        onClick={() => {
          select(block.id);
          triggerSuggest();
        }}
      >
        <IconSparkles className="text-ai-ink" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" title="More">
            <IconDotsVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <BlockActionItems groups={actions} Item={DropdownMenuItem} Separator={DropdownMenuSeparator} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
