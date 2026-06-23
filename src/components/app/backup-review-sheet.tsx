// backup-review-sheet.tsx — "what changed since the last backup". Lists changed
// files, expands each to its diff on demand, and commits+syncs via the engine.

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TypographyMuted } from "@/components/ui/typography";
import { useSyncStore } from "@/stores/sync-store";
import { useProjectStore } from "@/stores/project-store";
import { gitDiff } from "@/lib/tauri";
import { cn } from "@/lib/utils";

function DiffView({ text }: { text: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-card p-2 font-mono text-[11px] leading-relaxed">
      {text.split("\n").map((line, i) => (
        <div
          key={i}
          className={cn(
            line.startsWith("+") && !line.startsWith("+++") && "text-success",
            line.startsWith("-") && !line.startsWith("---") && "text-destructive",
            line.startsWith("@@") && "text-accent-ink",
          )}
        >
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

function FileRow({ root, path, status }: { root: string; path: string; status: string }) {
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && diff === null) {
      setLoading(true);
      try {
        setDiff(await gitDiff(root, path));
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => void toggle()}
        className="flex items-center gap-2 text-left font-sans text-xs text-foreground"
      >
        <span className="w-6 shrink-0 font-mono text-muted-foreground">{status.trim()}</span>
        <span className="truncate">{path}</span>
      </button>
      {open ? (
        loading ? (
          <Spinner className="size-3.5" />
        ) : error ? (
          <TypographyMuted className="text-[11px] text-destructive">Couldn't load diff: {error}</TypographyMuted>
        ) : diff && diff.trim() ? (
          <DiffView text={diff} />
        ) : (
          <TypographyMuted className="text-[11px]">No textual diff (new or binary file).</TypographyMuted>
        )
      ) : null}
    </div>
  );
}

export function BackupReviewSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const root = useProjectStore((s) => s.project?.root ?? null);
  const changedFiles = useSyncStore((s) => s.changedFiles);
  const status = useSyncStore((s) => s.status);
  const refreshStatus = useSyncStore((s) => s.refreshStatus);
  const syncNow = useSyncStore((s) => s.syncNow);

  useEffect(() => {
    if (open) void refreshStatus();
  }, [open, refreshStatus]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[420px] flex-col gap-4 font-sans sm:max-w-[420px]">
        <SheetHeader>
          <SheetTitle>Review changes</SheetTitle>
          <SheetDescription>
            Everything below is committed and pushed to GitHub when you sync.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-1">
          {changedFiles.length === 0 ? (
            <TypographyMuted className="text-xs">No changes since the last backup.</TypographyMuted>
          ) : (
            changedFiles.map((f) =>
              root ? <FileRow key={f.path} root={root} path={f.path} status={f.status} /> : null,
            )
          )}
        </div>

        <Button
          onClick={() => void syncNow()}
          disabled={status === "syncing" || changedFiles.length === 0}
        >
          {status === "syncing" ? <Spinner /> : null}
          Commit &amp; sync
        </Button>
      </SheetContent>
    </Sheet>
  );
}
