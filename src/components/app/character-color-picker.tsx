// character-color-picker.tsx — a preset shade grid plus the browser's native
// color picker for mixing arbitrary colors.
//
// Character colors are plain CSS color strings (hex). Presets give quick,
// perceptually-even shades; the native <input type="color"> opens the OS color
// panel (draggable wheel / sliders / eyedropper) for anything else.

import { ColorDot } from "@/components/app/color-dot";
import { TypographySmall } from "@/components/ui/typography";
import { CHARACTER_COLORS } from "@/lib/characters/colors";
import { cn } from "@/lib/utils";

export { CHARACTER_COLORS } from "@/lib/characters/colors";

export function CharacterColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const isPreset = CHARACTER_COLORS.includes(value);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-9 gap-1.5">
        {CHARACTER_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label="color"
            aria-pressed={c === value}
            onClick={() => onChange(c)}
            className={cn(
              "size-6 rounded-full ring-offset-2 ring-offset-background transition-shadow",
              c === value && "ring-2 ring-ring",
            )}
          >
            <ColorDot color={c} className="size-6" />
          </button>
        ))}
      </div>
      <label className="flex w-fit cursor-pointer items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          aria-label="Custom color"
          className={cn(
            "size-6 cursor-pointer appearance-none rounded-full border-0 bg-transparent p-0 ring-offset-2 ring-offset-background",
            "[&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0",
            !isPreset && "ring-2 ring-ring",
          )}
        />
        <TypographySmall className="text-muted-foreground">Custom color</TypographySmall>
      </label>
    </div>
  );
}
