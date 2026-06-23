// top-bar.tsx — the application chrome: sidebar toggle, document identity, build
// status, panel toggles, settings, the Compile CTA, and (off-macOS) window
// controls. Project switching now lives in the sidebar header, not here.

import {
  IconFileTypePdf,
  IconLoader2,
  IconPlayerPlayFilled,
  IconSparkles,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { SettingsSheet } from "@/components/app/settings-sheet";
import { WindowControls } from "@/components/app/window-controls";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import { IS_MAC } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { primaryTokens, primaryLabel } from "@/lib/keybindings";

function BuildBadge() {
  const status = useProjectStore((s) => s.compile.status);
  const errors = useProjectStore((s) => s.compile.errors);
  const at = useProjectStore((s) => s.compile.at);

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
          ? "compiling…"
          : "not built";

  return (
    <span className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-sans text-[11px] text-muted-foreground">
      {status === "compiling" ? (
        <IconLoader2 className="size-3 animate-spin text-warning" />
      ) : (
        <span className={cn("size-1.5 rounded-full", tone)} />
      )}
      {label}
    </span>
  );
}

export function TopBar() {
  const project = useProjectStore((s) => s.project);
  const activeId = useProjectStore((s) => s.activeChapterId);
  const chapterDirty = useProjectStore((s) => s.chapterDirty);
  const compiling = useProjectStore((s) => s.compile.status === "compiling");
  const compileNow = useProjectStore((s) => s.compileNow);

  const aiOpen = useViewStore((s) => s.aiOpen);
  const pdfOpen = useViewStore((s) => s.pdfOpen);
  const focus = useViewStore((s) => s.focus);
  const toggleAi = useViewStore((s) => s.toggleAi);
  const togglePdf = useViewStore((s) => s.togglePdf);

  const chapter = project?.chapters.find((c) => c.id === activeId);

  return (
    <header
      data-tauri-drag-region
      className={cn(
        "flex h-11 items-center gap-3 border-b border-border bg-background px-3 font-sans",
        IS_MAC && "pl-20",
      )}
    >
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

      <div className="ml-1">
        <BuildBadge />
      </div>

      <div className="flex-1" data-tauri-drag-region />

      {project ? (
        <>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={pdfOpen && !focus}
            onClick={togglePdf}
            className={cn(
              "font-sans",
              pdfOpen && !focus && "border-accent-ink/30 bg-accent text-accent-foreground",
            )}
          >
            <IconFileTypePdf /> PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={aiOpen && !focus}
            onClick={toggleAi}
            className={cn(
              "font-sans",
              aiOpen && !focus && "border-accent-ink/30 bg-accent text-accent-foreground",
            )}
          >
            <IconSparkles /> AI
          </Button>
          <SettingsSheet />
          <Button
            size="sm"
            className="font-sans"
            onClick={() => void compileNow()}
            disabled={compiling}
            title={`Save & build PDF (${primaryLabel("save-build", IS_MAC)})`}
            aria-label={`Save & build PDF (${primaryLabel("save-build", IS_MAC)})`}
          >
            {compiling ? <IconLoader2 className="animate-spin" /> : <IconPlayerPlayFilled />}
            Compile
            <KbdGroup className="ml-1">
              {primaryTokens("save-build", IS_MAC).map((t, i) => (
                <Kbd key={i}>{t}</Kbd>
              ))}
            </KbdGroup>
          </Button>
        </>
      ) : (
        <SettingsSheet />
      )}

      <WindowControls />
    </header>
  );
}
