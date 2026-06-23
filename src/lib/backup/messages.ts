// messages.ts — backup commit-message formatting + engine-outcome → UI status/message mapping.
import type { RepoStatus, SyncOutcome, SyncStatus } from "@/lib/types";

/** The auto-commit message for a timer/manual backup. */
export function backupMessage(date: Date): string {
  return `Backup — ${date.toLocaleString()}`;
}

/** Map an engine outcome to the UI status shown in the top bar. */
export function outcomeToStatus(outcome: SyncOutcome): SyncStatus {
  switch (outcome.kind) {
    case "clean":
      return "clean";
    case "synced":
      return "synced";
    case "conflict":
      return "conflict";
    case "pushRejected":
      // A transient race; we'll retry next cycle. Show as pending.
      return "dirty";
    case "needsSetup":
      return "needsSetup";
    case "authMissing":
      return "error";
    case "offline":
      return "offline";
  }
}

/** The idle (not-syncing) status derived purely from the working-tree state. */
export function deriveIdleStatus(s: RepoStatus): SyncStatus {
  if (!s.isRepo || !s.hasRemote) return "disabled";
  if (s.conflictedFiles.length > 0) return "conflict";
  if (s.dirty || s.ahead > 0) return "dirty";
  return "clean";
}

/** A human-readable detail line for a sync outcome, or null when none is needed. */
export function outcomeMessage(outcome: SyncOutcome): string | null {
  switch (outcome.kind) {
    case "needsSetup":
      return outcome.reason;
    case "authMissing":
      return "GitHub authentication failed — run `gh auth login`.";
    case "offline":
      return "Couldn't reach GitHub — will retry.";
    case "pushRejected":
      return "The remote has newer changes; will reconcile on the next sync.";
    case "conflict":
      return "Merge conflict — resolve it in git, then sync again.";
    case "clean":
    case "synced":
      return null;
  }
}
