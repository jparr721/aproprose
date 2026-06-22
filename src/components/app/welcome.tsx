// welcome.tsx — the no-project-open state: open a project or pick a recent.

import { IconBook2, IconClock, IconFolderOpen } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  TypographyH1,
  TypographyEyebrow,
  TypographyLead,
  TypographyMuted,
} from "@/components/ui/typography";
import { useProjectStore } from "@/stores/project-store";
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
    <div className="flex h-full items-center justify-center bg-background p-8 font-sans">
      <div className="flex w-full max-w-md flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-gradient-to-br from-accent-ink to-lore-edge font-heading text-2xl font-semibold text-background shadow-sm">
            A
          </span>
          <div className="flex flex-col gap-1">
            <TypographyH1 className="text-4xl">Aproprose</TypographyH1>
            <TypographyLead className="font-serif italic">
              An AI-native writing room for your LaTeX novel.
            </TypographyLead>
          </div>
        </div>

        <Button size="lg" className="font-sans" onClick={open} disabled={loading}>
          <IconFolderOpen />
          {loading ? "Opening…" : "Open a project"}
        </Button>

        {error ? (
          <TypographyMuted className="text-center text-destructive">
            {error}
          </TypographyMuted>
        ) : null}

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
      </div>
    </div>
  );
}
