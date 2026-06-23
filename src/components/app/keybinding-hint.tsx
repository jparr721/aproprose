// keybinding-hint.tsx — renders a shortcut as a KbdGroup of per-key Kbd glyphs
// joined by "+", e.g. ⌃ + ⇧ + P. Pairs with the keybinding registry.

import { Fragment } from "react";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { keybindingParts, type KeybindingDefinition } from "@/lib/keybindings";
import { IS_MAC } from "@/lib/platform";

export function KeybindingHint({
  keybinding,
  className,
}: {
  keybinding: Pick<KeybindingDefinition, "key" | "modifiers">;
  className?: string;
}) {
  const parts = keybindingParts(keybinding, IS_MAC);
  return (
    <KbdGroup className={className}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? <span aria-hidden>+</span> : null}
          <Kbd>{part}</Kbd>
        </Fragment>
      ))}
    </KbdGroup>
  );
}
