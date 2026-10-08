// top-bar.tsx — the application chrome: sidebar toggle, document identity, save
// status, panel toggles, settings, the Compile CTA, and (off-macOS) window
// controls. Project switching now lives in the sidebar header, not here.

import { useState, useEffect } from "react";
import {
  FileText,
  Play,
  Save,
  SaveCheck,
  SaveOff,
} from "lucide-react";
import { IconFileDiff, IconSparkles } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { useAgentChanges } from "@/hooks/use-agent-changes";
import { KEYBINDINGS, KEYBINDING_IDS } from "@/lib/keybindings";
import { IS_MAC } from "@/lib/platform";
import { cn } from "@/lib/utils";

function SaveStatus() {
  const chapterDirty = useProjectStore((s) => s.chapterDirty);
  const saving = useProjectStore((s) => s.saving);
  const saveError = useProjectStore((s) => s.saveError);

  const state = saving
    ? {
        label: "Saving",
        tooltip: "Saving",
        icon: <Spinner className="size-3.5 text-warning" />,
      }
    : saveError
      ? {
          label: "Save failed",
          tooltip: "Save failed. See Settings > Notifications.",
          icon: <SaveOff className="size-3.5 text-destructive" />,
        }
      : chapterDirty
        ? {
            label: "Unsaved changes",
            tooltip: "Unsaved changes",
            icon: <Save className="size-3.5 text-warning" />,
          }
        : {
            label: "Saved",
            tooltip: "Saved",
            icon: <SaveCheck className="size-3.5 text-success" />,
          };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          aria-label={state.label}
          className="flex size-6 items-center justify-center text-muted-foreground"
        >
          {state.icon}
        </span>
      </TooltipTrigger>
      <TooltipContent>{state.tooltip}</TooltipContent>
    </Tooltip>
  );
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
  // its own band), so the pl-24 inset would just be wasted space here.
  const sidebarState = useSidebar().state;

  const aiOpen = useViewStore((s) => s.aiOpen);
  const changesOpen = useViewStore((s) => s.changesOpen);
  const pdfOpen = useViewStore((s) => s.pdfOpen);
  const focus = useViewStore((s) => s.focus);
  const toggleAi = useViewStore((s) => s.toggleAi);
  const toggleChanges = useViewStore((s) => s.toggleChanges);
  const { pendingCount, runStatus, activeSessionId } = useAgentChanges();
  const generating = runStatus !== "idle" && activeSessionId !== null && activeSessionId.kind !== "character";
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
        IS_MAC && sidebarState === "collapsed" && "pl-24",
      )}
    >
      {/* Left: sidebar toggle, document identity, save status. */}
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

        <SaveStatus />
        {project ? (
          <SyncStatus onReview={() => setReviewOpen(true)} onSetup={() => setSetupOpen(true)} />
        ) : null}
      </div>

      {/* Center: the Compile CTA. */}
      {project ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-sm"
              aria-label="Compile"
              onClick={() => void compileNow()}
              disabled={compiling}
            >
              {compiling ? <Spinner className="size-3.5" /> : <Play className="size-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Compile</TooltipContent>
        </Tooltip>
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
                "px-2.5",
                pdfOpen && !focus && "border-accent-ink/30 bg-accent text-accent-foreground",
              )}
            >
              <FileText /> PDF
              <KeybindingHint keybinding={KEYBINDINGS.TOGGLE_PDF} className="ml-0.5" />
            </Button>
            <div className="h-4 w-px bg-border" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  data-changes-toggle
                  variant={changesOpen && !focus ? "secondary" : "ghost"}
                  size="icon-sm"
                  aria-label={`Changes - ${pendingCount} pending`}
                  aria-pressed={changesOpen && !focus}
                  aria-busy={generating}
                  onClick={toggleChanges}
                  className={cn(
                    "relative transition-all duration-200 motion-reduce:transition-none",
                    pendingCount > 0 && "text-ai-ink shadow-[0_0_12px_var(--ai-edge)]",
                    generating && "motion-safe:animate-pulse",
                  )}
                >
                  <IconFileDiff />
                  {generating ? (
                    <Spinner className="absolute -top-1 -right-1 size-3 text-ai-ink motion-reduce:animate-none" />
                  ) : pendingCount > 0 ? (
                    <Badge className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 text-xs">{pendingCount}</Badge>
                  ) : null}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{generating ? `Changes - generating - ${pendingCount} pending` : `Changes - ${pendingCount} pending`}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  data-ai-toggle
                  variant={aiOpen && !focus ? "secondary" : "ghost"}
                  size="icon-sm"
                  aria-label="Toggle AI Console"
                  aria-pressed={aiOpen && !focus}
                  onClick={toggleAi}
                >
                  <IconSparkles className={cn(generating && "text-ai-ink motion-safe:animate-pulse")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>AI conversation <KeybindingHint keybinding={KEYBINDINGS.TOGGLE_AI} /></TooltipContent>
            </Tooltip>
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
