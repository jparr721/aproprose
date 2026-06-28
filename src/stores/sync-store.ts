// sync-store.ts — owns the backup timer and sync status for the open project.
// The atomic git sequence lives in Rust (sync_project); this store schedules it,
// guards against overlap, and exposes status to the chrome. Per-project prefs
// (autoSync, interval) persist in the app config dir keyed by a path hash.

import { create } from "zustand";
import type { ChangedFile, RepoStatus, SyncPrefs, SyncStatus } from "@/lib/types";
import { gitRepoStatus, syncProject, readAppData, writeAppData } from "@/lib/tauri";
import { pathHash } from "@/lib/path-hash";
import { backupMessage, deriveIdleStatus, outcomeMessage, outcomeToStatus } from "@/lib/backup/messages";

const DEFAULT_PREFS: SyncPrefs = { autoSync: false, intervalMinutes: 10 };
const prefsKey = (root: string) => `sync-${pathHash(root)}`;

// How often to re-read local git status so the chrome reflects on-disk edits
// without a manual check. Local `git status` is offline and cheap, so this runs
// continuously while a project is open, independent of auto-sync.
export const STATUS_POLL_MS = 5_000;

interface SyncState {
  root: string | null;
  /** False after init() when this git repo has no stored prefs — drives the first-run setup dialog. */
  prefsKnown: boolean;
  status: SyncStatus;
  isRepo: boolean;
  remoteUrl: string | null;
  lastSyncedAt: number | null;
  autoSync: boolean;
  intervalMinutes: number;
  lastError: string | null;
  changedFiles: ChangedFile[];
  conflictedFiles: string[];
  inFlight: boolean;
  timer: ReturnType<typeof setInterval> | null;
  statusTimer: ReturnType<typeof setInterval> | null;
  /** Bumped whenever a sync begins. A status read whose epoch changed mid-read
   *  is stale (a sync set an authoritative status meanwhile) and must not write. */
  syncEpoch: number;

  init: (root: string) => Promise<void>;
  teardown: () => void;
  refreshStatus: () => Promise<void>;
  syncNow: () => Promise<void>;
  setAutoSync: (on: boolean) => void;
  setIntervalMinutes: (n: number) => void;
}


export const useSyncStore = create<SyncState>((set, get) => {
  // Guards the read-only status operation against overlap from any caller
  // (the poll tick, init, or the review dialog) — one mechanism, all entry points.
  let statusReadInFlight = false;

  // The serialized RepoStatus we last wrote. A poll whose status serializes
  // identically is a no-op, so we skip the write entirely — keeping every array
  // ref stable so the 5s tick doesn't re-render subscribers. Reset on teardown
  // (and thus on project switch, since init() tears down first).
  let lastStatusDigest: string | null = null;

  const armTimer = () => {
    const { timer, autoSync, intervalMinutes } = get();
    if (timer) clearInterval(timer);
    if (!autoSync) {
      set({ timer: null });
      return;
    }
    const ms = Math.max(1, intervalMinutes) * 60_000;
    const handle = setInterval(() => void get().syncNow(), ms);
    set({ timer: handle });
  };

  // Read-only local-status poll, independent of auto-sync, so the indicator
  // tracks on-disk edits live instead of going stale until a manual check.
  // refreshStatus self-guards against overlap, so the tick only screens out the
  // sync case (a running sync refreshes the file lists itself).
  const armStatusTimer = () => {
    const { statusTimer } = get();
    if (statusTimer) clearInterval(statusTimer);
    const handle = setInterval(() => {
      const { root, inFlight } = get();
      if (!root || inFlight) return;
      void get().refreshStatus();
    }, STATUS_POLL_MS);
    set({ statusTimer: handle });
  };

  const persistPrefs = () => {
    const { root, autoSync, intervalMinutes } = get();
    if (root) void writeAppData(prefsKey(root), { autoSync, intervalMinutes } satisfies SyncPrefs);
  };

  return {
    root: null,
    prefsKnown: true,
    status: "disabled",
    isRepo: false,
    remoteUrl: null,
    lastSyncedAt: null,
    autoSync: DEFAULT_PREFS.autoSync,
    intervalMinutes: DEFAULT_PREFS.intervalMinutes,
    lastError: null,
    changedFiles: [],
    conflictedFiles: [],
    inFlight: false,
    timer: null,
    statusTimer: null,
    syncEpoch: 0,

    init: async (root) => {
      get().teardown();
      const stored = await readAppData<SyncPrefs>(prefsKey(root));
      set({
        root,
        prefsKnown: stored != null,
        autoSync: stored?.autoSync ?? DEFAULT_PREFS.autoSync,
        intervalMinutes: stored?.intervalMinutes ?? DEFAULT_PREFS.intervalMinutes,
        lastError: null,
      });
      await get().refreshStatus();
      // Opportunistic sync on open when auto-sync is on.
      if (get().autoSync && get().isRepo && get().remoteUrl) {
        void get().syncNow();
      }
      armTimer();
      armStatusTimer();
    },

    teardown: () => {
      const { timer, statusTimer } = get();
      if (timer) clearInterval(timer);
      if (statusTimer) clearInterval(statusTimer);
      statusReadInFlight = false;
      lastStatusDigest = null;
      set({
        root: null, prefsKnown: true, status: "disabled", isRepo: false, remoteUrl: null,
        lastSyncedAt: null, lastError: null, changedFiles: [], conflictedFiles: [],
        inFlight: false, timer: null, statusTimer: null,
      });
    },

    refreshStatus: async () => {
      const { root } = get();
      if (!root || statusReadInFlight) return;
      statusReadInFlight = true;
      const epoch = get().syncEpoch;
      // This snapshot is only safe to write if nothing authoritative changed during
      // the read: a sync that ran/started (epoch moved or inFlight) owns the status
      // and the file lists, and a project switch (root moved) makes our read stale.
      const stale = () => get().root !== root || get().syncEpoch !== epoch || get().inFlight;
      try {
        let s: RepoStatus;
        try {
          s = await gitRepoStatus(root);
        } catch (e) {
          if (stale()) return;
          set({ status: "error", lastError: String(e) });
          return;
        }
        if (stale()) return;
        // Everything set() writes is a function of `s` (or of prev.status, which is
        // unchanged on a poll), so a byte-identical snapshot means a byte-identical
        // write. Bail before set() so all refs stay stable and the tick is invisible.
        const digest = JSON.stringify(s);
        if (digest === lastStatusDigest) return;
        lastStatusDigest = digest;
        set((prev) => ({
          isRepo: s.isRepo,
          remoteUrl: s.remoteUrl,
          changedFiles: s.changedFiles,
          conflictedFiles: s.conflictedFiles,
          // Don't repaint a terminal failure the sync just set.
          status:
            prev.status === "error" || prev.status === "offline" || prev.status === "needsSetup"
              ? prev.status
              : deriveIdleStatus(s),
        }));
      } finally {
        statusReadInFlight = false;
      }
    },

    syncNow: async () => {
      const { root, inFlight } = get();
      if (!root || inFlight) return;
      set((p) => ({ inFlight: true, status: "syncing", lastError: null, syncEpoch: p.syncEpoch + 1 }));
      try {
        const outcome = await syncProject(root, backupMessage(new Date()));
        const status = outcomeToStatus(outcome);
        set({
          status,
          lastError: outcomeMessage(outcome),
          lastSyncedAt: status === "synced" || status === "clean" ? Date.now() : get().lastSyncedAt,
        });
        if (outcome.kind === "conflict") {
          // Pause auto-sync until resolved.
          set({ autoSync: false, conflictedFiles: outcome.files });
          persistPrefs();
          armTimer();
        }
      } catch (e) {
        set({ status: "error", lastError: String(e) });
      } finally {
        set({ inFlight: false });
        // Refresh the file lists WITHOUT overwriting the outcome status.
        const { root: r } = get();
        if (r) {
          try {
            const s = await gitRepoStatus(r);
            set({
              isRepo: s.isRepo,
              remoteUrl: s.remoteUrl,
              changedFiles: s.changedFiles,
              conflictedFiles: s.conflictedFiles,
            });
          } catch {
            // status already reflects the sync outcome; ignore a refresh failure
          }
        }
      }
    },

    setAutoSync: (on) => {
      set({ autoSync: on, prefsKnown: true });
      persistPrefs();
      armTimer();
    },

    setIntervalMinutes: (n) => {
      set({ intervalMinutes: Math.min(60, Math.max(1, Math.round(n))), prefsKnown: true });
      persistPrefs();
      armTimer();
    },
  };
});
