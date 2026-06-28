import { IconX } from "@tabler/icons-react";
import { ColorDot } from "@/components/app/color-dot";
import { cn } from "@/lib/utils";

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
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-foreground",
        props.className,
      )}
    >
      <ColorDot color={props.color} />
      {props.name}
      {props.onRemove ? (
        <button
          type="button"
          onClick={props.onRemove}
          className="text-muted-foreground hover:text-foreground"
        >
          <IconX className="size-3" />
        </button>
      ) : null}
    </span>
  );
}
