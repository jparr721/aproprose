// commands/window.ts - native window controls via Tauri.
//
// Calls are .catch-guarded so the non-Tauri browser preview (`just dev`) doesn't
// throw unhandled rejections, matching window-controls.tsx.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconMinus, IconSquare, IconX } from "@tabler/icons-react";
import type { Command } from "./types";

export const windowCommands: Command[] = [
  {
    id: "window.minimize",
    group: "Window",
    title: "Minimize window",
    icon: IconMinus,
    run: () => void getCurrentWindow().minimize().catch(() => {}),
  },
  {
    id: "window.maximize",
    group: "Window",
    title: "Maximize or restore window",
    icon: IconSquare,
    keywords: ["fullscreen", "restore"],
    run: () => void getCurrentWindow().toggleMaximize().catch(() => {}),
  },
  {
    id: "window.close",
    group: "Window",
    title: "Close window",
    icon: IconX,
    run: () => void getCurrentWindow().close().catch(() => {}),
  },
];
