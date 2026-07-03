// keybinding-hint.tsx — renders a shortcut as a quiet run of glyphs (⌘⇧P) that
// inherits the host's text color at reduced strength. Deliberately chromeless:
// inside a button or a menu row, a boxed keycap reads as a second control and
// fights the label. Pairs with the keybinding registry.

import { keybindingParts, type KeybindingDefinition } from "@/lib/keybindings";
import { IS_MAC } from "@/lib/platform";
import { cn } from "@/lib/utils";

export function KeybindingHint({
  keybinding,
  className,
}: {
  keybinding: Pick<KeybindingDefinition, "key" | "modifiers">;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "pointer-events-none select-none font-sans text-[11px] font-medium tracking-[0.08em] opacity-55",
        className,
      )}
    >
      {keybindingParts(keybinding, IS_MAC).join("")}
    </kbd>
  );
}
