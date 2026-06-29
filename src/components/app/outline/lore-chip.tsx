// lore-chip.tsx — a lore entry as a tinted chip with an optional remove button.
//
// Mirrors character-chip.tsx but uses lore-tint colors and an IconBook prefix.

import { IconBook, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function LoreChip(props: {
  title: string;
  onRemove?: () => void;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border border-border bg-lore-tint px-1 py-0.5 text-xs text-lore-ink",
        props.onClick && "cursor-pointer",
        props.className,
      )}
      onClick={props.onClick ? (e: React.MouseEvent) => { e.stopPropagation(); props.onClick?.(); } : undefined}
    >
      <IconBook className="size-3" />
      {props.title}
      {props.onRemove ? (
        <Button
          onClick={props.onRemove}
          variant="ghost"
        >
          <IconX className="size-2" />
        </Button>
      ) : null}
    </span>
  );
}