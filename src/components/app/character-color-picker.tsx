// character-color-picker.tsx — a preset shade grid plus the browser's native
// color picker for mixing arbitrary colors.
//
// Character colors are plain CSS color strings (hex). Presets give quick,
// perceptually-even shades; the native <input type="color"> opens the OS color
// panel (draggable wheel / sliders / eyedropper) for anything else.

import { ColorDot } from "@/components/app/color-dot";
import { TypographySmall } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

// Hue families x lightness shades, ordered shade-major so the grid reads as rows
// of light -> deep across a rainbow of hues. Derived from an even OKLCH ramp.
export const CHARACTER_COLORS = [
  "#e18881", "#d7935a", "#baa44d", "#7fb673", "#43bba7", "#3db6cf", "#74a7e8", "#a498e5", "#cc8bc5",
  "#bb5752", "#b16512", "#937800", "#4d8c3e", "#00927d", "#008caa", "#407bc5", "#7a6bc1", "#a45b9f",
  "#873f3b", "#804810", "#6a5600", "#37652d", "#00695a", "#00657b", "#2e598f", "#584d8c", "#774272",
];

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
