// App.tsx — the workspace shell.
//
// Empty state -> Welcome (open/recent). Project open -> a Sidebar + top bar + a
// resizable editor / PDF / AI split. Focus mode hides the PDF and AI panels; the
// sidebar is independent (toggled by its own trigger / ⌘B). The unsaved-edits
// confirm dialog is mounted once here, driven by the view store's guard.
//
// Keyboard shortcuts are not wired here: each lives with the component that owns
// its action (top bar: compile / panel toggles; editor: save / undo / redo) via
// the `useKeybinding` hook and the `src/lib/keybindings.ts` registry.

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
import { OutlinePane } from "@/components/app/outline/outline-pane";
import { PdfPane } from "@/components/app/pdf-pane";
import { RightPanelContent, RightPanelRail } from "@/components/app/right-panel";
import { Welcome } from "@/components/app/welcome";
import { UpdateChecker } from "@/components/app/update-checker";
import { WhatsNewDialog } from "@/components/app/whats-new-dialog";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import { useAiPersistence } from "@/stores/ai-persistence";
import { cn } from "@/lib/utils";
import { useRef } from "react";

function Workspace() {
  const aiOpen = useViewStore((s) => s.aiOpen);
  const pdfOpen = useViewStore((s) => s.pdfOpen);
  const focus = useViewStore((s) => s.focus);
  const outlineOpen = useViewStore((s) => s.outlineOpen);
  const collapsed = useViewStore((s) => s.aiCollapsed);
  const rightPanelWidth = useViewStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useViewStore((s) => s.setRightPanelWidth);

  const showOutline = outlineOpen && !focus;
  const showPdf = pdfOpen && !focus && !showOutline;
  const showAi = aiOpen && !focus;
  const showContent = showAi && !collapsed;

  // Track the live px width during a drag in a ref (no re-render); persist it to
  // the store only on pointer release (the group's onLayoutChanged) so we don't
  // write to the Tauri-backed store on every frame of the drag.
  const liveWidth = useRef(rightPanelWidth);

  // The editor + PDF stay mounted in the `main` panel across every AI toggle, so
  // collapsing/expanding the right panel never remounts (and resets) the editor.
  const main = (
    <div className="flex h-full min-w-0">
      <div className={cn("min-w-0 flex-1", showOutline && "hidden")}>
        <Editor />
      </div>
      {showOutline ? (
        <div className="min-w-0 flex-1">
          <OutlinePane />
        </div>
      ) : null}
      {showPdf ? (
        <div className="min-w-[340px] flex-1">
          <PdfPane />
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1">
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-w-0 flex-1"
        onLayoutChanged={() => setRightPanelWidth(Math.round(liveWidth.current))}
      >
        <ResizablePanel id="main" minSize={360}>
          {main}
        </ResizablePanel>
        {showContent ? (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel
              id="right"
              defaultSize={rightPanelWidth}
              minSize={320}
              maxSize={640}
              groupResizeBehavior="preserve-pixel-size"
              onResize={(size) => {
                liveWidth.current = size.inPixels;
              }}
            >
              <RightPanelContent />
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
      {showAi ? <RightPanelRail /> : null}
    </div>
  );
}

function UnsavedGuard() {
  const pending = useViewStore((s) => s.pending);
  const confirm = useViewStore((s) => s.confirmPending);
  const cancel = useViewStore((s) => s.cancelPending);
  return (
    <AlertDialog open={pending != null} onOpenChange={(o) => !o && cancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>
            This chapter has edits that haven't been saved to disk. Continuing will
            discard them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction onClick={confirm}>Discard &amp; continue</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
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
  useAiPersistence();
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
          <SettingsDialog />
        </SidebarProvider>
      ) : (
        <Welcome />
      )}
      <UnsavedGuard />
      <MigrationGuard />
      <UpdateChecker />
      <WhatsNewDialog />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}

export default App;
