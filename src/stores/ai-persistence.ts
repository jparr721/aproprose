// ai-persistence.ts -- restart-safe, per-project persistence for the AI panel.
//
// The AI panel's live state lives in two in-memory stores: ai-cache-store (the
// Suggest/Critique/Continuity/Cast results) and brainstorm-store (chat threads).
// This module serializes both into one per-project JSON blob (stored by Rust
// under the app config dir, like project metadata) and restores them when the
// project reopens. No SQLite: the data is kilobytes per project.

import { useRef, useEffect } from "react";
import { readAppData, writeAppData } from "@/lib/tauri";
import { pathHash } from "@/lib/path-hash";
import { useAiCacheStore, type AiCacheEntry } from "@/stores/ai-cache-store";
import { useBrainstormStore } from "@/stores/brainstorm-store";
import { useProjectStore } from "@/stores/project-store";
import type { ChatMessage } from "@/lib/types";

export interface PersistedAiState {
  v: 1;
  entries: Record<string, AiCacheEntry>;
  threads: Record<string, ChatMessage[]>;
}

/** Per-project key for the AI-state blob (distinct from the `meta-*` blob). */
export function aiStateKey(root: string): string {
  return `ai-${pathHash(root)}`;
}

/** Serialize the live stores. Only settled results (data != null) are kept, with
 *  transient loading/error normalized so nothing restores mid-flight. */
export function toSnapshot(
  entries: Record<string, AiCacheEntry>,
  threads: Record<string, ChatMessage[]>,
): PersistedAiState {
  const kept: Record<string, AiCacheEntry> = {};
  for (const [key, e] of Object.entries(entries)) {
    if (e && e.data != null) {
      kept[key] = { data: e.data, instruction: e.instruction, loading: false, error: null };
    }
  }
  return { v: 1, entries: kept, threads };
}

/** Inverse of toSnapshot. Tolerant of null / older / malformed blobs read from
 *  disk -- returns empty maps rather than throwing. */
export function fromSnapshot(snapshot: PersistedAiState | null): {
  entries: Record<string, AiCacheEntry>;
  threads: Record<string, ChatMessage[]>;
} {
  if (!snapshot || snapshot.v !== 1) return { entries: {}, threads: {} };
  const entries: Record<string, AiCacheEntry> = {};
  for (const [key, e] of Object.entries(snapshot.entries ?? {})) {
    entries[key] = { data: e.data, instruction: e.instruction, loading: false, error: null };
  }
  return { entries, threads: snapshot.threads ?? {} };
}

/** Clear both AI stores (project closed / switching before a load completes). */
export function resetAiStores(): void {
  useAiCacheStore.getState().reset();
  useBrainstormStore.getState().reset();
}

/** Load a project's saved AI state into the live stores (empty if none). */
export async function loadAiState(root: string): Promise<void> {
  let snapshot: PersistedAiState | null = null;
  try {
    snapshot = await readAppData<PersistedAiState>(aiStateKey(root));
  } catch (e) {
    // A corrupt / unreadable blob (e.g. non-JSON) must not wedge persistence for
    // the whole session: treat it as empty so the load still settles (loadedRoot
    // gets set) and the next save simply overwrites it with good data. Log it so
    // a "my AI panel state vanished" report is at least diagnosable in devtools.
    console.warn("[ai-persistence] failed to load AI state for", root, "-", e);
    snapshot = null;
  }
  const { entries, threads } = fromSnapshot(snapshot);
  useAiCacheStore.getState().hydrate(entries);
  useBrainstormStore.getState().hydrate(threads);
}

/** Write the live stores back to the project's AI-state blob. */
export function saveAiState(root: string): Promise<void> {
  const snapshot = toSnapshot(
    useAiCacheStore.getState().entries,
    useBrainstormStore.getState().threads,
  );
  return writeAppData(aiStateKey(root), snapshot);
}

const SAVE_DEBOUNCE_MS = 400;

/**
 * Mount once (App.tsx). Loads a project's AI state when it opens and debounce-
 * saves on change. The `loadedRoot` guard ensures we never save before the
 * current project's load has settled (which would clobber its file with empties),
 * and that an in-flight load for a previous project can't write under the new one.
 */
export function useAiPersistence(): void {
  const root = useProjectStore((s) => s.project?.root ?? null);
  const loadedRoot = useRef<string | null>(null);

  useEffect(() => {
    loadedRoot.current = null;
    if (root == null) {
      resetAiStores();
      return;
    }
    let cancelled = false;
    void loadAiState(root).then(() => {
      if (!cancelled) loadedRoot.current = root;
    });
    return () => {
      cancelled = true;
    };
  }, [root]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Run a save now, surfacing (rather than silently dropping) a write failure so
    // a lost-state bug is at least diagnosable. The guard is the caller's job.
    const saveNow = () => {
      if (root == null) return;
      void saveAiState(root).catch((e) =>
        console.error("[ai-persistence] failed to save AI state for", root, "-", e),
      );
    };
    // Write a pending debounced save immediately instead of dropping it.
    const flush = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      if (loadedRoot.current === root) saveNow();
    };
    const schedule = () => {
      if (root == null || loadedRoot.current !== root) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        saveNow();
      }, SAVE_DEBOUNCE_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const unsubCache = useAiCacheStore.subscribe(schedule);
    const unsubChat = useBrainstormStore.subscribe(schedule);
    // Best-effort flush when the window is hidden / closing (app quit).
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubCache();
      unsubChat();
      // Persist any pending change before this project's effect tears down (e.g.
      // a project switch/close) instead of dropping the debounced save.
      flush();
    };
  }, [root]);
}
