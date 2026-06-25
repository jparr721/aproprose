// commands/document.ts - save & build, undo, redo.

import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconPlayerPlayFilled,
} from "@tabler/icons-react";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import type { Command } from "./types";

export const documentCommands: Command[] = [
  {
    id: "doc.compile",
    group: "Document",
    title: "Save & build PDF",
    icon: IconPlayerPlayFilled,
    keybindingId: "SAVE_CHAPTER",
    keywords: ["compile", "build", "save"],
    enabled: () => useProjectStore.getState().compile.status !== "compiling",
    run: () => void useProjectStore.getState().compileNow(),
  },
  {
    id: "doc.build-errors",
    group: "Document",
    title: "View build errors",
    icon: IconAlertTriangle,
    keywords: ["build", "errors", "log", "compile", "failures"],
    enabled: () => useProjectStore.getState().compile.status === "error",
    run: () => useViewStore.getState().setBuildErrorsOpen(true),
  },
  {
    id: "doc.undo",
    group: "Document",
    title: "Undo",
    icon: IconArrowBackUp,
    keybindingId: "UNDO",
    run: () => useProjectStore.getState().undo(),
  },
  {
    id: "doc.redo",
    group: "Document",
    title: "Redo",
    icon: IconArrowForwardUp,
    keybindingId: "REDO",
    run: () => useProjectStore.getState().redo(),
  },
];
