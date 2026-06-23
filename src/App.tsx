// App.tsx — the workspace shell.
//
// Empty state -> Welcome (open/recent). Project open -> a Sidebar + top bar + a
// resizable editor / PDF / AI split. Focus mode hides the PDF and AI panels; the
// sidebar is independent (toggled by its own trigger / ⌘B). The unsaved-edits
// confirm dialog is mounted once here, driven by the view store's guard.

import { useEffect } from "react";
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
import { Editor } from "@/components/app/editor";
import { PdfPane } from "@/components/app/pdf-pane";
import { AiPanel } from "@/components/app/ai-panel";
import { Welcome } from "@/components/app/welcome";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import { bindingFor } from "@/lib/keybindings";

function Workspace() {
  const aiOpen = useViewStore((s) => s.aiOpen);
  const pdfOpen = useViewStore((s) => s.pdfOpen);
  const focus = useViewStore((s) => s.focus);

  const showPdf = pdfOpen && !focus;
  const showAi = aiOpen && !focus;

  return (
    <div className="flex min-h-0 flex-1">
      {/* Editor and PDF share the central space; the AI panel is a fixed rail. */}
      <div className="min-w-0 flex-1">
        <Editor />
      </div>

      {showPdf ? (
        <div className="min-w-[340px] flex-1">
          <PdfPane />
        </div>
      ) : null}

      {showAi ? (
        <div className="w-[360px] shrink-0">
          <AiPanel />
        </div>
      ) : null}
    </div>
  );
}

function UnsavedGuard() {
  const pending = useViewStore((s) => s.pending);
  const confirm = useViewStore((s) => s.confirmPending);
  const cancel = useViewStore((s) => s.cancelPending);
  return (
    <AlertDialog open={pending != null} onOpenChange={(o) => !o && cancel()}>
      <AlertDialogContent className="font-sans">
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

function App() {
  const status = useProjectStore((s) => s.status);
  const compileNow = useProjectStore((s) => s.compileNow);

  // Keyboard shortcuts come from the central registry (see src/lib/keybindings.ts):
  // ⌘/Ctrl+S saves & rebuilds the PDF, ⌘/Ctrl+Enter splits the focused prose
  // block at the caret, ⌘/Ctrl+Z / +Shift+Z (or Ctrl+Y) undo/redo. Undo/redo is
  // skipped when focus is inside the AI panel or a dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const binding = bindingFor(e);
      if (!binding) return;

      if (binding.id === "save-build") {
        e.preventDefault();
        void compileNow();
        return;
      }

      if (binding.id === "split") {
        const el = document.activeElement;
        if (!(el instanceof HTMLTextAreaElement) || !el.matches("[data-prose-body]")) return;
        const host = el.closest("[data-block-id]");
        const blockId = host instanceof HTMLElement ? host.dataset.blockId : undefined;
        if (!blockId) return;
        e.preventDefault();
        useProjectStore.getState().splitBlock(blockId, el.selectionStart);
        return;
      }

      // undo / redo
      const inAux = (document.activeElement as HTMLElement | null)?.closest(
        '[data-ai-root],[role="dialog"],[role="alertdialog"]',
      );
      if (inAux) return;
      e.preventDefault();
      const store = useProjectStore.getState();
      if (binding.id === "redo") store.redo();
      else store.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compileNow]);

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
        </SidebarProvider>
      ) : (
        <Welcome />
      )}
      <UnsavedGuard />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}

export default App;
