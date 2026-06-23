// sync-store.ts — owns the backup timer and sync status for the open project.
// The atomic git sequence lives in Rust (sync_project); this store schedules it,
// guards against overlap, and exposes status to the chrome. Per-project prefs
// (autoSync, interval) persist in the app config dir keyed by a path hash.

import { create } from "zustand";
import type { ChangedFile, RepoStatus, SyncPrefs, SyncStatus } from "@/lib/types";
import { gitRepoStatus, syncProject, readAppData, writeAppData } from "@/lib/tauri";
import { pathHash } from "@/lib/path-hash";
import { backupMessage, outcomeToStatus } from "@/lib/backup/messages";

const DEFAULT_PREFS: SyncPrefs = { autoSync: false, intervalMinutes: 10 };
const prefsKey = (root: string) => `sync-${pathHash(root)}`;

interface SyncState {
  root: string | null;
  /** Null until the first-run setup dialog should be offered (git repo, no prefs yet). */
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

  init: (root: string) => Promise<void>;
  teardown: () => void;
  refreshStatus: () => Promise<void>;
  syncNow: () => Promise<void>;
  setAutoSync: (on: boolean) => void;
  setIntervalMinutes: (n: number) => void;
}

function deriveIdleStatus(s: RepoStatus): SyncStatus {
  if (!s.isRepo || !s.hasRemote) return "disabled";
  if (s.conflictedFiles.length > 0) return "conflict";
  if (s.dirty || s.ahead > 0) return "dirty";
  return "clean";
}

export const useSyncStore = create<SyncState>((set, get) => {
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
    },

    teardown: () => {
      const { timer } = get();
      if (timer) clearInterval(timer);
      set({
        root: null, prefsKnown: true, status: "disabled", isRepo: false, remoteUrl: null,
        lastSyncedAt: null, lastError: null, changedFiles: [], conflictedFiles: [],
        inFlight: false, timer: null,
      });
    },

    refreshStatus: async () => {
      const { root } = get();
      if (!root) return;
      const s = await gitRepoStatus(root);
      set({
        isRepo: s.isRepo,
        remoteUrl: s.remoteUrl,
        changedFiles: s.changedFiles,
        conflictedFiles: s.conflictedFiles,
        status: get().inFlight ? "syncing" : deriveIdleStatus(s),
      });
    },

    syncNow: async () => {
      const { root, inFlight } = get();
      if (!root || inFlight) return;
      set({ inFlight: true, status: "syncing", lastError: null });
      try {
        const outcome = await syncProject(root, backupMessage(new Date()));
        const status = outcomeToStatus(outcome);
        set({
          status,
          lastError: outcome.kind === "needsSetup" ? outcome.reason : null,
          lastSyncedAt: status === "synced" || status === "clean" ? Date.now() : get().lastSyncedAt,
        });
        if (outcome.kind === "conflict") {
          // Pause auto-sync until resolved.
          set({ autoSync: false, conflictedFiles: outcome.files });
          armTimer();
        }
      } catch (e) {
        set({ status: "error", lastError: String(e) });
      } finally {
        set({ inFlight: false });
        await get().refreshStatus();
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
