// character-assign.tsx -- cast assignment control.
//
// Assigned members render as removable chips; the "+ Character" menu toggles
// membership (staying open across toggles) and offers an inline "Add character"
// escape hatch. Shared by the chapter block and each plot-element card in the
// chapter subview, so both assign cast the same way the editor assigns speakers.

import { useState } from "react";
import { IconPlus, IconUserPlus } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ColorDot } from "@/components/app/color-dot";
import { CharacterChip } from "@/components/app/outline/character-chip";
import { AddCharacterDialog } from "@/components/app/add-character-dialog";
import { useProjectStore } from "@/stores/project-store";

export function CharacterAssign(props: {
  assignedIds: string[];
  onAdd: (characterId: string) => void;
  onRemove: (characterId: string) => void;
}) {
  const { assignedIds, onAdd, onRemove } = props;
  const characters = useProjectStore((s) => s.meta.characters);
  const [addOpen, setAddOpen] = useState(false);
  const assigned = new Set(assignedIds);
  const cast = assignedIds
    .map((id) => characters.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {cast.map((c) => (
        <CharacterChip key={c.id} name={c.name} color={c.color} onRemove={() => onRemove(c.id)} />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost">
            <IconPlus className="size-4" /> Character
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-faint">Cast</DropdownMenuLabel>
          {characters.map((c) => (
            <DropdownMenuCheckboxItem
              key={c.id}
              checked={assigned.has(c.id)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(next) => (next ? onAdd(c.id) : onRemove(c.id))}
            >
              <ColorDot color={c.color} />
              <span className="flex-1">{c.name}</span>
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAddOpen(true)}>
            <IconUserPlus />
            <span className="flex-1">Add character</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddCharacterDialog open={addOpen} onOpenChange={setAddOpen} onAdded={onAdd} />
    </div>
  );
}
