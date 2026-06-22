// top-bar.tsx — the application chrome: document identity, build status, panel
// toggles, settings, and the Compile CTA. The brand opens the File menu, which
// is where multi-project switching lives. Opening/closing/switching wipes state,
// so those actions are routed through the view store's unsaved-edits guard.

import {
  IconChevronDown,
  IconDeviceFloppy,
  IconFileTypePdf,
  IconFolderOpen,
  IconLoader2,
  IconPlayerPlayFilled,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { SettingsSheet } from "@/components/app/settings-sheet";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import { cn } from "@/lib/utils";

function BuildBadge() {
  const status = useProjectStore((s) => s.compile.status);
  const errors = useProjectStore((s) => s.compile.errors);
  const at = useProjectStore((s) => s.compile.at);

  const tone =
    status === "clean"
      ? "bg-ok"
      : status === "error"
        ? "bg-flag"
        : status === "compiling"
          ? "bg-warn"
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
    <span className="flex items-center gap-1.5 rounded-full border border-line-soft bg-card px-2.5 py-1 font-ui text-[11px] text-mid">
      {status === "compiling" ? (
        <IconLoader2 className="size-3 animate-spin text-warn" />
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
  const saving = useProjectStore((s) => s.saving);
  const compiling = useProjectStore((s) => s.compile.status === "compiling");
  const recents = useProjectStore((s) => s.recents);

  const openDialog = useProjectStore((s) => s.openProjectDialog);
  const loadAt = useProjectStore((s) => s.loadProjectAt);
  const closeProject = useProjectStore((s) => s.closeProject);
  const saveChapter = useProjectStore((s) => s.saveChapter);
  const compileNow = useProjectStore((s) => s.compileNow);

  const aiOpen = useViewStore((s) => s.aiOpen);
  const pdfOpen = useViewStore((s) => s.pdfOpen);
  const focus = useViewStore((s) => s.focus);
  const toggleAi = useViewStore((s) => s.toggleAi);
  const togglePdf = useViewStore((s) => s.togglePdf);
  const guard = useViewStore((s) => s.requestGuarded);

  const chapter = project?.chapters.find((c) => c.id === activeId);

  return (
    <header className="flex h-11 items-center gap-3 border-b border-line-soft bg-background px-3 font-ui">
      <SidebarTrigger className="-ml-1 text-mid" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 font-heading text-[15px]">
            <span className="grid size-[18px] place-items-center rounded bg-gradient-to-br from-accent-ink to-lore-edge text-[11px] font-semibold text-background">
              A
            </span>
            Aproprose
            <IconChevronDown className="size-3 text-faint" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60 font-ui">
          <DropdownMenuItem onSelect={() => guard(() => void openDialog())}>
            <IconFolderOpen /> Open project…
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!chapterDirty || saving}
            onSelect={() => void saveChapter()}
          >
            <IconDeviceFloppy /> Save chapter
          </DropdownMenuItem>
          {recents.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-faint">Recent</DropdownMenuLabel>
              {recents.slice(0, 6).map((r) => (
                <DropdownMenuItem
                  key={r.root}
                  disabled={r.root === project?.root}
                  onSelect={() => guard(() => void loadAt(r.root))}
                >
                  <span className="truncate">{r.name}</span>
                </DropdownMenuItem>
              ))}
            </>
          ) : null}
          {project ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => guard(closeProject)}
              >
                <IconX /> Close project
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {project ? (
        <div className="flex min-w-0 items-center gap-1.5 border-l border-border pl-3 text-[13px] text-mid">
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

      <div className="flex-1" />

      {project ? (
        <>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={pdfOpen && !focus}
            onClick={togglePdf}
            className={cn(
              "font-ui",
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
              "font-ui",
              aiOpen && !focus && "border-accent-ink/30 bg-accent text-accent-foreground",
            )}
          >
            <IconSparkles /> AI
          </Button>
          <SettingsSheet />
          <Button
            size="sm"
            className="font-ui"
            onClick={() => void compileNow()}
            disabled={compiling}
          >
            {compiling ? <IconLoader2 className="animate-spin" /> : <IconPlayerPlayFilled />}
            Compile
          </Button>
        </>
      ) : (
        <SettingsSheet />
      )}
    </header>
  );
}
