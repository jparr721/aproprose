// sync-status.tsx — the top-bar backup indicator. A Spinner while syncing; a
// status dot otherwise; a popover with details and manual actions. When the
// project isn't a backed-up repo, it offers "Back up to GitHub".

import {
  IconCloudCheck,
  IconCloudUp,
  IconAlertTriangle,
  IconCloudOff,
  IconGitMerge,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { TypographyMuted, TypographySmall } from "@/components/ui/typography";
import { useSyncStore } from "@/stores/sync-store";
import type { SyncStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const TONE: Record<SyncStatus, string> = {
  clean: "bg-success",
  synced: "bg-success",
  syncing: "bg-success",
  dirty: "bg-warning",
  conflict: "bg-destructive",
  error: "bg-destructive",
  offline: "bg-faint",
  needsSetup: "bg-faint",
  disabled: "bg-faint",
};

function statusLabel(status: SyncStatus): string {
  switch (status) {
    case "syncing":
      return "Syncing";
    case "conflict":
      return "Conflict";
    case "error":
      return "Sync error";
    case "offline":
      return "Offline";
    case "dirty":
      return "Unsynced changes";
    default:
      return "Backed up";
  }
}

/** The compact glyph in the top-bar trigger: a spinner, the conflict icon, or a tone dot. */
function TriggerGlyph({ status }: { status: SyncStatus }) {
  switch (status) {
    case "syncing":
      return <Spinner className="size-3 text-success" />;
    case "conflict":
      return <IconGitMerge className="size-3 text-destructive" />;
    default:
      return <span className={cn("size-1.5 rounded-full", TONE[status])} />;
  }
}

/** The header icon for the details popover, keyed by status. */
function StatusIcon({ status }: { status: SyncStatus }) {
  switch (status) {
    case "clean":
    case "synced":
      return <IconCloudCheck className="size-4 text-success" />;
    case "offline":
      return <IconCloudOff className="size-4 text-muted-foreground" />;
    case "conflict":
    case "error":
      return <IconAlertTriangle className="size-4 text-destructive" />;
    default:
      return <IconCloudUp className="size-4 text-warning" />;
  }
}

export function SyncStatus({
  onReview,
  onSetup,
}: {
  onReview: () => void;
  onSetup: () => void;
}) {
  const status = useSyncStore((s) => s.status);
  const isRepo = useSyncStore((s) => s.isRepo);
  const remoteUrl = useSyncStore((s) => s.remoteUrl);
  const lastError = useSyncStore((s) => s.lastError);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const changedFiles = useSyncStore((s) => s.changedFiles);
  const syncNow = useSyncStore((s) => s.syncNow);

  // Not a backed-up project: offer setup.
  if (!isRepo || !remoteUrl) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={onSetup}
        className="h-6 gap-1.5 px-2 text-[11px] text-muted-foreground"
      >
        <IconCloudUp className="size-3.5" /> Back up to GitHub
      </Button>
    );
  }

  const label = statusLabel(status);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground"
        >
          <TriggerGlyph status={status} />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <StatusIcon status={status} />
            <TypographySmall>{label}</TypographySmall>
          </div>

          {status === "conflict" ? (
            <TypographyMuted className="text-xs">
              A merge conflict needs resolving in git. Auto-sync is paused; affected
              chapters show an error until you resolve and resync.
            </TypographyMuted>
          ) : lastError ? (
            <TypographyMuted className="text-xs">{lastError}</TypographyMuted>
          ) : (
            <TypographyMuted className="text-xs">
              {changedFiles.length > 0
                ? `${changedFiles.length} changed file${changedFiles.length === 1 ? "" : "s"} pending.`
                : "Everything is backed up."}
              {lastSyncedAt
                ? ` Last synced ${new Date(lastSyncedAt).toLocaleTimeString()}.`
                : ""}
            </TypographyMuted>
          )}

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void syncNow()} disabled={status === "syncing"}>
              {status === "syncing" ? <Spinner /> : null}
              Sync now
            </Button>
            <Button size="sm" variant="outline" onClick={onReview}>
              Review changes
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
