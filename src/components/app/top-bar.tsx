// top-bar.tsx — the application chrome: sidebar toggle, document identity, build
// status, panel toggles, settings, the Compile CTA, and (off-macOS) window
// controls. Project switching now lives in the sidebar header, not here.

import { useState, useEffect } from "react";
import {
  IconFileTypePdf,
  IconPlayerPlayFilled,
  IconSparkles,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { KeybindingHint } from "@/components/app/keybinding-hint";
import { SyncStatus } from "@/components/app/sync-status";
import { WindowControls } from "@/components/app/window-controls";
import { BackupReviewDialog } from "@/components/app/backup-review-dialog";
import { BackupSetupDialog } from "@/components/app/backup-setup-dialog";
import { BuildErrorsDialog } from "@/components/app/build-errors-dialog";
import { useProjectStore } from "@/stores/project-store";
import { useSyncStore } from "@/stores/sync-store";
import { useViewStore } from "@/stores/view-store";
import { useKeybinding } from "@/hooks/use-keybinding";
import { KEYBINDINGS, KEYBINDING_IDS } from "@/lib/keybindings";
import { IS_MAC } from "@/lib/platform";
import { cn } from "@/lib/utils";

function BuildBadge() {
  const status = useProjectStore((s) => s.compile.status);
  const errors = useProjectStore((s) => s.compile.errors);
  const at = useProjectStore((s) => s.compile.at);
  const setBuildErrorsOpen = useViewStore((s) => s.setBuildErrorsOpen);

  const tone =
    status === "clean"
      ? "bg-success"
      : status === "error"
        ? "bg-destructive"
        : status === "compiling"
          ? "bg-warning"
          : "bg-faint";

  const label =
    status === "clean"
      ? at
        ? "build clean"
        : "loaded"
      : status === "error"
        ? `${errors.length || "build"} error${errors.length === 1 ? "" : "s"}`
        : status === "compiling"
          ? "compiling"
          : "not built";

  const inner = (
    <>
      {status === "compiling" ? (
        <Spinner className="size-3 text-warning" />
      ) : (
        <span className={cn("size-1.5 rounded-full", tone)} />
      )}
      {label}
    </>
  );

  const base =
    "flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground";

  if (status === "error") {
    return (
      <button
        type="button"
        aria-label="View build errors"
        onClick={() => setBuildErrorsOpen(true)}
        className={cn(base, "cursor-pointer transition-colors hover:bg-accent")}
      >
        {inner}
      </button>
    );
  }

  return <span className={base}>{inner}</span>;
}

export function TopBar() {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  const prefsKnown = useSyncStore((s) => s.prefsKnown);
  const repoDetected = useSyncStore((s) => s.isRepo);
  useEffect(() => {
    // Git repo aproprose hasn't recorded prefs for → offer setup once.
    if (repoDetected && !prefsKnown) setSetupOpen(true);
  }, [repoDetected, prefsKnown]);

  const project = useProjectStore((s) => s.project);
  const activeId = useProjectStore((s) => s.activeChapterId);
  const chapterDirty = useProjectStore((s) => s.chapterDirty);
  const compiling = useProjectStore((s) => s.compile.status === "compiling");
  const compileNow = useProjectStore((s) => s.compileNow);

  // On macOS the traffic lights only sit over the top bar when the sidebar is
  // collapsed; when it's open they're over the sidebar header (which reserves
  // its own band), so the pl-20 inset would just be wasted space here.
  const sidebarState = useSidebar().state;

  const aiOpen = useViewStore((s) => s.aiOpen);
  const pdfOpen = useViewStore((s) => s.pdfOpen);
  const focus = useViewStore((s) => s.focus);
  const toggleAi = useViewStore((s) => s.toggleAi);
  const togglePdf = useViewStore((s) => s.togglePdf);
  const buildErrorsOpen = useViewStore((s) => s.buildErrorsOpen);
  const setBuildErrorsOpen = useViewStore((s) => s.setBuildErrorsOpen);

  // Shortcuts for the chrome actions live with their buttons. (Save / undo / redo
  // are bound in the editor.)
  useKeybinding(KEYBINDING_IDS.COMPILE, () => void compileNow());
  useKeybinding(KEYBINDING_IDS.TOGGLE_PDF, togglePdf);
  useKeybinding(KEYBINDING_IDS.TOGGLE_AI, toggleAi);

  const chapter = project?.chapters.find((c) => c.id === activeId);

  return (
    <header
      data-tauri-drag-region
      className={cn(
        "flex h-11 items-center gap-3 border-b border-border bg-background px-3",
        IS_MAC && sidebarState === "collapsed" && "pl-20",
      )}
    >
      {/* Left: sidebar toggle, document identity, build status. */}
      <div className="flex min-w-0 flex-1 items-center gap-3" data-tauri-drag-region>
        <SidebarTrigger className="-ml-1 text-muted-foreground" />

        {project ? (
          <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
            <span className="truncate font-medium text-foreground">{project.mainFile}</span>
            {chapter ? (
              <>
                <span className="text-faint">/</span>
                <span className="truncate">
                  Ch. {chapter.label} — {chapter.title}
                  {chapterDirty ? <span className="text-accent-ink"> •</span> : null}
                </span>
              </>
            ) : null}
          </div>
        ) : null}

        <BuildBadge />
        {project ? (
          <SyncStatus onReview={() => setReviewOpen(true)} onSetup={() => setSetupOpen(true)} />
        ) : null}
      </div>

      {/* Center: the Compile CTA. */}
      {project ? (
        <Button
          size="sm"
          onClick={() => void compileNow()}
          disabled={compiling}
        >
          {compiling ? <Spinner /> : <IconPlayerPlayFilled />}
          Compile
          <KeybindingHint keybinding={KEYBINDINGS.COMPILE} />
        </Button>
      ) : null}

      {/* Right: panel toggles + window controls. */}
      <div className="flex flex-1 items-center justify-end gap-2" data-tauri-drag-region>
        {project ? (
          <>
            <Button
              variant="outline"
              size="sm"
              aria-pressed={pdfOpen && !focus}
              onClick={togglePdf}
              className={cn(
                pdfOpen && !focus && "border-accent-ink/30 bg-accent text-accent-foreground",
              )}
            >
              <IconFileTypePdf /> PDF
              <KeybindingHint keybinding={KEYBINDINGS.TOGGLE_PDF} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-pressed={aiOpen && !focus}
              onClick={toggleAi}
              className={cn(
                aiOpen && !focus && "border-accent-ink/30 bg-accent text-accent-foreground",
              )}
            >
              <IconSparkles /> AI
              <KeybindingHint keybinding={KEYBINDINGS.TOGGLE_AI} />
            </Button>
          </>
        ) : null}
        <WindowControls />
      </div>
      <BackupReviewDialog open={reviewOpen} onOpenChange={setReviewOpen} />
      <BackupSetupDialog open={setupOpen} onOpenChange={setSetupOpen} />
      <BuildErrorsDialog open={buildErrorsOpen} onOpenChange={setBuildErrorsOpen} />
    </header>
  );
}
