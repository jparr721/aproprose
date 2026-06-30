// type-chip.tsx — the block's type/speaker chip: switch block type, or pick the
// speaker (and add a new character) for dialogue.

import { useState } from "react";
import { IconChevronDown, IconCheck, IconUserPlus } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ColorDot } from "@/components/app/color-dot";
import { AddCharacterDialog } from "@/components/app/add-character-dialog";
import { useProjectStore } from "@/stores/project-store";
import type { Block as BlockT, BlockType, Character } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TYPE_LABELS, TYPE_SWATCH } from "./constants";
import { findSpeaker } from "./block-text";

export function TypeChip({
  block,
  characters,
}: {
  block: BlockT;
  characters: Character[];
}) {
  const changeType = useProjectStore((s) => s.changeType);
  const changeSpeaker = useProjectStore((s) => s.changeSpeaker);
  const [addOpen, setAddOpen] = useState(false);
  const speaker = findSpeaker(block, characters);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="xs" className="gap-1 text-muted-foreground">
            {speaker ? <ColorDot color={speaker.color} /> : null}
            {speaker ? speaker.name : TYPE_LABELS[block.type]}
            <IconChevronDown className="size-2.5 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {block.type === "dialogue" ? (
            <>
              <DropdownMenuLabel className="text-faint">Speaker</DropdownMenuLabel>
              {characters.map((c) => (
                <DropdownMenuItem key={c.id} onSelect={() => changeSpeaker(block.id, c.id)}>
                  <ColorDot color={c.color} />
                  <span className="flex-1">{c.name}</span>
                  <span className="text-xs text-faint">{c.role}</span>
                  {block.speaker === c.id ? <IconCheck className="size-4 text-accent-ink" /> : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onSelect={() => setAddOpen(true)}>
                <IconUserPlus />
                <span className="flex-1">Add character</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuLabel className="text-faint">Block type</DropdownMenuLabel>
          {(Object.keys(TYPE_LABELS) as BlockType[]).map((t) => (
            <DropdownMenuItem key={t} onSelect={() => changeType(block.id, t)}>
              <span className={cn("size-2 rounded-[2px]", TYPE_SWATCH[t])} />
              <span className="flex-1">{TYPE_LABELS[t]}</span>
              {block.type === t ? <IconCheck className="size-4 text-accent-ink" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Rendered outside the menu so closing the dropdown doesn't unmount it. */}
      <AddCharacterDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={(id) => changeSpeaker(block.id, id)}
      />
    </>
  );
}
