// color-dot.tsx — a small colored dot/avatar for a character.
//
// Character colors are user data (arbitrary oklch strings), not design literals,
// so per CLAUDE.md the dynamic value is passed through a CSS variable rather than
// a literal-color inline style. One tiny component owns that escape hatch.

import { cn } from "@/lib/utils";

type ColorVar = React.CSSProperties & Record<"--dot", string>;

export function ColorDot({
  color,
  className,
}: {
  color: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-1.5 shrink-0 rounded-full bg-[var(--dot)]", className)}
      style={{ "--dot": color } as ColorVar}
    />
  );
}

export function ColorAvatar({
  color,
  initials,
  className,
}: {
  color: string;
  initials: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--dot)] font-serif text-xs font-medium text-white",
        className,
      )}
      style={{ "--dot": color } as ColorVar}
    >
      {initials}
    </span>
  );
}
