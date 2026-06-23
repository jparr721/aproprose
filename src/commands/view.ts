// commands/view.ts - panel toggles and layout presets.
//
// The sidebar toggle is the one action that lives in React context (shadcn's
// SidebarProvider), so it arrives through CommandContext rather than a store.

import {
  IconColumns2,
  IconColumns3,
  IconFileText,
  IconLayoutSidebar,
  IconSparkles,
  IconViewfinder,
} from "@tabler/icons-react";
import { useSettingsStore } from "@/stores/settings-store";
import { useViewStore } from "@/stores/view-store";
import type { LayoutMode } from "@/lib/types";
import type { Command } from "./types";

const applyLayout = (preset: LayoutMode) => {
  useSettingsStore.getState().setLayout(preset);
  useViewStore.getState().applyLayoutPreset(preset);
};

export const viewCommands: Command[] = [
  {
    id: "view.toggle-sidebar",
    group: "View",
    title: "Toggle sidebar",
    icon: IconLayoutSidebar,
    run: (ctx) => ctx.toggleSidebar(),
  },
  {
    id: "view.toggle-pdf",
    group: "View",
    title: "Toggle PDF preview",
    icon: IconFileText,
    keybindingId: "TOGGLE_PDF",
    run: () => useViewStore.getState().togglePdf(),
  },
  {
    id: "view.toggle-ai",
    group: "View",
    title: "Toggle AI panel",
    icon: IconSparkles,
    keybindingId: "TOGGLE_AI",
    run: () => useViewStore.getState().toggleAi(),
  },
  {
    id: "view.layout-two",
    group: "View",
    title: "Layout: Editor + AI",
    icon: IconColumns2,
    keywords: ["2-pane", "two pane"],
    run: () => applyLayout("two"),
  },
  {
    id: "view.layout-three",
    group: "View",
    title: "Layout: Editor + AI + PDF",
    icon: IconColumns3,
    keywords: ["3-pane", "three pane"],
    run: () => applyLayout("three"),
  },
  {
    id: "view.layout-focus",
    group: "View",
    title: "Focus mode",
    icon: IconViewfinder,
    keywords: ["hide panels", "distraction free"],
    run: () => applyLayout("focus"),
  },
];
