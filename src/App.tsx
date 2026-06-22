// App.tsx — the workspace shell.
//
// Empty state -> Welcome (open/recent). Project open -> top bar + rail + a
// resizable editor / PDF / AI split. Focus mode collapses everything but the
// editor. The unsaved-edits confirm dialog is mounted once here, driven by the
// view store's guard.

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
import { ThemeController } from "@/components/app/theme-controller";
import { TopBar } from "@/components/app/top-bar";
import { Rail } from "@/components/app/rail";
import { Editor } from "@/components/app/editor";
import { PdfPane } from "@/components/app/pdf-pane";
import { AiPanel } from "@/components/app/ai-panel";
import { Welcome } from "@/components/app/welcome";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";

function Workspace() {
  const aiOpen = useViewStore((s) => s.aiOpen);
  const pdfOpen = useViewStore((s) => s.pdfOpen);
  const focus = useViewStore((s) => s.focus);

  const showPdf = pdfOpen && !focus;
  const showAi = aiOpen && !focus;

  return (
    <div className="flex min-h-0 flex-1">
      {!focus ? (
        <div className="w-56 shrink-0">
          <Rail />
        </div>
      ) : null}

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
      <AlertDialogContent className="font-ui">
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
  const saveChapter = useProjectStore((s) => s.saveChapter);
  const compileNow = useProjectStore((s) => s.compileNow);

  // Keyboard: ⌘/Ctrl+S saves, ⌘/Ctrl+Enter compiles, ⌘/Ctrl+Z / +Shift+Z (or
  // Ctrl+Y) undo/redo the editor. Undo/redo is skipped when focus is inside the
  // AI panel or a dialog so those inputs keep their own behavior.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        void saveChapter();
      } else if (key === "enter") {
        e.preventDefault();
        void compileNow();
      } else if (key === "z" || key === "y") {
        const inAux = (document.activeElement as HTMLElement | null)?.closest(
          '[data-ai-root],[role="dialog"],[role="alertdialog"]',
        );
        if (inAux) return;
        e.preventDefault();
        const store = useProjectStore.getState();
        if (key === "y" || e.shiftKey) store.redo();
        else store.undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveChapter, compileNow]);

  return (
    <TooltipProvider>
      <ThemeController />
      {status === "ready" ? (
        <div className="flex h-screen flex-col bg-background">
          <TopBar />
          <Workspace />
        </div>
      ) : (
        <Welcome />
      )}
      <UnsavedGuard />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}

export default App;
