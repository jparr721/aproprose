// project-store.ts — the open project, its chapters/blocks, edits, save & compile.
//
// Multi-project support is the central invariant: opening a project WIPES all
// prior state (blocks, selection, compile output) and loads the new one. The
// user's manuscript on disk is the source of truth; blocks are a parsed view and
// only dirty blocks are re-serialized on save, so unedited content is preserved
// byte-for-byte.

import { create } from "zustand";
import { toast } from "sonner";
import type {
  Block,
  BlockType,
  ChapterRef,
  ChapterStatus,
  Character,
  CompileError,
  LoreEntry,
  NovelMetadata,
  ProjectInfo,
  ProjectMeta,
  RecentProject,
  SkeletonModel,
} from "@/lib/types";
import {
  countWords,
  parseChapter,
  serializeChapter,
} from "@/lib/latex";
import {
  compileProject,
  createProject as createProjectCmd,
  deleteChapterCmd,
  migrateToManaged,
  openProject as openProjectCmd,
  pickProjectDir,
  readAppData,
  readPdf,
  readProjectMeta,
  readTextFile,
  writeAppData,
  writeProjectMeta,
  writeSkeleton,
  writeTextFile,
} from "@/lib/tauri";
import { uid } from "@/lib/id";
import { pathHash } from "@/lib/path-hash";
import { useSyncStore } from "@/stores/sync-store";
import { useViewStore } from "@/stores/view-store";
import { isNoOp, planCarve, planSplit } from "@/lib/blocks/carve";

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

/** The state reset applied whenever we begin loading a project. */
const LOADING_RESET = {
  status: "loading" as const,
  project: null,
  meta: EMPTY_META,
  needsMigration: null,
  activeChapterId: null,
  blocks: [],
  selectedId: null,
  selectedIds: [],
  editing: false,
  editCaret: null,
  chapterDirty: false,
  compile: EMPTY_COMPILE,
  error: null,
  past: [],
  future: [],
  lastTextEditId: null,
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
  /** Set when an opened folder is a legacy project that needs conversion. */
  needsMigration: { root: string; mainFile: string; detectedChapters: number } | null;

  activeChapterId: string | null;
  blocks: Block[];
  /** The highlighted block, or null. "Selected" means highlighted, not editing. */
  selectedId: string | null;
  /**
   * The multi-block selection set (Cmd/Ctrl-click), in selection order. Empty in
   * the normal single-selection case; populated only when the user has explicitly
   * multi-selected. When non-empty, `selectedId` is the active member (the most
   * recently toggled block). Plain selection, deselection, and nav clear it.
   */
  selectedIds: string[];
  /**
   * Whether the selected block's textarea has the caret (edit mode). Selection
   * and editing are distinct states: a block can be selected (nav mode) without
   * its prose being swapped for a textarea. Invariant: `editing ⇒ selectedId != null`.
   */
  editing: boolean;
  /**
   * One-shot caret request consumed by the editing block's textarea on mount:
   * `"start"` places the caret at the beginning (used by `i` / new-block insert);
   * `null` leaves the native caret (click-to-edit lands it at the click point).
   */
  editCaret: "start" | null;
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
  createProject: (parent: string, name: string, author: string) => Promise<void>;
  addChapter: (title: string) => Promise<void>;
  renameChapter: (id: string, title: string) => Promise<void>;
  moveChapter: (id: string, dir: -1 | 1) => Promise<void>;
  deleteChapter: (id: string) => Promise<void>;
  updateMetadata: (fields: Partial<NovelMetadata>) => Promise<void>;
  migrateProject: () => Promise<void>;
  cancelMigration: () => void;

  // block selection / editing (the nav vs edit modal model)
  select: (id: string | null) => void;
  /** Cmd/Ctrl-click: add or remove `id` from the multi-selection set, seeding it
   *  from the current single selection. Never enters edit mode. */
  toggleSelection: (id: string) => void;
  /** Enter edit mode on the selected block (no-op if nothing is selected). */
  beginEdit: (caret?: "start") => void;
  /** Leave edit mode but keep the block highlighted (nav mode). */
  stopEdit: () => void;
  /** Clear the selection entirely. */
  deselect: () => void;
  /** Move the highlight to the prev/next block in nav mode, clamped at the ends. */
  moveSelection: (dir: -1 | 1) => void;
  updateBlockText: (id: string, text: string) => void;
  formatBlockText: (id: string, text: string) => void;
  /** Apply several text edits as a SINGLE undo step (AI "Accept all"). */
  applyBlockEdits: (edits: { id: string; text: string }[]) => void;
  updateBlock: (id: string, patch: Partial<Block>) => void;
  changeType: (id: string, type: BlockType) => void;
  changeSpeaker: (id: string, speaker: string) => void;
  insertAfter: (afterId: string | null, partial?: Partial<Block>) => string;
  splitBlock: (id: string, at: number) => void;
  convertSelection: (id: string, start: number, end: number, type: BlockType) => void;
  deleteBlock: (id: string) => void;
  moveBlock: (id: string, dir: -1 | 1) => void;
  /** Drag-reorder: move `fromId` to where `toId` currently sits (arrayMove). */
  reorderBlock: (fromId: string, toId: string) => void;

  // history (undo/redo of the block list within the current chapter)
  past: HistoryEntry[];
  future: HistoryEntry[];
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

/** A history snapshot: the block list plus the selection active at capture time,
 *  so undo/redo restore the user's place instead of guessing it. */
interface HistoryEntry {
  blocks: Block[];
  selectedId: string | null;
}

const capPush = (stack: HistoryEntry[], snapshot: HistoryEntry): HistoryEntry[] =>
  [...stack, snapshot].slice(-HISTORY_CAP);

function notifyBuildFailed(errorCount: number): void {
  toast.error(
    errorCount > 0
      ? `Build failed - ${errorCount} error${errorCount === 1 ? "" : "s"}`
      : "Build failed",
    {
      description: "Open the build log to see the details.",
      action: {
        label: "View",
        onClick: () => useViewStore.getState().setBuildErrorsOpen(true),
      },
    },
  );
}

export const useProjectStore = create<ProjectState>((set, get) => {
  // Writes are cheap and infrequent, so persist eagerly (no debounce).
  const persistMeta = (meta: ProjectMeta) => {
    const project = get().project;
    if (project)
      void writeProjectMeta(project.root, JSON.stringify(meta)).catch((e) => {
        toast.error("Couldn't save project metadata", { description: String(e) });
      });
  };

  const persistRecents = (recents: RecentProject[]) => {
    void writeAppData(RECENTS_KEY, recents).catch((e) => {
      toast.error("Couldn't save recent projects", { description: String(e) });
    });
  };

  // Shared tail of loading a ready project (used by loadProjectAt + migrate +
  // create): record recents, remember for relaunch, select first chapter, PDF.
  const finishLoad = async (root: string, project: ProjectInfo) => {
    // Metadata now lives in the repo (.aproprose/meta.json) so it's backed up.
    // In-repo metadata wins; a corrupt meta.json must not brick the open — fall
    // back to the legacy app-config record (or empty), migrating that record into
    // the repo once when no in-repo file exists yet.
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
      if (legacy && !inRepo) await writeProjectMeta(root, JSON.stringify(legacy));
    }

    const entry: RecentProject = { root, name: project.name, openedAt: Date.now() };
    const recents = [entry, ...get().recents.filter((r) => r.root !== root)].slice(0, 12);
    persistRecents(recents);
    void writeAppData(LAST_PROJECT_KEY, root);
    set({ project, meta, recents, status: "ready", needsMigration: null, error: null });
    void useSyncStore.getState().init(root);

    const first = project.chapters[0];
    if (first) await get().selectChapter(first.id);

    const pdfName = project.mainFile.replace(/\.tex$/i, ".pdf");
    const pdfBase64 = await readPdf(root, pdfName).catch((e) => {
      if (import.meta.env.DEV) console.warn(`readPdf(${pdfName}) failed:`, e);
      return null;
    });
    if (pdfBase64) set((s) => ({ compile: { ...s.compile, pdfBase64 } }));
  };

  /** Build a regeneration model from the current project (order-preserving). */
  const toModel = (project: ProjectInfo): SkeletonModel => ({
    metadata: project.metadata,
    chapters: project.chapters.map((c) => ({ title: c.title, file: c.file })),
  });

  return {
    status: "empty",
    project: null,
    meta: EMPTY_META,
    recents: [],
    needsMigration: null,
    activeChapterId: null,
    blocks: [],
    selectedId: null,
    selectedIds: [],
    editing: false,
    editCaret: null,
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
      set(LOADING_RESET);
      try {
        const outcome = await openProjectCmd(root);
        if (outcome.status === "needsMigration") {
          set({
            status: "empty",
            needsMigration: {
              root,
              mainFile: outcome.mainFile ?? "main.tex",
              detectedChapters: outcome.detectedChapters ?? 0,
            },
          });
          return;
        }
        if (!outcome.project) {
          throw new Error("managed project returned without data");
        }
        await finishLoad(root, outcome.project);
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
        needsMigration: null,
        activeChapterId: null,
        blocks: [],
        selectedId: null,
        selectedIds: [],
        editing: false,
        editCaret: null,
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
          // Highlight the last block in nav mode — no caret/autofocus on load.
          selectedId: blocks.length ? blocks[blocks.length - 1].id : null,
          selectedIds: [],
          editing: false,
          editCaret: null,
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

    createProject: async (parent, name, author) => {
      set(LOADING_RESET);
      try {
        const metadata: NovelMetadata = {
          title: name,
          subtitle: "",
          author,
          publisher: "",
          isbn: "",
        };
        const project = await createProjectCmd(parent, name, metadata);
        await finishLoad(project.root, project);
      } catch (e) {
        toast.error("Couldn't create the project", { description: String(e) });
        set({ status: "empty", error: String(e) });
      }
    },

    addChapter: async (title) => {
      const { project } = get();
      if (!project) return;
      const model = toModel(project);
      model.chapters.push({ title, file: null });
      try {
        const updated = await writeSkeleton(project.root, model);
        set({ project: updated });
        const created = updated.chapters[updated.chapters.length - 1];
        if (created) await get().selectChapter(created.id);
      } catch (e) {
        toast.error("Couldn't add the chapter", { description: String(e) });
        set({ error: String(e) });
      }
    },

    renameChapter: async (id, title) => {
      const { project } = get();
      if (!project) return;
      const idx = project.chapters.findIndex((c) => c.id === id);
      if (idx < 0) return;
      const model = toModel(project);
      model.chapters[idx] = { ...model.chapters[idx], title };
      try {
        const updated = await writeSkeleton(project.root, model);
        set({ project: updated });
      } catch (e) {
        toast.error("Couldn't rename the chapter", { description: String(e) });
        set({ error: String(e) });
      }
    },

    moveChapter: async (id, dir) => {
      const { project } = get();
      if (!project) return;
      const idx = project.chapters.findIndex((c) => c.id === id);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= project.chapters.length) return;
      const model = toModel(project);
      const [m] = model.chapters.splice(idx, 1);
      model.chapters.splice(to, 0, m);
      try {
        const updated = await writeSkeleton(project.root, model);
        set({ project: updated });
      } catch (e) {
        toast.error("Couldn't reorder chapters", { description: String(e) });
        set({ error: String(e) });
      }
    },

    deleteChapter: async (id) => {
      const { project, activeChapterId } = get();
      if (!project) return;
      const idx = project.chapters.findIndex((c) => c.id === id);
      if (idx < 0) return;
      const file = project.chapters[idx].file;
      const model = toModel(project);
      model.chapters.splice(idx, 1);
      try {
        const updated = await deleteChapterCmd(project.root, model, file);
        set({ project: updated });
        if (activeChapterId === id) {
          const first = updated.chapters[0];
          if (first) await get().selectChapter(first.id);
          else set({ activeChapterId: null, blocks: [], selectedId: null, selectedIds: [], editing: false, editCaret: null });
        }
      } catch (e) {
        toast.error("Couldn't delete the chapter", { description: String(e) });
        set({ error: String(e) });
      }
    },

    updateMetadata: async (fields) => {
      const { project } = get();
      if (!project) return;
      const model = toModel(project);
      model.metadata = { ...project.metadata, ...fields };
      try {
        const updated = await writeSkeleton(project.root, model);
        set({ project: updated });
      } catch (e) {
        toast.error("Couldn't save project settings", { description: String(e) });
        set({ error: String(e) });
      }
    },

    migrateProject: async () => {
      const nm = get().needsMigration;
      if (!nm) return;
      set(LOADING_RESET);
      try {
        const project = await migrateToManaged(nm.root);
        await finishLoad(project.root, project);
      } catch (e) {
        // Restore the migration prompt so the user can retry without reopening.
        toast.error("Migration failed", { description: String(e) });
        set({ status: "empty", error: String(e), needsMigration: nm });
      }
    },

    cancelMigration: () => set({ needsMigration: null }),

    // Selecting always lands in nav mode — highlighted, not editing. Click-to-edit
    // and `i` promote to edit mode explicitly via beginEdit. A plain select also
    // collapses any active multi-selection back to this single block.
    select: (id) => set({ selectedId: id, selectedIds: [], editing: false, editCaret: null }),

    // Cmd/Ctrl-click toggles a block in/out of the multi-selection. The set is
    // seeded from the current single selection so the first toggle folds the
    // already-highlighted block in (Finder-style). The active block follows the
    // toggle: the clicked block when adding; the last surviving member when the
    // active block itself is removed (or null once the set empties).
    toggleSelection: (id) =>
      set((s) => {
        const base = s.selectedIds.length > 0
          ? s.selectedIds
          : s.selectedId
            ? [s.selectedId]
            : [];
        const has = base.includes(id);
        const selectedIds = has ? base.filter((x) => x !== id) : [...base, id];
        const selectedId = has
          ? id === s.selectedId
            ? selectedIds[selectedIds.length - 1] ?? null
            : s.selectedId
          : id;
        return { selectedIds, selectedId, editing: false, editCaret: null };
      }),

    beginEdit: (caret) =>
      set((s) => {
        if (!s.selectedId) return {};
        const block = s.blocks.find((b) => b.id === s.selectedId);
        if (!block) return {};
        // Editing is single-block: entering edit mode dismisses any multi-selection.
        return { editing: true, editCaret: caret ?? null, selectedIds: [] };
      }),

    stopEdit: () => set({ editing: false, editCaret: null }),

    deselect: () => set({ selectedId: null, selectedIds: [], editing: false, editCaret: null }),

    moveSelection: (dir) =>
      set((s) => {
        if (!s.selectedId) return {};
        const idx = s.blocks.findIndex((b) => b.id === s.selectedId);
        if (idx < 0) return {};
        const to = idx + dir;
        if (to < 0 || to >= s.blocks.length) return {}; // clamp at the ends, no wrap
        // Arrow-key nav is a single-block move; collapse any multi-selection.
        return { selectedId: s.blocks[to].id, selectedIds: [], editing: false, editCaret: null };
      }),

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
          past: startGroup
            ? capPush(s.past, { blocks: s.blocks, selectedId: s.selectedId })
            : s.past,
          future: startGroup ? [] : s.future,
          lastTextEditId: id,
        };
      }),

    // Like updateBlockText but always its own undo step - a format toggle should
    // undo cleanly, not fold into the run of typing that preceded it.
    formatBlockText: (id, text) =>
      set((s) => ({
        blocks: s.blocks.map((b) => (b.id === id ? { ...b, text, dirty: true } : b)),
        chapterDirty: true,
        past: capPush(s.past, { blocks: s.blocks, selectedId: s.selectedId }),
        future: [],
        lastTextEditId: null,
      })),

    // Apply a batch of text edits as ONE undo step, so an AI "Accept all" backs
    // out with a single undo instead of N (one per touched block).
    applyBlockEdits: (edits) =>
      set((s) => {
        if (edits.length === 0) return {};
        const byId = new Map(edits.map((e) => [e.id, e.text]));
        return {
          blocks: s.blocks.map((b) => {
            const text = byId.get(b.id);
            return text !== undefined ? { ...b, text, dirty: true } : b;
          }),
          chapterDirty: true,
          past: capPush(s.past, { blocks: s.blocks, selectedId: s.selectedId }),
          future: [],
          lastTextEditId: null,
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
          past: startGroup
            ? capPush(s.past, { blocks: s.blocks, selectedId: s.selectedId })
            : s.past,
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
        past: capPush(s.past, { blocks: s.blocks, selectedId: s.selectedId }),
        future: [],
        lastTextEditId: null,
      })),

    changeSpeaker: (id, speaker) =>
      set((s) => ({
        blocks: s.blocks.map((b) =>
          b.id === id ? { ...b, speaker, dirty: true } : b,
        ),
        chapterDirty: true,
        past: capPush(s.past, { blocks: s.blocks, selectedId: s.selectedId }),
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
          // A freshly inserted block is ready to type into, caret at the start.
          // Entering edit mode dismisses any multi-selection (single-block edit).
          selectedIds: [],
          editing: true,
          editCaret: "start",
          chapterDirty: true,
          past: capPush(s.past, { blocks: s.blocks, selectedId: s.selectedId }),
          future: [],
          lastTextEditId: null,
        };
      });
      return id;
    },

    splitBlock: (id, at) =>
      set((s) => {
        const idx = s.blocks.findIndex((b) => b.id === id);
        if (idx < 0) return {};
        const plan = planSplit(s.blocks[idx], at);
        if (isNoOp(plan, s.blocks[idx])) return {}; // caret at an edge — nothing to do
        const next = [...s.blocks];
        next.splice(idx, 1, ...plan.blocks);
        return {
          blocks: next,
          selectedId: plan.focusId,
          // Splitting happens mid-edit; stay in edit mode on the focused piece.
          // Editing is single-block, so dismiss any multi-selection.
          selectedIds: [],
          editing: true,
          editCaret: null,
          chapterDirty: true,
          past: capPush(s.past, { blocks: s.blocks, selectedId: s.selectedId }),
          future: [],
          lastTextEditId: null,
        };
      }),

    convertSelection: (id, start, end, type) =>
      set((s) => {
        const idx = s.blocks.findIndex((b) => b.id === id);
        if (idx < 0) return {};
        const plan = planCarve(s.blocks[idx], start, end, type);
        // No-op only when the plan handed back the original block untouched.
        if (isNoOp(plan, s.blocks[idx])) return {};
        const next = [...s.blocks];
        next.splice(idx, 1, ...plan.blocks);
        return {
          blocks: next,
          selectedId: plan.focusId,
          // Carving happens mid-edit; stay in edit mode on the carved piece.
          // Editing is single-block, so dismiss any multi-selection.
          selectedIds: [],
          editing: true,
          editCaret: null,
          chapterDirty: true,
          past: capPush(s.past, { blocks: s.blocks, selectedId: s.selectedId }),
          future: [],
          lastTextEditId: null,
        };
      }),

    deleteBlock: (id) =>
      set((s) => {
        const idx = s.blocks.findIndex((b) => b.id === id);
        const blocks = s.blocks.filter((b) => b.id !== id);
        // Keep the multi-selection in lockstep with the block list: drop the
        // deleted id so the set never references a block that no longer exists.
        const selectedIds = s.selectedIds.filter((x) => x !== id);
        const selectedId =
          s.selectedId === id
            ? // Deleting the active block: keep the active pointer on a surviving
              // member of the set if one remains, else the document neighbour.
              (selectedIds[selectedIds.length - 1] ?? blocks[Math.max(0, idx - 1)]?.id ?? null)
            : s.selectedId;
        return {
          blocks,
          selectedId,
          selectedIds,
          // After a delete the neighbour is highlighted in nav mode, not editing.
          editing: false,
          editCaret: null,
          chapterDirty: true,
          past: capPush(s.past, { blocks: s.blocks, selectedId: s.selectedId }),
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
          past: capPush(s.past, { blocks: s.blocks, selectedId: s.selectedId }),
          future: [],
          lastTextEditId: null,
        };
      }),

    // Drag-reorder via @dnd-kit: drop `fromId` onto `toId`'s slot. Mirrors
    // arrayMove (remove, then insert at the target's original index) and keeps
    // the moved block selected. Like moveBlock, reordering changes emitted
    // output even for clean blocks, so the chapter is marked dirty.
    reorderBlock: (fromId, toId) =>
      set((s) => {
        if (fromId === toId) return {};
        const from = s.blocks.findIndex((b) => b.id === fromId);
        const to = s.blocks.findIndex((b) => b.id === toId);
        if (from < 0 || to < 0 || from === to) return {};
        const next = [...s.blocks];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return {
          blocks: next,
          selectedId: fromId,
          // A dropped block is highlighted in nav mode, not editing.
          editing: false,
          editCaret: null,
          chapterDirty: true,
          past: capPush(s.past, { blocks: s.blocks, selectedId: s.selectedId }),
          future: [],
          lastTextEditId: null,
        };
      }),

    undo: () =>
      set((s) => {
        if (s.past.length === 0) return {};
        const prev = s.past[s.past.length - 1];
        return {
          blocks: prev.blocks,
          selectedId: prev.selectedId,
          past: s.past.slice(0, -1),
          future: capPush(s.future, { blocks: s.blocks, selectedId: s.selectedId }),
          chapterDirty: true,
          lastTextEditId: null,
          // Undo restores the captured selection (above) but always lands in nav
          // mode - highlighted, not editing - and single-block, so collapse any
          // multi-selection (history snapshots only the single selectedId).
          selectedIds: [],
          editing: false,
          editCaret: null,
        };
      }),

    redo: () =>
      set((s) => {
        if (s.future.length === 0) return {};
        const next = s.future[s.future.length - 1];
        return {
          blocks: next.blocks,
          selectedId: next.selectedId,
          future: s.future.slice(0, -1),
          past: capPush(s.past, { blocks: s.blocks, selectedId: s.selectedId }),
          chapterDirty: true,
          lastTextEditId: null,
          // Redo restores the captured selection (above) but always lands in nav
          // mode - highlighted, not editing - and single-block, so collapse any
          // multi-selection (history snapshots only the single selectedId).
          selectedIds: [],
          editing: false,
          editCaret: null,
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
        set((s) => {
          // parseChapter re-mints every block id, so map the selection onto the
          // reparsed blocks by position to keep the user's place (and not strand
          // the Edit scope on dead ids). Out-of-range maps drop out.
          const remap = (id: string): string | null => {
            const i = s.blocks.findIndex((b) => b.id === id);
            return i >= 0 && i < reparsed.length ? reparsed[i].id : null;
          };
          const selectedId = s.selectedId ? remap(s.selectedId) : null;
          const selectedIds = s.selectedIds
            .map(remap)
            .filter((id): id is string => id !== null);
          return {
            blocks: reparsed,
            selectedId,
            selectedIds,
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
          };
        });
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
        if (!result.ok) notifyBuildFailed(result.errors.length);
      } catch (e) {
        set((s) => ({
          compile: {
            ...s.compile,
            status: "error",
            log: String(e),
            errors: [],
            durationMs: 0,
            at: Date.now(),
          },
          error: String(e),
        }));
        notifyBuildFailed(0);
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
