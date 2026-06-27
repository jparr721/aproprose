import { TypographyForeground, TypographyMuted } from "@/components/ui/typography";
import { KeybindingHint } from "@/components/app/keybinding-hint";
import { Field } from "@/components/app/settings/field";
import { KEYBINDINGS } from "@/lib/keybindings";

export function KeyboardTab() {
  return (
    <Field label="Keyboard">
      <div className="flex flex-col gap-2">
        {Object.values(KEYBINDINGS).map((kb) => (
          <div key={kb.id} className="flex items-center justify-between gap-3">
            <TypographyForeground className="font-sans text-sm">{kb.label}</TypographyForeground>
            <KeybindingHint keybinding={kb} />
          </div>
        ))}
      </div>
      <TypographyMuted className="mt-1 font-sans text-xs">
        Highlight text in a block to convert or isolate the selection.
      </TypographyMuted>
    </Field>
  );
}
