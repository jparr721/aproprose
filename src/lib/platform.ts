// platform.ts — OS detection for platform-adaptive chrome (titlebar controls,
// macOS traffic-light inset). platform() from the OS plugin is synchronous in
// Tauri v2, but throws outside the Tauri runtime (e.g. `just dev` browser
// preview); default to non-macOS there.

import { platform } from "@tauri-apps/plugin-os";

function detect(): string {
  try {
    return platform();
  } catch {
    return "linux";
  }
}

export const IS_MAC = detect() === "macos";
