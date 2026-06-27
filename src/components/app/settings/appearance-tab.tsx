import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Separator } from "@/components/ui/separator";
import { TypographyMuted } from "@/components/ui/typography";
import { Field } from "@/components/app/settings/field";
import { useSettingsStore } from "@/stores/settings-store";
import { useViewStore } from "@/stores/view-store";
import type { BlockStyle, LayoutMode, Theme } from "@/lib/types";

export function AppearanceTab() {
  const theme = useSettingsStore((s) => s.theme);
  const layout = useSettingsStore((s) => s.layout);
  const blockStyle = useSettingsStore((s) => s.blockStyle);
  const proseSize = useSettingsStore((s) => s.proseSize);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setLayout = useSettingsStore((s) => s.setLayout);
  const setBlockStyle = useSettingsStore((s) => s.setBlockStyle);
  const setProseSize = useSettingsStore((s) => s.setProseSize);
  const applyLayoutPreset = useViewStore((s) => s.applyLayoutPreset);

  return (
    <div className="flex flex-col gap-6">
      <Field label="Color">
        <ToggleGroup
          type="single"
          value={theme}
          onValueChange={(v) => v && setTheme(v as Theme)}
          variant="outline"
          className="w-full"
        >
          <ToggleGroupItem value="light" className="flex-1">Light</ToggleGroupItem>
          <ToggleGroupItem value="sepia" className="flex-1">Sepia</ToggleGroupItem>
          <ToggleGroupItem value="dark" className="flex-1">Dark</ToggleGroupItem>
        </ToggleGroup>
      </Field>

      <Field label="Layout">
        <ToggleGroup
          type="single"
          value={layout}
          onValueChange={(v) => {
            if (!v) return;
            setLayout(v as LayoutMode);
            applyLayoutPreset(v as LayoutMode);
          }}
          variant="outline"
          className="w-full"
        >
          <ToggleGroupItem value="two" className="flex-1">2-pane</ToggleGroupItem>
          <ToggleGroupItem value="three" className="flex-1">3-pane</ToggleGroupItem>
          <ToggleGroupItem value="focus" className="flex-1">Focus</ToggleGroupItem>
        </ToggleGroup>
        <TypographyMuted className="text-xs">
          2-pane shows the AI panel · 3-pane adds the PDF · Focus hides both.
        </TypographyMuted>
      </Field>

      <Separator />

      <Field label="Block style">
        <ToggleGroup
          type="single"
          value={blockStyle}
          onValueChange={(v) => v && setBlockStyle(v as BlockStyle)}
          variant="outline"
          className="w-full"
        >
          <ToggleGroupItem value="typo" className="flex-1">Typographic</ToggleGroupItem>
          <ToggleGroupItem value="cards" className="flex-1">Cards</ToggleGroupItem>
        </ToggleGroup>
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
