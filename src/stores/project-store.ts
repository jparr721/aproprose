// project-store.ts — the open project, its chapters/blocks, edits, save & compile.
//
// Multi-project support is the central invariant: opening a project WIPES all
// prior state (blocks, selection, compile output) and loads the new one. The
// user's manuscript on disk is the source of truth; blocks are a parsed view and
// only dirty blocks are re-serialized on save, so unedited content is preserved
// byte-for-byte.

import { create } from "zustand";
import type {
  Block,
  BlockType,
  ChapterRef,
  ChapterStatus,
  Character,
  CompileError,
  LoreEntry,
  ProjectInfo,
  ProjectMeta,
  RecentProject,
} from "@/lib/types";
import {
  countWords,
  parseChapter,
  serializeChapter,
} from "@/lib/latex";
import {
  compileProject,
  openProject as openProjectCmd,
  pickProjectDir,
  readAppData,
  readPdf,
  readProjectMeta,
  readTextFile,
  writeAppData,
  writeProjectMeta,
  writeTextFile,
} from "@/lib/tauri";
import { uid } from "@/lib/id";
import { pathHash } from "@/lib/path-hash";
import { useSyncStore } from "@/stores/sync-store";

type ProjectStatus = "empty" | "loading" | "ready";
type CompileStatus = "idle" | "compiling" | "clean" | "error";

interface CompileState {
  status: CompileStatus;
  pdfBase64: string | null;
  log: string;
  errors: CompileError[];
  durationMs: number;
  /** ms since epoch of the last compile, or null. */
  at: number | null;
}

const EMPTY_META: ProjectMeta = { characters: [], lore: [], statuses: {} };

const EMPTY_COMPILE: CompileState = {
  status: "idle",
  pdfBase64: null,
  log: "",
  errors: [],
  durationMs: 0,
  at: null,
};

const RECENTS_KEY = "recents";
const LAST_PROJECT_KEY = "last-project";

/** Stable, filesystem-safe key for a project's metadata blob. */
function metaKey(root: string): string {
  return `meta-${pathHash(root)}`;
}

interface ProjectState {
  status: ProjectStatus;
  project: ProjectInfo | null;
  meta: ProjectMeta;
  recents: RecentProject[];

  activeChapterId: string | null;
  blocks: Block[];
  selectedId: string | null;
  chapterDirty: boolean;
  saving: boolean;

  compile: CompileState;
  error: string | null;

  // lifecycle
  init: () => Promise<void>;
  openProjectDialog: () => Promise<void>;
  loadProjectAt: (root: string) => Promise<void>;
  closeProject: () => void;

  // chapters
  selectChapter: (id: string) => Promise<void>;

  // block editing
  select: (id: string | null) => void;
  updateBlockText: (id: string, text: string) => void;
  updateBlock: (id: string, patch: Partial<Block>) => void;
  changeType: (id: string, type: BlockType) => void;
  changeSpeaker: (id: string, speaker: string) => void;
  insertAfter: (afterId: string | null, partial?: Partial<Block>) => string;
  deleteBlock: (id: string) => void;
  moveBlock: (id: string, dir: -1 | 1) => void;

  // history (undo/redo of the block list within the current chapter)
  past: Block[][];
  future: Block[][];
  /** The block id of the in-progress text edit, so consecutive typing coalesces
   *  into a single undo step. Null after any structural edit or undo/redo. */
  lastTextEditId: string | null;
  undo: () => void;
  redo: () => void;

  // persistence + build
  saveChapter: () => Promise<void>;
  compileNow: () => Promise<void>;

  // metadata
  /** Adds a character and returns its newly-minted id. */
  addCharacter: (c: Omit<Character, "id">) => string;
  updateCharacter: (id: string, patch: Partial<Character>) => void;
  removeCharacter: (id: string) => void;
  addLore: (title: string) => void;
  setChapterStatus: (id: string, status: ChapterStatus) => void;
}

const HISTORY_CAP = 100;
const capPush = (stack: Block[][], snapshot: Block[]): Block[][] =>
  [...stack, snapshot].slice(-HISTORY_CAP);

export const useProjectStore = create<ProjectState>((set, get) => {
  // Writes are cheap and infrequent, so persist eagerly (no debounce).
  const persistMeta = (meta: ProjectMeta) => {
    const project = get().project;
    if (project) void writeProjectMeta(project.root, JSON.stringify(meta));
  };

  const persistRecents = (recents: RecentProject[]) => {
    void writeAppData(RECENTS_KEY, recents);
  };

  return {
    status: "empty",
    project: null,
    meta: EMPTY_META,
    recents: [],
    activeChapterId: null,
    blocks: [],
    selectedId: null,
    chapterDirty: false,
    saving: false,
    compile: EMPTY_COMPILE,
    error: null,
    past: [],
    future: [],
    lastTextEditId: null,

    init: async () => {
      const recents = (await readAppData<RecentProject[]>(RECENTS_KEY)) ?? [];
      set({ recents });
      // Re-open the last project so a refresh / relaunch lands back in the editor.
      // If it can't be reopened (folder moved or deleted), forget it so the
      // welcome screen doesn't show the same error on every launch.
      const lastRoot = await readAppData<string>(LAST_PROJECT_KEY);
      if (lastRoot) {
        await get().loadProjectAt(lastRoot);
        if (get().status !== "ready") void writeAppData(LAST_PROJECT_KEY, "");
      }
    },

    openProjectDialog: async () => {
      const root = await pickProjectDir();
      if (!root) return;
      await get().loadProjectAt(root);
    },

    loadProjectAt: async (root) => {
      // Wipe everything — this is the multi-project reset.
      set({
        status: "loading",
        project: null,
        meta: EMPTY_META,
        activeChapterId: null,
        blocks: [],
        selectedId: null,
        chapterDirty: false,
        compile: EMPTY_COMPILE,
        error: null,
        past: [],
        future: [],
        lastTextEditId: null,
      });
      try {
        const project = await openProjectCmd(root);
        // Metadata now lives in the repo (.aproprose/meta.json) so it's backed up.
        // First open of a project that predates this: migrate the legacy app-config
        // record into the repo once.
        // In-repo metadata wins; a corrupt/conflicted meta.json must not brick the
        // project open — fall back to the legacy record (or empty) in that case.
        let meta: ProjectMeta;
        const inRepo = await readProjectMeta(root);
        let parsed: ProjectMeta | null = null;
        if (inRepo) {
          try {
            parsed = JSON.parse(inRepo) as ProjectMeta;
          } catch {
            parsed = null;
          }
        }
        if (parsed) {
          meta = parsed;
        } else {
          const legacy = await readAppData<ProjectMeta>(metaKey(root));
          meta = legacy ?? EMPTY_META;
          // Migrate the legacy record into the repo only when there is no in-repo
          // file at all (don't overwrite a present-but-corrupt one).
          if (legacy && !inRepo) await writeProjectMeta(root, JSON.stringify(legacy));
        }

        // Record in recents (most-recent first, de-duped, capped).
        const entry: RecentProject = {
          root,
          name: project.name,
          openedAt: Date.now(),
        };
        const recents = [
          entry,
          ...get().recents.filter((r) => r.root !== root),
        ].slice(0, 12);
        persistRecents(recents);
        // Remember this as the project to auto-reopen on next launch.
        void writeAppData(LAST_PROJECT_KEY, root);

        set({ project, meta, recents, status: "ready" });
        void useSyncStore.getState().init(root);

        // Load the first chapter (if any) and any already-built PDF.
        const first = project.chapters[0];
        if (first) await get().selectChapter(first.id);

        const pdfName = project.mainFile.replace(/\.tex$/i, ".pdf");
        const pdfBase64 = await readPdf(root, pdfName).catch(() => null);
        if (pdfBase64) {
          set((s) => ({ compile: { ...s.compile, pdfBase64 } }));
        }
      } catch (e) {
        set({ status: "empty", error: String(e) });
      }
    },

    closeProject: () => {
      // Explicit close: forget the last project so it isn't auto-reopened.
      void writeAppData(LAST_PROJECT_KEY, "");
      useSyncStore.getState().teardown();
      set({
        status: "empty",
        project: null,
        meta: EMPTY_META,
        activeChapterId: null,
        blocks: [],
        selectedId: null,
        chapterDirty: false,
        compile: EMPTY_COMPILE,
        error: null,
        past: [],
        future: [],
        lastTextEditId: null,
      });
    },

    selectChapter: async (id) => {
      const { project } = get();
      if (!project) return;
      const chapter = project.chapters.find((c) => c.id === id);
      if (!chapter) return;
      try {
        const source = await readTextFile(project.root, chapter.file);
        const blocks = parseChapter(source);
        set({
          activeChapterId: id,
          blocks,
          selectedId: blocks.length ? blocks[blocks.length - 1].id : null,
          chapterDirty: false,
          error: null,
          past: [],
          future: [],
          lastTextEditId: null,
        });
      } catch (e) {
        set({ error: String(e) });
      }
    },

    select: (id) => set({ selectedId: id }),

    // Text edits coalesce: a run of typing in the same block is ONE undo step.
    // The first edit to a block snapshots the prior state; subsequent keystrokes
    // to the same block don't.
    updateBlockText: (id, text) =>
      set((s) => {
        const startGroup = s.lastTextEditId !== id;
        return {
          blocks: s.blocks.map((b) =>
            b.id === id ? { ...b, text, dirty: true } : b,
          ),
          chapterDirty: true,
          past: startGroup ? capPush(s.past, s.blocks) : s.past,
          future: startGroup ? [] : s.future,
          lastTextEditId: id,
        };
      }),

    updateBlock: (id, patch) =>
      set((s) => {
        const startGroup = s.lastTextEditId !== id;
        return {
          blocks: s.blocks.map((b) =>
            b.id === id ? { ...b, ...patch, dirty: true } : b,
          ),
          chapterDirty: true,
          past: startGroup ? capPush(s.past, s.blocks) : s.past,
          future: startGroup ? [] : s.future,
          lastTextEditId: id,
        };
      }),

    // Structural edits are each their own undo step.
    changeType: (id, type) =>
      set((s) => ({
        blocks: s.blocks.map((b) =>
          b.id === id ? { ...b, type, dirty: true } : b,
        ),
        chapterDirty: true,
        past: capPush(s.past, s.blocks),
        future: [],
        lastTextEditId: null,
      })),

    changeSpeaker: (id, speaker) =>
      set((s) => ({
        blocks: s.blocks.map((b) =>
          b.id === id ? { ...b, speaker, dirty: true } : b,
        ),
        chapterDirty: true,
        past: capPush(s.past, s.blocks),
        future: [],
        lastTextEditId: null,
      })),

    insertAfter: (afterId, partial) => {
      const id = uid();
      const block: Block = {
        id,
        type: "narration",
        text: "",
        raw: "",
        dirty: true,
        ...partial,
      };
      set((s) => {
        const idx =
          afterId == null
            ? s.blocks.length - 1
            : s.blocks.findIndex((b) => b.id === afterId);
        const next = [...s.blocks];
        next.splice(idx + 1, 0, block);
        return {
          blocks: next,
          selectedId: id,
          chapterDirty: true,
          past: capPush(s.past, s.blocks),
          future: [],
          lastTextEditId: null,
        };
      });
      return id;
    },

    deleteBlock: (id) =>
      set((s) => {
        const idx = s.blocks.findIndex((b) => b.id === id);
        const blocks = s.blocks.filter((b) => b.id !== id);
        const selectedId =
          s.selectedId === id
            ? (blocks[Math.max(0, idx - 1)]?.id ?? null)
            : s.selectedId;
        return {
          blocks,
          selectedId,
          chapterDirty: true,
          past: capPush(s.past, s.blocks),
          future: [],
          lastTextEditId: null,
        };
      }),

    moveBlock: (id, dir) =>
      set((s) => {
        const idx = s.blocks.findIndex((b) => b.id === id);
        const to = idx + dir;
        if (idx < 0 || to < 0 || to >= s.blocks.length) return {};
        const next = [...s.blocks];
        const [moved] = next.splice(idx, 1);
        next.splice(to, 0, moved);
        // Reordering changes emitted output even for clean blocks; mark them so
        // serialization uses positions consistently.
        return {
          blocks: next,
          chapterDirty: true,
          past: capPush(s.past, s.blocks),
          future: [],
          lastTextEditId: null,
        };
      }),

    undo: () =>
      set((s) => {
        if (s.past.length === 0) return {};
        const prev = s.past[s.past.length - 1];
        const selectedId = prev.some((b) => b.id === s.selectedId)
          ? s.selectedId
          : (prev[prev.length - 1]?.id ?? null);
        return {
          blocks: prev,
          past: s.past.slice(0, -1),
          future: capPush(s.future, s.blocks),
          chapterDirty: true,
          lastTextEditId: null,
          selectedId,
        };
      }),

    redo: () =>
      set((s) => {
        if (s.future.length === 0) return {};
        const next = s.future[s.future.length - 1];
        const selectedId = next.some((b) => b.id === s.selectedId)
          ? s.selectedId
          : (next[next.length - 1]?.id ?? null);
        return {
          blocks: next,
          future: s.future.slice(0, -1),
          past: capPush(s.past, s.blocks),
          chapterDirty: true,
          lastTextEditId: null,
          selectedId,
        };
      }),

    saveChapter: async () => {
      const { project, activeChapterId, blocks, chapterDirty } = get();
      if (!project || !activeChapterId || !chapterDirty) return;
      const chapter = project.chapters.find((c) => c.id === activeChapterId);
      if (!chapter) return;
      set({ saving: true });
      try {
        const source = serializeChapter(blocks);
        await writeTextFile(project.root, chapter.file, source);
        // Re-parse what we wrote so spans reset and the chapter is clean again.
        const reparsed = parseChapter(source);
        const wordCount = countWords(reparsed);
        set((s) => ({
          blocks: reparsed,
          chapterDirty: false,
          saving: false,
          past: [],
          future: [],
          lastTextEditId: null,
          project: s.project
            ? {
                ...s.project,
                chapters: s.project.chapters.map((c) =>
                  c.id === activeChapterId ? { ...c, wordCount } : c,
                ),
              }
            : s.project,
        }));
      } catch (e) {
        set({ saving: false, error: String(e) });
      }
    },

    compileNow: async () => {
      const { project, chapterDirty } = get();
      if (!project) return;
      if (chapterDirty) await get().saveChapter();
      set((s) => ({ compile: { ...s.compile, status: "compiling" } }));
      try {
        const result = await compileProject(project.root, project.mainFile);
        set({
          compile: {
            status: result.ok ? "clean" : "error",
            pdfBase64: result.pdfBase64 ?? get().compile.pdfBase64,
            log: result.log,
            errors: result.errors,
            durationMs: result.durationMs,
            at: Date.now(),
          },
        });
      } catch (e) {
        set((s) => ({
          compile: {
            ...s.compile,
            status: "error",
            log: String(e),
            at: Date.now(),
          },
          error: String(e),
        }));
      }
    },

    addCharacter: (c) => {
      const character: Character = { ...c, id: uid("c") };
      set((s) => {
        const meta = { ...s.meta, characters: [...s.meta.characters, character] };
        persistMeta(meta);
        return { meta };
      });
      return character.id;
    },

    updateCharacter: (id, patch) =>
      set((s) => {
        const meta = {
          ...s.meta,
          characters: s.meta.characters.map((c) =>
            c.id === id ? { ...c, ...patch } : c,
          ),
        };
        persistMeta(meta);
        return { meta };
      }),

    removeCharacter: (id) =>
      set((s) => {
        const meta = {
          ...s.meta,
          characters: s.meta.characters.filter((c) => c.id !== id),
        };
        persistMeta(meta);
        return { meta };
      }),

    addLore: (title) =>
      set((s) => {
        const entry: LoreEntry = { id: uid("l"), title };
        const meta = { ...s.meta, lore: [...s.meta.lore, entry] };
        persistMeta(meta);
        return { meta };
      }),

    setChapterStatus: (id, status) =>
      set((s) => {
        const meta = {
          ...s.meta,
          statuses: { ...s.meta.statuses, [id]: status },
        };
        persistMeta(meta);
        return { meta };
      }),
  };
});

/** Derive a chapter's display status (explicit override, else inferred). */
export function chapterStatus(
  chapter: ChapterRef,
  meta: ProjectMeta,
  activeId: string | null,
): ChapterStatus {
  if (chapter.id === activeId) return "active";
  const override = meta.statuses[chapter.id];
  if (override) return override;
  if (chapter.wordCount > 500) return "draft";
  if (chapter.wordCount > 0) return "outline";
  return "planned";
}
