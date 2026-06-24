// commands/document.ts - save & build, undo, redo.

import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconPlayerPlayFilled,
} from "@tabler/icons-react";
import { useProjectStore } from "@/stores/project-store";
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
