// App.tsx - the workspace shell.
//
// Empty state -> Welcome (open/recent). Project open -> a Sidebar + top bar + a
// resizable editor / PDF / AI split. Focus mode hides the PDF and AI panels; the
// sidebar is independent (toggled by its own trigger / Cmd+B). The unsaved-edits
// confirm dialog is mounted once here, driven by the view store's guard.
//
// Keyboard shortcuts are not wired here: each lives with the component that owns
// its action (top bar: compile / panel toggles; editor: save / undo / redo) via
// the `useKeybinding` hook and the `src/lib/keybindings.ts` registry.

import { notifyAppError } from "@/lib/notifications";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { ThemeController } from "@/components/app/theme-controller";
import { TopBar } from "@/components/app/top-bar";
import { AppSidebar } from "@/components/app/app-sidebar";
import { CommandPalette } from "@/components/app/command-palette";
import { SettingsDialog } from "@/components/app/settings-dialog";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Editor } from "@/components/app/editor";
import { SearchCoordinator } from "@/components/app/search-coordinator";
import { OutlinePane } from "@/components/app/outline/outline-pane";
import { PdfPane } from "@/components/app/pdf-pane";
import { AgentConsole } from "@/components/app/agent-console/agent-console";
import { ChangesPanel } from "@/components/app/changes-panel";
import { Welcome } from "@/components/app/welcome";
import { UpdateChecker } from "@/components/app/update-checker";
import { WhatsNewDialog } from "@/components/app/whats-new-dialog";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import { useAgentPersistence } from "@/stores/agent-persistence";
import { cn } from "@/lib/utils";
import { saveBeforeExit } from "@/lib/exit-guard";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

export function Workspace() {
  const aiOpen = useViewStore((s) => s.aiOpen);
  const changesOpen = useViewStore((s) => s.changesOpen);
  const pdfOpen = useViewStore((s) => s.pdfOpen);
  const focus = useViewStore((s) => s.focus);
  const outlineOpen = useViewStore((s) => s.outlineOpen);
  const rightPanelWidth = useViewStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useViewStore((s) => s.setRightPanelWidth);

  const showOutline = outlineOpen && !focus;
  const showPdf = pdfOpen && !focus && !showOutline;
  const showAi = aiOpen && !focus;
  const showChanges = changesOpen && !focus;
  const showRight = showAi || showChanges;
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = (): void => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // Track the live px width during a drag in a ref (no re-render); persist it to
  // the store only on pointer release (the group's onLayoutChanged) so we don't
  // write to the Tauri-backed store on every frame of the drag.
  const liveWidth = useRef(rightPanelWidth);
  const rightPanel = useRef<PanelImperativeHandle>(null);
  const previousShowRight = useRef(showRight);

  useLayoutEffect(() => {
    if (previousShowRight.current === showRight) return;
    previousShowRight.current = showRight;
    if (showRight) rightPanel.current?.resize(rightPanelWidth);
    else rightPanel.current?.collapse();
  }, [showRight, rightPanelWidth]);

  // The editor + PDF stay mounted in the `main` panel across every AI toggle, so
  // collapsing/expanding the right panel never remounts (and resets) the editor.
  const main = (
    <div className="flex h-full min-h-0 min-w-0 flex-col @min-[720px]/workspace:flex-row">
      <div className={cn("min-h-0 min-w-0 flex-1", showOutline && "hidden")}>
        <Editor />
      </div>
      {showOutline ? (
        <div className="min-h-0 min-w-0 flex-1">
          <OutlinePane />
        </div>
      ) : null}
      {showPdf ? (
        <div className="min-h-0 min-w-0 flex-1 border-t border-border @min-[720px]/workspace:border-l @min-[720px]/workspace:border-t-0">
          <PdfPane />
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <SearchCoordinator pdfAvailable={showPdf} />
      <div className="relative flex min-h-0 flex-1">
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-w-0 flex-1 [&>[data-panel]]:transition-[flex-grow] [&>[data-panel]]:duration-250 [&>[data-panel]]:ease-in-out motion-reduce:[&>[data-panel]]:transition-none [&:has([data-separator=active])>[data-panel]]:transition-none"
          onLayoutChanged={(layout) => {
            if (!showRight || narrow) return;
            if (layout.right === 0) {
              useViewStore.getState().setAiOpen(false);
              useViewStore.getState().setChangesOpen(false);
            } else setRightPanelWidth(Math.round(liveWidth.current));
          }}
        >
          <ResizablePanel id="main" minSize={360} className="@container/workspace" inert={narrow && showRight} aria-hidden={narrow && showRight}>
            {main}
          </ResizablePanel>
          <ResizableHandle
            withHandle
            disabled={!showRight || narrow}
            className={cn("max-lg:hidden", !showRight && "invisible w-0")}
          />
          <ResizablePanel
            id="right"
            panelRef={rightPanel}
            aria-hidden={!showRight}
            inert={!showRight}
            className={cn(
              "overflow-hidden! max-lg:absolute! max-lg:inset-0 max-lg:z-20 max-lg:w-full! max-lg:min-w-0! max-lg:max-w-none! max-lg:flex-none!",
              !showRight && "max-lg:hidden",
            )}
            defaultSize={showRight ? rightPanelWidth : 0}
            collapsible
            minSize={320}
            maxSize={640}
            groupResizeBehavior="preserve-pixel-size"
            onResize={(size) => {
              if (showRight && !narrow && size.inPixels >= 320) liveWidth.current = size.inPixels;
            }}
          >
            <div className="h-full min-w-0 border-l border-border bg-background">
              <div className={cn("h-full", !showAi && "hidden")} inert={!showAi} aria-hidden={!showAi}>
                <AgentConsole />
              </div>
              <div className={cn("h-full", !showChanges && "hidden")} inert={!showChanges} aria-hidden={!showChanges}>
                <ChangesPanel />
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </>
  );
}

function UnsavedGuard() {
  const remoteDivergence = useProjectStore((s) => s.remoteDivergence);
  const pending = useViewStore((s) => s.pending);
  const confirm = useViewStore((s) => s.confirmPending);
  const cancel = useViewStore((s) => s.cancelPending);
  return (
    <AlertDialog open={pending != null} onOpenChange={(o) => !o && cancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>
            {remoteDivergence === null
              ? "This chapter has edits that haven't been saved to disk. Continuing will discard them."
              : "Backup pulled changes while this project was open. Continuing discards the preserved draft and opens the files from disk."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={confirm}>Discard &amp; continue</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ProcessExitGuard(): null {
  const saving = useRef(false);

  useEffect(() => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onCloseRequested(async (event) => {
      const projectState = useProjectStore.getState();
      if (!projectState.chapterDirty && projectState.remoteDivergence === null) return;
      event.preventDefault();
      if (saving.current) return;
      saving.current = true;
      try {
        const owner = useProjectStore.getState();
        const safeToExit = await saveBeforeExit({
          hasUnsavedChanges: () => {
            const current = useProjectStore.getState();
            return current.chapterDirty || current.remoteDivergence !== null;
          },
          saveChanges: () => useProjectStore.getState().saveChapter(),
          isCurrent: () => {
            const current = useProjectStore.getState();
            return current.lifecycleGeneration === owner.lifecycleGeneration &&
              current.activeChapterId === owner.activeChapterId &&
              current.editRevision === owner.editRevision;
          },
        });
        if (safeToExit) void appWindow.close();
        else notifyAppError("chapter-save", "Editor", useProjectStore.getState().project?.root ?? null, new Error("Close canceled: unsaved changes"));
      } catch (error) {
        notifyAppError("chapter-save", "Editor", useProjectStore.getState().project?.root ?? null, error);
      } finally {
        saving.current = false;
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  return null;
}

function MigrationGuard() {
  const needsMigration = useProjectStore((s) => s.needsMigration);
  const migrate = useProjectStore((s) => s.migrateProject);
  const cancel = useProjectStore((s) => s.cancelMigration);
  return (
    <AlertDialog
      open={needsMigration != null}
      onOpenChange={(o) => !o && cancel()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Convert to managed structure?</AlertDialogTitle>
          <AlertDialogDescription>
            This project uses an older layout. Aproprose can convert it (found{" "}
            {needsMigration?.detectedChapters ?? 0} chapters): metadata and the
            chapter list move into <code>metadata.tex</code> / <code>chapters.tex</code>,
            and <code>main.tex</code> is backed up to <code>main.tex.bak</code>. Your
            chapter files are left untouched.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <AlertDialogAction onClick={() => void migrate()}>Convert</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function App() {
  useAgentPersistence();
  const status = useProjectStore((s) => s.status);

  return (
    <TooltipProvider>
      <ThemeController />
      {status === "ready" ? (
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset className="h-svh min-w-0 bg-background">
            <TopBar />
            <Workspace />
          </SidebarInset>
          <CommandPalette />
        </SidebarProvider>
      ) : (
        <Welcome />
      )}
      <SettingsDialog />
      <UnsavedGuard />
      <MigrationGuard />
      <UpdateChecker />
      <ProcessExitGuard />
      <WhatsNewDialog />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}

export default App;
