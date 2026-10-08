import { useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "@/App";
import { AppSidebar } from "@/components/app/app-sidebar";
import { TopBar } from "@/components/app/top-bar";
import { ThemeController } from "@/components/app/theme-controller";
import { AppearanceTab } from "@/components/app/settings/appearance-tab";
import { AiTab } from "@/components/app/settings/ai-tab";
import { StatsTab } from "@/components/app/settings/stats-tab";
import { BackupScheduleFields } from "@/components/app/backup-schedule-fields";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { parseChapter } from "@/lib/latex";
import { EMPTY_META } from "@/lib/migration";
import type { ProjectInfo, Theme } from "@/lib/types";
import { EMPTY_AGENT_STATE, useAgentConsoleStore } from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import { useSearchSurfaceStore } from "@/stores/search-surface-store";
import { useSettingsStore } from "@/stores/settings-store";
import "@/index.css";

const project: ProjectInfo = {
  root: "/workshop/harbor", name: "The Harbor", mainFile: "main.tex",
  title: "The Harbor", author: "Workshop Author",
  metadata: { title: "The Harbor", subtitle: "", author: "Workshop Author", publisher: "", isbn: "" },
  chapters: [{ id: "first", label: "1", title: "The Crossing", file: "content/first.tex", wordCount: 18 }],
};
const blocks = parseChapter("The harbor was quiet when Mara arrived.\n\nShe waited beside the gate, listening for the morning bell.\n");
useProjectStore.setState({ status: "ready", project, meta: structuredClone(EMPTY_META), activeChapterId: "first", blocks, selectedId: null, selectedIds: [], chapterDirty: false, past: [], future: [] });
useAgentConsoleStore.setState({ ...EMPTY_AGENT_STATE, requestedProjectRoot: project.root, activeProjectRoot: project.root, hydratedProjectRoot: project.root });
useViewStore.setState({ aiOpen: true, pdfOpen: true, outlineOpen: false, focus: false, rightPanelWidth: 320 });

interface WorkshopApi {
  setPanels: (panels: { aiOpen: boolean; pdfOpen: boolean; outlineOpen: boolean; focus: boolean }) => void;
  setTheme: (theme: Theme) => void;
  openFind: (surface: "editor" | "pdf") => void;
  editManuscript: () => void;
  manuscriptText: () => string;
  setAgentFailure: (kind: "load" | "corrupt" | "save") => void;
}
declare global { interface Window { workshop: WorkshopApi } }
window.workshop = {
  setPanels: (panels) => useViewStore.setState(panels),
  setTheme: (theme) => useSettingsStore.getState().setTheme(theme),
  openFind: (surface) => {
    useSearchSurfaceStore.getState().activate(surface);
    useSearchSurfaceStore.getState().openActive();
  },
  editManuscript: () => useProjectStore.getState().updateBlockText(blocks[0].id, "Edited manuscript"),
  manuscriptText: () => useProjectStore.getState().blocks[0].text,
  setAgentFailure: (kind) => useAgentConsoleStore.setState({
    hydratedProjectRoot: kind === "save" ? project.root : null,
    persistenceIssue: { kind, projectRoot: project.root, message: "Workshop storage denied" },
  }),
};

function Schedule(): ReactNode {
  const [autoSync, setAutoSync] = useState(true);
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  return <BackupScheduleFields available={true} autoSync={autoSync} intervalMinutes={intervalMinutes} onAutoSyncChange={setAutoSync} onIntervalChange={setIntervalMinutes} />;
}
function Workshop(): ReactNode {
  const surface = new URLSearchParams(location.search).get("surface");
  return <TooltipProvider><ThemeController /><Toaster />{surface === "settings" ? (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-6"><AppearanceTab /><AiTab /><Schedule /><StatsTab /></main>
  ) : (
    <SidebarProvider className="h-svh min-h-0"><AppSidebar /><SidebarInset className="min-h-0 min-w-0 overflow-hidden"><TopBar /><Workspace /></SidebarInset></SidebarProvider>
  )}</TooltipProvider>;
}
const root = document.getElementById("root");
if (root === null) throw new Error("Workshop root is missing");
createRoot(root).render(<Workshop />);
