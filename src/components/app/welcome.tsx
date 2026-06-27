// welcome.tsx — the no-project-open state: open a project or pick a recent.

import { IconBook2, IconBookUpload, IconClock, IconFolderOpen } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TypographyEyebrow, TypographyMuted } from "@/components/ui/typography";
import { WindowControls } from "@/components/app/window-controls";
import { NewNovelDialog } from "@/components/app/new-novel-dialog";
import { useProjectStore } from "@/stores/project-store";
import { IS_MAC } from "@/lib/platform";
import { cn } from "@/lib/utils";

function relativeTime(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function Welcome() {
  const recents = useProjectStore((s) => s.recents);
  const open = useProjectStore((s) => s.openProjectDialog);
  const loadAt = useProjectStore((s) => s.loadProjectAt);
  const error = useProjectStore((s) => s.error);
  const loading = useProjectStore((s) => s.status === "loading");

  return (
    <div className="flex h-full flex-col bg-background">
      {/* The window is frameless and there's no top bar until a project opens, so
          provide a drag region + window controls here. macOS keeps its native
          traffic lights (WindowControls renders nothing there); the inset leaves
          room for them. Without this the window can't be moved or closed from the
          welcome screen. */}
      <header
        data-tauri-drag-region
        className={cn(
          "flex h-11 shrink-0 items-center justify-end px-3",
          IS_MAC && "pl-20",
        )}
      >
        <WindowControls />
      </header>

      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex w-full max-w-md flex-col items-center gap-8">
          {recents.length > 0 ? (
            <div className="flex w-full flex-col gap-2">
              <TypographyEyebrow className="px-1">
                <IconClock className="mr-1 inline size-3" />
                Recent
              </TypographyEyebrow>
              <div className="flex flex-col gap-0.5">
                {recents.map((r) => (
                  <button
                    key={r.root}
                    onClick={() => loadAt(r.root)}
                    disabled={loading}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                      "hover:bg-muted disabled:pointer-events-none disabled:opacity-50",
                    )}
                  >
                    <IconBook2 className="size-4 shrink-0 text-faint group-hover:text-accent-ink" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-heading text-sm text-foreground">
                        {r.name}
                      </span>
                      <span className="truncate text-xs text-faint">{r.root}</span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-faint">
                      {relativeTime(r.openedAt)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <TypographyMuted className="text-center text-xs">
              Point Aproprose at a folder with a <code>main.tex</code> — it reads and
              compiles in place, nothing is copied.
            </TypographyMuted>
          )}

          {error ? (
            <TypographyMuted className="text-center text-destructive">
              {error}
            </TypographyMuted>
          ) : null}

          <div className="flex w-full flex-col gap-2">
            <NewNovelDialog
              trigger={
                <Button size="lg" className="w-full" disabled={loading}>
                  <IconBookUpload />
                  New novel
                </Button>
              }
            />
            <Button
              size="lg"
              variant="outline"
              className="w-full"
              onClick={open}
              disabled={loading}
            >
              {loading ? <Spinner /> : <IconFolderOpen />}
              {loading ? "Opening" : "Open a project"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
