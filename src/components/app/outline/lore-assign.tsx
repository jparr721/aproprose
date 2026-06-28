// lore-assign.tsx — lore assignment control for cards.
//
// Mirrors character-assign.tsx: assigned entries render as removable LoreChips;
// the "+ Lore" menu toggles membership (staying open across toggles).

import { IconBook, IconPlus } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { LoreChip } from "@/components/app/outline/lore-chip";
import { useProjectStore } from "@/stores/project-store";

export function LoreAssign(props: {
  assignedIds: string[];
  onAdd: (loreId: string) => void;
  onRemove: (loreId: string) => void;
}) {
  const { assignedIds, onAdd, onRemove } = props;
  const lore = useProjectStore((s) => s.meta.lore);
  const assigned = new Set(assignedIds);
  const entries = assignedIds
    .map((id) => lore.find((l) => l.id === id))
    .filter((l): l is NonNullable<typeof l> => Boolean(l));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {entries.map((l) => (
        <LoreChip key={l.id} title={l.title} onRemove={() => onRemove(l.id)} />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost">
            <IconPlus className="size-4" /> Lore
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-faint">Lore</DropdownMenuLabel>
          {lore.map((l) => (
            <DropdownMenuCheckboxItem
              key={l.id}
              checked={assigned.has(l.id)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(next) => (next ? onAdd(l.id) : onRemove(l.id))}
            >
              <IconBook className="size-3.5 text-lore-ink" />
              <span className="flex-1">{l.title}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}