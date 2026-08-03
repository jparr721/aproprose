// sync-status.tsx — the top-bar backup indicator. A Spinner while syncing; a
// status icon otherwise; a popover with details and manual actions. When the
// project isn't a backed-up repo, it offers "Back up to GitHub".

import {
  CloudAlert,
  CloudCheck,
  CloudOff,
  CloudUpload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TypographyMuted, TypographySmall } from "@/components/ui/typography";
import { useSyncStore } from "@/stores/sync-store";
import type { SyncStatus } from "@/lib/types";

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

/** The compact glyph in the top-bar trigger. */
function TriggerGlyph({ status }: { status: SyncStatus }) {
  switch (status) {
    case "syncing":
      return <Spinner className="size-3.5 text-success" />;
    case "clean":
    case "synced":
      return <CloudCheck className="size-3.5 text-success" />;
    case "offline":
      return <CloudOff className="size-3.5 text-muted-foreground" />;
    case "conflict":
    case "error":
      return <CloudAlert className="size-3.5 text-destructive" />;
    default:
      return <CloudUpload className="size-3.5 text-warning" />;
  }
}

/** The header icon for the details popover, keyed by status. */
function StatusIcon({ status }: { status: SyncStatus }) {
  switch (status) {
    case "clean":
    case "synced":
      return <CloudCheck className="size-4 text-success" />;
    case "offline":
      return <CloudOff className="size-4 text-muted-foreground" />;
    case "conflict":
    case "error":
      return <CloudAlert className="size-4 text-destructive" />;
    default:
      return <CloudUpload className="size-4 text-warning" />;
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
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back up to GitHub"
            onClick={onSetup}
            className="text-muted-foreground"
          >
            <CloudUpload className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Back up to GitHub</TooltipContent>
      </Tooltip>
    );
  }

  const label = statusLabel(status);

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={label}>
              <TriggerGlyph status={status} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
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
