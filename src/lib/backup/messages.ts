import type { SyncOutcome, SyncStatus } from "@/lib/types";

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
