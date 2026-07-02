// keybinding-hint.tsx — renders a shortcut as a single Kbd keycap with the
// glyphs spaced by the Kbd's flex gap, e.g. ⌃ ⇧ P. Pairs with the keybinding registry.

import { Kbd } from "@/components/ui/kbd";
import { keybindingParts, type KeybindingDefinition } from "@/lib/keybindings";
import { IS_MAC } from "@/lib/platform";

export function KeybindingHint({
  keybinding,
  className,
}: {
  keybinding: Pick<KeybindingDefinition, "key" | "modifiers">;
  className?: string;
}) {
  return (
    <Kbd className={className}>
      {keybindingParts(keybinding, IS_MAC).map((part) => (
        <span key={part}>{part}</span>
      ))}
    </Kbd>
  );
}
