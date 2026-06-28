import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Field } from "@/components/app/settings/field";
import { useSettingsStore } from "@/stores/settings-store";
import type { BlockStyle, Theme } from "@/lib/types";

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "sepia", label: "Sepia" },
  { value: "dark", label: "Dark" },
];

const BLOCK_STYLES: { value: BlockStyle; label: string }[] = [
  { value: "typo", label: "Typographic" },
  { value: "cards", label: "Cards" },
];

export function AppearanceTab() {
  const theme = useSettingsStore((s) => s.theme);
  const blockStyle = useSettingsStore((s) => s.blockStyle);
  const proseSize = useSettingsStore((s) => s.proseSize);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setBlockStyle = useSettingsStore((s) => s.setBlockStyle);
  const setProseSize = useSettingsStore((s) => s.setProseSize);

  return (
    <div className="flex flex-col gap-6">
      <Field label="Color">
        <ButtonGroup>
          {THEMES.map((t) => (
            <Button
              key={t.value}
              variant={theme === t.value ? "default" : "outline"}
              onClick={() => setTheme(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </ButtonGroup>
      </Field>

      <Separator />

      <Field label="Block style">
        <ButtonGroup>
          {BLOCK_STYLES.map((b) => (
            <Button
              key={b.value}
              variant={blockStyle === b.value ? "default" : "outline"}
              onClick={() => setBlockStyle(b.value)}
            >
              {b.label}
            </Button>
          ))}
        </ButtonGroup>
      </Field>

      <Field label="Prose size" hint={`${proseSize}px`}>
        <Slider
          min={14}
          max={22}
          step={0.5}
          value={[proseSize]}
          onValueChange={([v]) => setProseSize(v)}
        />
      </Field>
    </div>
  );
}
