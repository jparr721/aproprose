// sync-store.ts — owns the backup timer and sync status for the open project.
// The atomic git sequence lives in Rust (sync_project); this store schedules it,
// guards against overlap, and exposes status to the chrome. Per-project prefs
// (autoSync, interval) persist in the app config dir keyed by a path hash.

import { reportNotification } from "@/lib/notifications";
import type { AppNotificationType } from "@/lib/notification-model";
import { create } from "zustand";
import { clamp, isEqual } from "es-toolkit";
import type { ChangedFile, RepoStatus, SyncPrefs, SyncStatus } from "@/lib/types";
import { gitRepoStatus, syncProject, readAppData, writeAppData } from "@/lib/tauri";
import { pathHash } from "@/lib/path-hash";
import { backupMessage, deriveIdleStatus, outcomeMessage, outcomeToStatus } from "@/lib/backup/messages";
import { noteProjectRemoteChanges, queueProjectOperation, type ProjectSyncSnapshot } from "@/lib/project-operations";
import { useProjectStore } from "@/stores/project-store";

const DEFAULT_PREFS: SyncPrefs = { autoSync: false, intervalMinutes: 10 };
const prefsKey = (root: string) => `sync-${pathHash(root)}`;

// How often to re-read local git status so the chrome reflects on-disk edits
// without a manual check. Local `git status` is offline and cheap, so this runs
// continuously while a project is open, independent of auto-sync.
export const STATUS_POLL_MS = 5_000;

interface SyncState {
  lifecycleGeneration: number;
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
  let statusReadOwner: object | null = null;

  // The RepoStatus we last wrote. A poll whose status is deeply equal is a no-op,
  // so we skip the write entirely — keeping every array ref stable so the 5s tick
  // doesn't re-render subscribers. Reset on teardown (and thus on project switch,
  // since init() tears down first).
  let lastStatus: RepoStatus | null = null;

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
    const { root, autoSync, intervalMinutes, lifecycleGeneration } = get();
    if (root) void writeAppData(prefsKey(root), { autoSync, intervalMinutes } satisfies SyncPrefs).catch((error: unknown) => {
      if (get().lifecycleGeneration === lifecycleGeneration && get().root === root) set({ lastError: `Couldn't save backup preferences: ${String(error)}`, status: "error" });
    });
  };

  return {
    lifecycleGeneration: 0,
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
      const generation = get().lifecycleGeneration;
      const current = (): boolean => get().lifecycleGeneration === generation && get().root === root;
      set({
        root,
        autoSync: DEFAULT_PREFS.autoSync,
        intervalMinutes: DEFAULT_PREFS.intervalMinutes,
        lastError: null,
      });
      let stored: SyncPrefs | null;
      try {
        stored = await readAppData<SyncPrefs>(prefsKey(root));
      } catch (error) {
        if (current()) set({ status: "error", lastError: `Couldn't read backup preferences: ${String(error)}` });
        return;
      }
      if (!current()) return;
      set({
        prefsKnown: stored != null,
        autoSync: stored?.autoSync ?? DEFAULT_PREFS.autoSync,
        intervalMinutes: stored?.intervalMinutes ?? DEFAULT_PREFS.intervalMinutes,
        lastError: null,
      });
      await get().refreshStatus();
      if (!current()) return;
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
      statusReadOwner = null;
      lastStatus = null;
      set({
        lifecycleGeneration: get().lifecycleGeneration + 1,
        root: null, prefsKnown: true, status: "disabled", isRepo: false, remoteUrl: null,
        lastSyncedAt: null, lastError: null, changedFiles: [], conflictedFiles: [],
        inFlight: false, timer: null, statusTimer: null,
      });
    },

    refreshStatus: async () => {
      const { root, lifecycleGeneration } = get();
      if (!root || statusReadOwner !== null) return;
      const readOwner = {};
      statusReadOwner = readOwner;
      const epoch = get().syncEpoch;
      // This snapshot is only safe to write if nothing authoritative changed during
      // the read: a sync that ran/started (epoch moved or inFlight) owns the status
      // and the file lists, and a project switch (root moved) makes our read stale.
      const stale = () => get().lifecycleGeneration !== lifecycleGeneration || get().root !== root || get().syncEpoch !== epoch || get().inFlight;
      try {
        let s: RepoStatus;
        try {
          s = await gitRepoStatus(root);
        } catch (e) {
          if (stale()) return;
          console.error("Backup status failed", { root, error: e });
          reportNotification({ type: "backup-status", source: "Backup", projectRoot: root, provider: null });
          set({ status: "error", lastError: String(e) });
          return;
        }
        if (stale()) return;
        // Everything set() writes is a function of `s` (or of prev.status, which is
        // unchanged on a poll), so a deeply-equal snapshot means an identical write.
        // Bail before set() so all refs stay stable and the tick is invisible.
        if (lastStatus && isEqual(lastStatus, s)) return;
        lastStatus = s;
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
        if (statusReadOwner === readOwner) statusReadOwner = null;
      }
    },

    syncNow: async () => {
      const { root, inFlight, lifecycleGeneration } = get();
      if (!root || inFlight) return;
      const current = (): boolean => get().lifecycleGeneration === lifecycleGeneration && get().root === root;
      set((p) => ({ inFlight: true, status: "syncing", lastError: null, syncEpoch: p.syncEpoch + 1 }));
      try {
        const result = await queueProjectOperation(root, async () => {
          if (!current()) return null;
          const project = useProjectStore.getState();
          const beforePull: ProjectSyncSnapshot = {
            lifecycleGeneration: project.lifecycleGeneration,
            editRevision: project.editRevision,
            meta: project.meta,
          };
          const synced = await syncProject(root, backupMessage(new Date()));
          if (synced.changedFiles === null || synced.changedFiles.length > 0) noteProjectRemoteChanges(root);
          if (!current()) return null;
          await useProjectStore.getState().reconcileRemoteChanges(root, synced.changedFiles, beforePull);
          return synced;
        });
        if (result === null || !current()) return;
        const { outcome } = result;
        const status = outcomeToStatus(outcome);
        if (outcome.kind !== "clean" && outcome.kind !== "synced" && get().root === root) {
          const types = { conflict: "backup-conflict", pushRejected: "backup-rejected", needsSetup: "backup-setup", authMissing: "backup-auth", offline: "backup-offline", error: "backup-sync" } satisfies Record<typeof outcome.kind, AppNotificationType>;
          reportNotification({ type: types[outcome.kind], source: "Backup", projectRoot: root, provider: null });
        }
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
        console.error("Backup sync failed", { root, error: e });
        if (current()) {
          reportNotification({ type: "backup-sync", source: "Backup", projectRoot: root, provider: null });
          set({ status: "error", lastError: String(e) });
        }
      } finally {
        if (!current()) return;
        // Refresh the file lists WITHOUT overwriting the outcome status.
        try {
          const s = await gitRepoStatus(root);
          if (current()) set({
            isRepo: s.isRepo,
            remoteUrl: s.remoteUrl,
            changedFiles: s.changedFiles,
            conflictedFiles: s.conflictedFiles,
          });
        } catch (error) {
          if (current()) set({ lastError: `Couldn't refresh backup status: ${String(error)}` });
        } finally {
          if (current()) set({ inFlight: false });
        }
      }
    },

    setAutoSync: (on) => {
      set({ autoSync: on, prefsKnown: true });
      persistPrefs();
      armTimer();
    },

    setIntervalMinutes: (n) => {
      set({ intervalMinutes: clamp(Math.round(n), 1, 60), prefsKnown: true });
      persistPrefs();
      armTimer();
    },
  };
});
