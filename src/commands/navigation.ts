// commands/navigation.ts - go to chapter, switch / open / close project.
//
// "Go to chapter" and "Switch project" are page-openers; their lists are produced
// by the providers below, read fresh from the project store when the page opens.
// Every state-wiping action routes through the view store's dirty-chapter guard so
// the "discard unsaved edits?" confirm still fires.

import { IconBook, IconFolder, IconFolderOpen, IconFolders } from "@tabler/icons-react";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import type { Command } from "./types";

const guard = (action: () => void) => useViewStore.getState().requestGuarded(action);

export const navigationCommands: Command[] = [
  {
    id: "nav.go-to-chapter",
    group: "Navigation",
    title: "Go to chapter...",
    icon: IconBook,
    page: "chapters",
    enabled: () => {
      const p = useProjectStore.getState().project;
      return p != null && p.chapters.length > 0;
    },
  },
  {
    id: "nav.switch-project",
    group: "Navigation",
    title: "Switch project...",
    icon: IconFolders,
    page: "projects",
    enabled: () => useProjectStore.getState().recents.length > 0,
  },
  {
    id: "nav.open-project",
    group: "Navigation",
    title: "Open project...",
    icon: IconFolderOpen,
    run: () => guard(() => void useProjectStore.getState().openProjectDialog()),
  },
  {
    id: "nav.close-project",
    group: "Navigation",
    title: "Close project",
    icon: IconFolder,
    enabled: () => useProjectStore.getState().project != null,
    run: () => guard(() => useProjectStore.getState().closeProject()),
  },
];

/** One command per chapter in the open project (or none if no project). */
export function chapterPage(): Command[] {
  const { project } = useProjectStore.getState();
  if (!project) return [];
  return project.chapters.map((c) => ({
    id: `nav.chapter.${c.id}`,
    group: "Navigation",
    title: c.title ? `${c.label} - ${c.title}` : c.label,
    run: () =>
      guard(() => {
        void useProjectStore.getState().selectChapter(c.id);
      }),
  }));
}

/** One command per recent project. */
export function projectPage(): Command[] {
  return useProjectStore.getState().recents.map((r) => ({
    id: `nav.project.${r.root}`,
    group: "Navigation",
    title: r.name,
    keywords: [r.root],
    run: () =>
      guard(() => {
        void useProjectStore.getState().loadProjectAt(r.root);
      }),
  }));
}
