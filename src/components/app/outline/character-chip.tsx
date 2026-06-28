import { IconX } from "@tabler/icons-react";
import { ColorDot } from "@/components/app/color-dot";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** A character as a name + color dot chip. The dynamic color is delegated to
 *  ColorDot, which owns the CSS-variable escape hatch for dynamic oklch colors. */
export function CharacterChip(props: {
  name: string;
  color: string;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border border-border bg-muted/40 px-1 py-0.5 text-xs text-foreground",
        props.className,
      )}
    >
      <ColorDot color={props.color} />
      {props.name}
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
