// backup-review-dialog.tsx - "what changed since the last backup". A near-full-
// screen dialog listing changed files; each row expands on demand to its diff,
// rendered with @pierre/diffs, and commits+syncs via the engine.

import { notifyAppError, openNotifications } from "@/lib/notifications";
import { lazy, Suspense, useEffect, useState } from "react";
import { IconChevronRight } from "@tabler/icons-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TypographyMuted } from "@/components/ui/typography";
import { useSyncStore } from "@/stores/sync-store";
import { useProjectStore } from "@/stores/project-store";
import { useSettingsStore } from "@/stores/settings-store";
import { gitDiff } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const PatchDiff = lazy(() =>
  import("@pierre/diffs/react").then(({ PatchDiff }) => ({
    default: PatchDiff,
  })),
);

/** The app theme ("light" | "sepia" | "dark") mapped to the diff's light/dark pair. */
type DiffThemeType = "light" | "dark";

function FileRow({
  root,
  path,
  status,
  themeType,
}: {
  root: string;
  path: string;
  status: string;
  themeType: DiffThemeType;
}) {
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
        notifyAppError("backup-diff", "Backup", root, e);
        setError("Backup changes could not be loaded");
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="p-0">
      <Button
        variant="ghost"
        aria-expanded={open}
        onClick={() => void toggle()}
        className="h-auto justify-start rounded-none px-3 py-2.5 text-left"
      >
        <IconChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="w-5 shrink-0 text-muted-foreground">
          {status.trim()}
        </span>
        <span className="truncate">{path}</span>
      </Button>
      </CardHeader>
      {open ? (
        <CardContent className="border-t border-border p-2">
          {loading ? (
            <div className="flex items-center gap-2 px-1 py-2">
              <Spinner className="size-3.5" />
              <TypographyMuted className="text-xs">Loading diff</TypographyMuted>
            </div>
          ) : error ? (
            <TypographyMuted className="px-1 py-2 text-xs text-destructive">
              <Button variant="ghost" size="sm" onClick={openNotifications}>View notifications</Button>
            </TypographyMuted>
          ) : diff && diff.trim() ? (
            <Suspense
              fallback={
                <div className="flex items-center gap-2 px-1 py-2">
                  <Spinner className="size-3.5" />
                  <TypographyMuted className="text-xs">
                    Rendering diff
                  </TypographyMuted>
                </div>
              }
            >
              <PatchDiff
                patch={diff}
                options={{ themeType, overflow: "wrap", disableFileHeader: true }}
                className="overflow-hidden rounded-md"
              />
            </Suspense>
          ) : (
            <TypographyMuted className="px-1 py-2 text-xs">
              No textual diff (new or binary file).
            </TypographyMuted>
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}

export function BackupReviewDialog({
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
  const themeType: DiffThemeType = useSettingsStore((s) =>
    s.theme === "dark" ? "dark" : "light",
  );

  useEffect(() => {
    if (open) void refreshStatus();
  }, [open, refreshStatus]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] w-[92vw] max-w-[1100px] flex-col gap-0 p-0 sm:max-w-[1100px]">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Review changes</DialogTitle>
          <DialogDescription>
            Everything below is committed and pushed to GitHub when you sync.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {changedFiles.length === 0 ? (
            <TypographyMuted className="text-xs">No changes since the last backup.</TypographyMuted>
          ) : (
            changedFiles.map((f) =>
              root ? (
                <FileRow
                  key={f.path}
                  root={root}
                  path={f.path}
                  status={f.status}
                  themeType={themeType}
                />
              ) : null,
            )
          )}
        </div>

        <DialogFooter className="border-t border-border px-5 py-3">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            onClick={() => void syncNow()}
            disabled={status === "syncing" || changedFiles.length === 0}
          >
            {status === "syncing" ? <Spinner /> : null}
            Commit &amp; sync
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
