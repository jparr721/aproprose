// commands/settings.ts - open settings, theme, block style, prose size.

import {
  IconCards,
  IconLetterCase,
  IconMoon,
  IconSettings,
  IconSun,
  IconSunMoon,
  IconTextDecrease,
  IconTextIncrease,
} from "@tabler/icons-react";
import { useSettingsStore } from "@/stores/settings-store";
import { useSettingsDialogStore } from "@/stores/settings-dialog-store";
import type { Command } from "./types";

const PROSE_MIN = 14;
const PROSE_MAX = 22;
const PROSE_STEP = 1;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const stepProse = (dir: 1 | -1) => {
  const s = useSettingsStore.getState();
  s.setProseSize(clamp(s.proseSize + dir * PROSE_STEP, PROSE_MIN, PROSE_MAX));
};

export const settingsCommands: Command[] = [
  {
    id: "settings.open",
    group: "Settings",
    title: "Open settings",
    icon: IconSettings,
    keywords: ["preferences", "tweaks"],
    run: () => useSettingsDialogStore.getState().setOpen(true),
  },
  {
    id: "settings.theme-light",
    group: "Settings",
    title: "Theme: Light",
    icon: IconSun,
    keywords: ["light mode"],
    run: () => useSettingsStore.getState().setTheme("light"),
  },
  {
    id: "settings.theme-sepia",
    group: "Settings",
    title: "Theme: Sepia",
    icon: IconSunMoon,
    keywords: ["paper", "warm"],
    run: () => useSettingsStore.getState().setTheme("sepia"),
  },
  {
    id: "settings.theme-dark",
    group: "Settings",
    title: "Theme: Dark",
    icon: IconMoon,
    keywords: ["dark mode", "night"],
    run: () => useSettingsStore.getState().setTheme("dark"),
  },
  {
    id: "settings.block-typo",
    group: "Settings",
    title: "Block style: Typographic",
    icon: IconLetterCase,
    run: () => useSettingsStore.getState().setBlockStyle("typo"),
  },
  {
    id: "settings.block-cards",
    group: "Settings",
    title: "Block style: Cards",
    icon: IconCards,
    run: () => useSettingsStore.getState().setBlockStyle("cards"),
  },
  {
    id: "settings.prose-larger",
    group: "Settings",
    title: "Prose size: Larger",
    icon: IconTextIncrease,
    keywords: ["font size", "increase", "bigger"],
    run: () => stepProse(1),
  },
  {
    id: "settings.prose-smaller",
    group: "Settings",
    title: "Prose size: Smaller",
    icon: IconTextDecrease,
    keywords: ["font size", "decrease", "smaller"],
    run: () => stepProse(-1),
  },
];
