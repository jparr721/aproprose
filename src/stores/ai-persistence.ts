// ai-persistence.ts -- restart-safe, per-project persistence for the AI panel.
//
// AI state lives in three in-memory stores: generated-result cache, Brainstorm
// threads, and guided-outline sessions. This module serializes them into one
// per-project JSON blob (stored by Rust
// under the app config dir, like project metadata) and restores them when the
// project reopens. No SQLite: the data is kilobytes per project.

import { useRef, useEffect } from "react";
import { readAppData, writeAppData } from "@/lib/tauri";
import { pathHash } from "@/lib/path-hash";
import { useAiCacheStore, type AiCacheEntry } from "@/stores/ai-cache-store";
import { useAiActivityStore } from "@/stores/ai-activity-store";
import { useBrainstormStore } from "@/stores/brainstorm-store";
import { useOutlineGuideStore } from "@/stores/outline-guide-store";
import { useProjectStore } from "@/stores/project-store";
import type { ChatMessage, GuidedOutlineSession } from "@/lib/types";

export interface PersistedAiState {
  v: 3;
  entries: Record<string, AiCacheEntry>;
  threads: Record<string, ChatMessage[]>;
  outlineSessions: Record<string, GuidedOutlineSession>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isChatMessage(value: unknown): value is ChatMessage {
  return isRecord(value)
    && (value.role === "user" || value.role === "assistant")
    && typeof value.content === "string";
}

function isActKind(value: unknown): boolean {
  return value === "setup" || value === "confrontation" || value === "resolution";
}

function isBeatType(value: unknown): boolean {
  return value === "plot-point"
    || value === "inciting"
    || value === "pinch"
    || value === "action"
    || value === "midpoint"
    || value === "climax"
    || value === "resolution";
}

function isGuidedOutlinePlan(value: unknown): value is NonNullable<GuidedOutlineSession["plan"]> {
  if (!isRecord(value)) return false;
  if (
    typeof value.chapterId !== "string"
    || typeof value.summary !== "string"
    || (value.act !== null && !isActKind(value.act))
    || (value.plotPoint !== null && !isBeatType(value.plotPoint))
    || typeof value.premise !== "string"
    || typeof value.goal !== "string"
    || typeof value.conflict !== "string"
    || typeof value.turn !== "string"
    || !isStringArray(value.characterIds)
    || !Array.isArray(value.beats)
  ) {
    return false;
  }
  return value.beats.every((beat) => (
    isRecord(beat)
    && (beat.sourceCardId === null || typeof beat.sourceCardId === "string")
    && typeof beat.title === "string"
    && typeof beat.intention === "string"
    && isStringArray(beat.characterIds)
    && isStringArray(beat.loreIds)
  ));
}

function isGuidedOutlineSession(value: unknown): value is GuidedOutlineSession {
  return isRecord(value)
    && Array.isArray(value.messages)
    && value.messages.every(isChatMessage)
    && (value.plan === null || isGuidedOutlinePlan(value.plan));
}

function validOutlineSessions(value: unknown): Record<string, GuidedOutlineSession> {
  if (!isRecord(value)) return {};
  const sessions: Record<string, GuidedOutlineSession> = {};
  for (const [chapterId, session] of Object.entries(value)) {
    if (isGuidedOutlineSession(session)) sessions[chapterId] = session;
  }
  return sessions;
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
  outlineSessions: Record<string, GuidedOutlineSession>,
): PersistedAiState {
  const kept: Record<string, AiCacheEntry> = {};
  for (const [key, e] of Object.entries(entries)) {
    if (e && e.data != null) {
      kept[key] = {
        data: e.data,
        instruction: e.instruction,
        anchorId: e.anchorId,
        loading: false,
        error: null,
      };
    }
  }
  return { v: 3, entries: kept, threads, outlineSessions };
}

/** Inverse of toSnapshot. Tolerant of null / older / malformed blobs read from
 *  disk -- returns empty maps rather than throwing. v1 blobs keep their chat
 *  threads but drop cached entries: results are regenerable and their data
 *  shapes changed when findings gained block anchors. */
export function fromSnapshot(snapshot: PersistedAiState | null): {
  entries: Record<string, AiCacheEntry>;
  threads: Record<string, ChatMessage[]>;
  outlineSessions: Record<string, GuidedOutlineSession>;
} {
  if (!snapshot) return { entries: {}, threads: {}, outlineSessions: {} };
  // Blobs on disk may predate the current shape; read the version loosely.
  const raw = snapshot as {
    v: number;
    entries?: Record<string, AiCacheEntry>;
    threads?: Record<string, ChatMessage[]>;
    outlineSessions?: Record<string, GuidedOutlineSession>;
  };
  if (raw.v === 1) {
    return { entries: {}, threads: raw.threads ?? {}, outlineSessions: {} };
  }
  if (raw.v !== 2 && raw.v !== 3) {
    return { entries: {}, threads: {}, outlineSessions: {} };
  }
  const entries: Record<string, AiCacheEntry> = {};
  for (const [key, e] of Object.entries(raw.entries ?? {})) {
    entries[key] = {
      data: e.data,
      instruction: e.instruction,
      anchorId: e.anchorId,
      loading: false,
      error: null,
    };
  }
  return {
    entries,
    threads: raw.threads ?? {},
    outlineSessions: raw.v === 3 ? validOutlineSessions(raw.outlineSessions) : {},
  };
}

/** Clear the AI stores (project closed / switching before a load completes). */
export function resetAiStores(): void {
  useAiCacheStore.getState().reset();
  useBrainstormStore.getState().reset();
  useOutlineGuideStore.getState().reset();
  useAiActivityStore.getState().reset();
}

/** Load a project's saved AI state into the live stores (empty if none). */
export async function loadAiState(root: string, canHydrate: () => boolean): Promise<boolean> {
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
  const { entries, threads, outlineSessions } = fromSnapshot(snapshot);
  if (!canHydrate()) return false;
  useAiCacheStore.getState().hydrate(entries);
  useBrainstormStore.getState().hydrate(threads);
  useOutlineGuideStore.getState().hydrate(outlineSessions);
  return true;
}

/** Write the live stores back to the project's AI-state blob. */
export function saveAiState(root: string): Promise<void> {
  const snapshot = toSnapshot(
    useAiCacheStore.getState().entries,
    useBrainstormStore.getState().threads,
    useOutlineGuideStore.getState().sessions,
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
    void loadAiState(root, () => {
      const activeProject = useProjectStore.getState().project;
      return !cancelled && activeProject !== null && activeProject.root === root;
    }).then((hydrated) => {
      if (hydrated) loadedRoot.current = root;
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
    const unsubOutlineGuide = useOutlineGuideStore.subscribe(schedule);
    // Best-effort flush when the window is hidden / closing (app quit).
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubCache();
      unsubChat();
      unsubOutlineGuide();
      // Persist any pending change before this project's effect tears down (e.g.
      // a project switch/close) instead of dropping the debounced save.
      flush();
    };
  }, [root]);
}
