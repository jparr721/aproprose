// project-store.ts — the open project, its chapters/blocks, edits, save & compile.
//
// Multi-project support is the central invariant: opening a project WIPES all
// prior state (blocks, selection, compile output) and loads the new one. The
// user's manuscript on disk is the source of truth; blocks are a parsed view and
// only dirty blocks are re-serialized on save, so unedited content is preserved
// byte-for-byte.

import { create } from "zustand";
import { sumBy } from "es-toolkit";
import { toast } from "sonner";
import type {
  ActKind,
  BeatType,
  Block,
  BlockTextEdit,
  BlockType,
  Card,
  ChapterRef,
  ChapterStatus,
  Character,
  CharacterProfile,
  CompileError,
  ContinuityFlag,
  LoreEntry,
  NovelMetadata,
  Outline,
  ProjectInfo,
  ProjectMeta,
  RecentProject,
  SkeletonModel,
  SculptProposal,
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
import { useStatsStore } from "@/stores/stats-store";
import { useViewStore } from "@/stores/view-store";
import { deleteOutlineAgentSession } from "@/stores/agent-console-store";
import { isNoOp, planCarve, planSplit } from "@/lib/blocks/carve";
import { carriesTailContent } from "@/lib/blocks/dialogue";
import { canMerge } from "@/lib/blocks/keys";
import { applyProposal } from "@/lib/blocks/proposal";
import { structurePassage } from "@/lib/blocks/structure";
import {
  candidateInputFingerprint,
  chapterTopologyFingerprint,
  characterProfileFingerprint,
  projectMetaFingerprint,
  storyFieldsFingerprint,
  storyOverviewFingerprint,
} from "@/lib/ai/agent-context";
import {
  conflictingTargetChangeIds,
  invalidProposalCorrelationIds,
  materializeManuscriptChanges,
  validateManuscriptChanges,
  validateOutlineChanges,
} from "@/lib/ai/agent-proposals";
import type {
  AgentOutlineApplyResult,
  AgentProposalApplyResult,
  ManuscriptPendingProposal,
  OutlinePendingChange,
  OutlinePendingProposal,
  OutlineUndoToken,
} from "@/lib/ai/agent-types";
import {
  addCard as addCardModel,
  addCharacterToCard as addCharacterToCardModel,
  addCharacterToChapter as addCharacterToChapterModel,
  addLoreToCard as addLoreToCardModel,
  applySculpt as applySculptModel,
  editCard as editCardModel,
  editChapterField,
  editOverview,
  editPremise,
  getChapterOutline,
  moveCardToChapter as moveCardToChapterModel,
  moveCardWithin as moveCardWithinModel,
  removeCard as removeCardModel,
  removeCharacterFromCard as removeCharacterFromCardModel,
  removeCharacterFromChapter as removeCharacterFromChapterModel,
  removeLoreFromCard as removeLoreFromCardModel,
  setCardContinuityFlags as setCardContinuityFlagsModel,
  setChapterAct as setChapterActModel,
  setChapterPlotPoint as setChapterPlotPointModel,
} from "@/lib/outline/model";
import { runMigrations, EMPTY_META } from "@/lib/migration";
import { updateLore, removeLore } from "@/lib/lore/model";
import { DEFAULT_CHARACTER_COLOR } from "@/lib/characters/colors";
import { applyCharacterKnowledgePatch } from "@/lib/story-knowledge/merge";
import { storyChapterFingerprint } from "@/lib/story-knowledge/chunking";
import type {
  StoryRefreshFollowUpReason,
  StoryRefreshResult,
} from "@/lib/story-knowledge/refresh";
import { useStoryRefreshStore } from "@/stores/story-refresh-store";

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

export function defaultOutline(): Outline {
  return { premise: "", overview: "" };
}


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
  saveError: null,
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

/** Stable, filesystem-safe key for a project's last-open chapter (local UI cursor). */
function lastChapterKey(root: string): string {
  return `last-chapter-${pathHash(root)}`;
}

const metaWriteQueues = new Map<string, Promise<void>>();

interface ProjectMetaProvenance {
  root: string;
  lastDurableMeta: ProjectMeta;
}

const projectMetaProvenance = new WeakMap<
  ProjectMeta,
  ProjectMetaProvenance
>();

function inheritProjectMetaProvenance(
  root: string,
  previousMeta: ProjectMeta,
  nextMeta: ProjectMeta,
): ProjectMetaProvenance {
  const previousProvenance = projectMetaProvenance.get(previousMeta);
  const provenance =
    previousProvenance?.root === root
      ? previousProvenance
      : { root, lastDurableMeta: previousMeta };
  projectMetaProvenance.set(previousMeta, provenance);
  projectMetaProvenance.set(nextMeta, provenance);
  return provenance;
}

function queueProjectMetaWrite(
  root: string,
  meta: ProjectMeta,
  provenance: ProjectMetaProvenance,
): Promise<void> {
  const previous = metaWriteQueues.get(root);
  const persist = async (): Promise<void> => {
    await writeProjectMeta(root, JSON.stringify(meta));
    provenance.lastDurableMeta = meta;
  };
  const write = previous
    ? previous
        .catch(() => undefined)
        .then(persist)
    : persist();
  const tracked = write.finally(() => {
    if (metaWriteQueues.get(root) === tracked) {
      metaWriteQueues.delete(root);
    }
  });
  metaWriteQueues.set(root, tracked);
  return tracked;
}

export function drainProjectMetaWrites(root: string): Promise<void> {
  return metaWriteQueues.get(root) ?? Promise.resolve();
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
   * recently toggled block). Plain selection, deselection, nav, entering edit
   * mode, and undo/redo all clear it; structural edits keep it in lockstep with
   * the live block list (prune on delete, remap on save).
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
   * `"start"` places the caret at the beginning (`i` / new-block insert),
   * `"end"` at the end (nav-mode Enter, delete-empty), a number at an exact
   * offset (block merges land at the join point); `null` leaves the native
   * caret (click-to-edit lands it at the click point).
   */
  editCaret: "start" | "end" | number | null;
  chapterDirty: boolean;
  saving: boolean;

  compile: CompileState;
  error: string | null;
  saveError: string | null;

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
  /** Cmd/Ctrl-click: add or remove a *live* block `id` from the multi-selection
   *  set, seeding it from the current single selection. Never enters edit mode. */
  toggleSelection: (id: string) => void;
  /** Enter edit mode on the selected block (no-op if nothing is selected). */
  beginEdit: (caret?: "start" | "end") => void;
  /** Leave edit mode but keep the block highlighted (nav mode). */
  stopEdit: () => void;
  /** Clear the selection entirely. */
  deselect: () => void;
  /** Replace the selection wholesale (nav mode, never edit). Empty = deselect;
   *  a single id selects it plainly; multiple ids become the multi-selection
   *  set with the last id active. */
  setSelection: (ids: string[]) => void;
  /** Move the highlight to the prev/next block in nav mode, clamped at the ends. */
  moveSelection: (dir: -1 | 1) => void;
  updateBlockText: (id: string, text: string) => void;
  formatBlockText: (id: string, text: string) => void;
  /** Apply several text edits as a SINGLE undo step (AI "Accept all"). */
  applyBlockEdits: (edits: BlockTextEdit[]) => void;
  applyAgentManuscriptProposal: (
    proposal: ManuscriptPendingProposal,
    changeIds: string[],
  ) => AgentProposalApplyResult;
  updateBlock: (id: string, patch: Partial<Block>) => void;
  changeType: (id: string, type: BlockType) => void;
  changeSpeaker: (id: string, speaker: string) => void;
  insertAfter: (afterId: string | null, partial?: Partial<Block>) => string;
  splitBlock: (id: string, at: number) => void;
  /** Replace a block with the classified blocks its text yields (paragraphs,
   *  dialogue, chained dialogue). No-op when the text yields one block. */
  structureBlock: (id: string) => void;
  convertSelection: (id: string, start: number, end: number, type: BlockType) => void;
  /**
   * Backspace at a block's start: join its text onto the end of the previous
   * SAME-type block (mergeable types only — see MERGEABLE in lib/blocks/keys)
   * and land the caret at the join point. One undo step. No-op when the pair
   * isn't mergeable or the block carries a beat/title a merge would drop.
   */
  mergeWithPrevious: (id: string) => void;
  deleteBlock: (id: string) => void;
  deleteBlocks: (ids: string[]) => void;
  moveBlock: (id: string, dir: -1 | 1) => void;
  moveBlocks: (ids: string[], dir: -1 | 1) => void;
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
  commitStoryRefresh: (
    result: StoryRefreshResult,
    latestSavedFingerprints: Record<string, string>,
  ) => Promise<{ followUpReasons: StoryRefreshFollowUpReason[] }>;
  applyCharacterProfileFromAgent: (
    projectRoot: string,
    characterId: string,
    profile: CharacterProfile,
  ) => Promise<Character>;
  acceptCharacterCandidate: (candidateId: string) => Promise<string>;
  dismissCharacterCandidate: (candidateId: string) => Promise<void>;
  removeCharacter: (id: string) => void;
  addLore: (title: string) => string;
  updateLore: (id: string, patch: Partial<Pick<LoreEntry, "title" | "description" | "characterIds" | "tags">>) => void;
  removeLore: (id: string) => void;
  setChapterStatus: (id: string, status: ChapterStatus) => void;

  // outline (global)
  setPremise: (premise: string) => void;
  setOverview: (overview: string) => void;
  // cards
  addCard: (chapterId: string) => string;
  removeCard: (chapterId: string, cardId: string) => void;
  editCard: (chapterId: string, cardId: string, patch: { title?: string; intention?: string }) => void;
  moveCardWithin: (chapterId: string, cardId: string, toIndex: number) => void;
  moveCardToChapter: (fromChapterId: string, toChapterId: string, cardId: string, toIndex: number) => void;
  addCharacterToCard: (chapterId: string, cardId: string, characterId: string) => void;
  removeCharacterFromCard: (chapterId: string, cardId: string, characterId: string) => void;
  addLoreToCard: (chapterId: string, cardId: string, loreId: string) => void;
  removeLoreFromCard: (chapterId: string, cardId: string, loreId: string) => void;
  setCardContinuityFlags: (chapterId: string, cardId: string, flags: ContinuityFlag[]) => void;
  // chapter fields
  addCharacterToChapter: (chapterId: string, characterId: string) => void;
  removeCharacterFromChapter: (chapterId: string, characterId: string) => void;
  setChapterAct: (chapterId: string, act: ActKind | null) => void;
  setChapterPlotPoint: (chapterId: string, plotPoint: BeatType | null) => void;
  setChapterField: (chapterId: string, patch: { premise?: string; goal?: string; conflict?: string; turn?: string }) => void;
  applyAgentOutlineProposal: (
    proposal: OutlinePendingProposal,
    changeIds: string[],
  ) => AgentOutlineApplyResult;
  undoAgentOutlineProposal: (token: OutlineUndoToken) => boolean;
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

function invalidSelectedChangeIds(
  proposalChanges: readonly { id: string }[],
  changeIds: readonly string[],
): string[] {
  const proposalCounts = new Map<string, number>();
  for (const change of proposalChanges) {
    proposalCounts.set(change.id, (proposalCounts.get(change.id) ?? 0) + 1);
  }
  const selectedCounts = new Map<string, number>();
  for (const changeId of changeIds) {
    selectedCounts.set(changeId, (selectedCounts.get(changeId) ?? 0) + 1);
  }
  return [
    ...new Set(
      changeIds.filter(
        (changeId) =>
          proposalCounts.get(changeId) !== 1 ||
          selectedCounts.get(changeId) !== 1,
      ),
    ),
  ];
}

interface ManuscriptProposalMutation {
  blocks: Block[];
  selectedId: string | null;
  selectedIds: string[];
  editing: boolean;
  editCaret: "start" | "end" | number | null;
  chapterDirty: true;
  past: HistoryEntry[];
  future: HistoryEntry[];
  lastTextEditId: null;
}

function manuscriptProposalMutation(
  state: ProjectState,
  blocks: Block[],
): ManuscriptProposalMutation {
  const liveIds = new Set(blocks.map((block) => block.id));
  const selectedIds = state.selectedIds.filter((id) => liveIds.has(id));
  const selectionLost =
    state.selectedId !== null && !liveIds.has(state.selectedId);
  const selectedId = selectionLost
    ? selectedIds[selectedIds.length - 1] ?? null
    : state.selectedId;
  return {
    blocks,
    selectedId,
    selectedIds,
    editing: selectionLost ? false : state.editing,
    editCaret: selectionLost ? null : state.editCaret,
    chapterDirty: true,
    past: capPush(state.past, {
      blocks: state.blocks,
      selectedId: state.selectedId,
    }),
    future: [],
    lastTextEditId: null,
  };
}

function sameCardOrder(left: Card[], right: Card[]): boolean {
  return (
    left.length === right.length &&
    left.every((card, index) => card.id === right[index].id)
  );
}

function outlineChangeCanApply(
  change: OutlinePendingChange["change"],
  cards: Card[],
): boolean {
  if (change.kind === "add") return change.cardId === null;
  if (
    change.cardId === null ||
    !cards.some((card) => card.id === change.cardId)
  ) {
    return false;
  }
  if (change.kind === "rewrite") {
    return change.title !== null || change.intention !== null;
  }
  if (change.kind === "move") {
    return change.toIndex !== null && Number.isInteger(change.toIndex);
  }
  return true;
}

function outlineChangeLanded(
  change: OutlinePendingChange["change"],
  before: Card[],
  after: Card[],
): boolean {
  if (change.kind === "add") {
    const added = after[after.length - 1];
    return (
      after.length === before.length + 1 &&
      sameCardOrder(before, after.slice(0, -1)) &&
      added !== undefined &&
      !before.some((card) => card.id === added.id) &&
      added.title === (change.title ?? "") &&
      added.intention === (change.intention ?? "")
    );
  }
  if (change.cardId === null) return false;
  if (change.kind === "remove") {
    return sameCardOrder(
      before.filter((card) => card.id !== change.cardId),
      after,
    );
  }
  if (change.kind === "rewrite") {
    const previous = before.find((card) => card.id === change.cardId);
    const rewritten = after.find((card) => card.id === change.cardId);
    return (
      previous !== undefined &&
      rewritten !== undefined &&
      sameCardOrder(before, after) &&
      rewritten.title === (change.title ?? previous.title) &&
      rewritten.intention === (change.intention ?? previous.intention)
    );
  }
  if (change.toIndex === null) return false;
  const expected = [...before];
  const from = expected.findIndex((card) => card.id === change.cardId);
  if (from < 0) return false;
  const [moved] = expected.splice(from, 1);
  const to = Math.max(0, Math.min(change.toIndex, expected.length));
  expected.splice(to, 0, moved);
  return sameCardOrder(expected, after);
}

function applyOutlineChangesStrict(
  chapters: ProjectMeta["chapters"],
  chapterId: string,
  summary: string,
  changes: OutlinePendingChange[],
): ProjectMeta["chapters"] | null {
  let next = chapters;
  for (const item of changes) {
    const before = getChapterOutline(next, chapterId).cards;
    if (!outlineChangeCanApply(item.change, before)) return null;
    const proposal: SculptProposal = {
      chapterId,
      summary,
      changes: [item.change],
    };
    const candidate = applySculptModel(next, chapterId, proposal, [0]);
    const after = getChapterOutline(candidate, chapterId).cards;
    if (!outlineChangeLanded(item.change, before, after)) return null;
    next = candidate;
  }
  return next;
}

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
    if (project) {
      const provenance = inheritProjectMetaProvenance(
        project.root,
        get().meta,
        meta,
      );
      void queueProjectMetaWrite(project.root, meta, provenance).catch((e) => {
        toast.error("Couldn't save project metadata", { description: String(e) });
      });
    }
  };

  const persistMetaAndWait = async (
    root: string,
    meta: ProjectMeta,
    provenance: ProjectMetaProvenance,
  ): Promise<void> => {
    try {
      await queueProjectMetaWrite(root, meta, provenance);
    } catch (error) {
      toast.error("Couldn't save project metadata", {
        description: String(error),
      });
      throw error;
    }
  };

  const persistOptimisticMeta = async (
    root: string,
    previousMeta: ProjectMeta,
    optimisticMeta: ProjectMeta,
  ): Promise<void> => {
    const provenance = inheritProjectMetaProvenance(
      root,
      previousMeta,
      optimisticMeta,
    );
    set({ meta: optimisticMeta });
    try {
      await persistMetaAndWait(root, optimisticMeta, provenance);
    } catch (error) {
      const current = get();
      if (current.project?.root === root && current.meta === optimisticMeta) {
        set({ meta: provenance.lastDurableMeta });
      }
      throw error;
    }
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
    await drainProjectMetaWrites(root);
    let meta: ProjectMeta;
    const inRepo = await readProjectMeta(root);
    let parsed: unknown = null;
    if (inRepo) {
      try {
        parsed = JSON.parse(inRepo);
      } catch {
        if (import.meta.env.DEV) console.warn("Corrupt meta.json, falling back to legacy storage");
        parsed = null;
      }
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      meta = runMigrations(parsed);
    } else {
      const legacy = await readAppData<ProjectMeta>(metaKey(root));
      meta = runMigrations(legacy ?? null);
      if (legacy && !inRepo) await writeProjectMeta(root, JSON.stringify(meta));
    }

    const entry: RecentProject = { root, name: project.name, openedAt: Date.now() };
    const recents = [entry, ...get().recents.filter((r) => r.root !== root)].slice(0, 12);
    persistRecents(recents);
    void writeAppData(LAST_PROJECT_KEY, root);
    set({ project, meta, recents, status: "ready", needsMigration: null, error: null });
    useStatsStore
      .getState()
      .noteBaseline(
        project.root,
        sumBy(project.chapters, (c) => c.wordCount),
      );
    void useSyncStore.getState().init(root);

    // Reopen the chapter the author last had open (ids are stable across loads);
    // fall back to the first chapter if it's gone or none was recorded.
    const savedChapterId = await readAppData<string>(lastChapterKey(root));
    const target =
      (savedChapterId && project.chapters.find((c) => c.id === savedChapterId)) ||
      project.chapters[0];
    if (target) await get().selectChapter(target.id);

    const pdfName = project.mainFile.replace(/\.tex$/i, ".pdf");
    const pdfBase64 = await readPdf(root, pdfName).catch((e) => {
      if (import.meta.env.DEV) console.warn(`readPdf(${pdfName}) failed:`, e);
      return null;
    });
    // A PDF on disk means a prior build exists: surface it as "clean" (the
    // "loaded" badge state) rather than leaving the idle "not built" status.
    if (pdfBase64) set((s) => ({ compile: { ...s.compile, pdfBase64, status: "clean" } }));
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
    saveError: null,
    past: [],
    future: [],
    lastTextEditId: null,

    init: async () => {
      await useStatsStore.persist.rehydrate();
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
      const previousRoot = get().project?.root ?? null;
      useStoryRefreshStore.getState().cancel();
      set(LOADING_RESET);
      try {
        if (previousRoot !== null) {
          await drainProjectMetaWrites(previousRoot);
        }
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
      const root = get().project?.root ?? null;
      useStoryRefreshStore.getState().cancel();
      void writeAppData(LAST_PROJECT_KEY, "");
      useSyncStore.getState().teardown();
      if (root !== null) {
        void drainProjectMetaWrites(root).catch((error) => {
          toast.error("Couldn't save project metadata", {
            description: String(error),
          });
        });
      }
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
        saveError: null,
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
          saveError: null,
          past: [],
          future: [],
          lastTextEditId: null,
        });
        // Remember this chapter so the next relaunch reopens it. Non-critical: a
        // failed write just means the next launch falls back to the first chapter.
        void writeAppData(lastChapterKey(project.root), id).catch((e) => {
          if (import.meta.env.DEV) console.warn("Couldn't persist last chapter:", e);
        });
      } catch (e) {
        set({ error: String(e) });
      }
    },

    createProject: async (parent, name, author) => {
      useStoryRefreshStore.getState().cancel();
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
        useStoryRefreshStore
          .getState()
          .enqueueChapterTopology(project.root);
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
        useStoryRefreshStore
          .getState()
          .enqueueChapterTopology(project.root);
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
        useStoryRefreshStore
          .getState()
          .enqueueChapterTopology(project.root);
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
        set((s) => {
          const meta = {
            ...s.meta,
            chapters: Object.fromEntries(
              Object.entries(s.meta.chapters).filter(([k]) => k !== id),
            ),
          };
          persistMeta(meta);
          return { meta };
        });
        useStoryRefreshStore
          .getState()
          .enqueueChapterTopology(project.root);
        deleteOutlineAgentSession(id);
        if (activeChapterId === id) {
          const first = updated.chapters[0];
          if (first) await get().selectChapter(first.id);
          else
            set({
              activeChapterId: null,
              blocks: [],
              selectedId: null,
              selectedIds: [],
              editing: false,
              editCaret: null,
              saveError: null,
            });
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
      useStoryRefreshStore.getState().cancel();
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

    // Wholesale selection replacement (AI intents / finding jumps). Mirrors
    // select()'s nav-mode invariants; several ids form a multi-selection with
    // the last id active (toggleSelection precedent).
    setSelection: (ids) =>
      set({
        selectedId: ids.length > 0 ? ids[ids.length - 1] : null,
        selectedIds: ids.length > 1 ? [...ids] : [],
        editing: false,
        editCaret: null,
      }),

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

    applyAgentManuscriptProposal: (proposal, changeIds) => {
      const mismatchedChangeIds = invalidProposalCorrelationIds(proposal);
      if (mismatchedChangeIds.length > 0) {
        return {
          status: "invalid",
          invalidChangeIds: mismatchedChangeIds,
          reason: "mismatched-precondition",
        };
      }
      const state = get();
      const overviewChange = proposal.overviewChange ?? null;
      if (
        state.project === null ||
        state.project.root !== proposal.projectRoot
      ) {
        return { status: "stale", staleChangeIds: changeIds };
      }
      const selectableChanges = [
        ...proposal.changes,
        ...(overviewChange ? [{ id: overviewChange.id }] : []),
      ];
      const invalidChangeIds = invalidSelectedChangeIds(
        selectableChanges,
        changeIds,
      );
      if (invalidChangeIds.length > 0) {
        return {
          status: "invalid",
          invalidChangeIds,
          reason: "unknown-selection",
        };
      }
      const selected = new Set(changeIds);
      const appliesOverview =
        overviewChange !== null && selected.has(overviewChange.id);
      if (
        appliesOverview &&
        storyOverviewFingerprint(state.meta.outline.overview) !==
          overviewChange!.sourceFingerprint
      ) {
        return {
          status: "stale",
          staleChangeIds: [overviewChange!.id],
        };
      }
      const selectedProposal = {
        ...proposal,
        changes: proposal.changes.filter((item) => selected.has(item.id)),
      };
      if (
        selectedProposal.changes.length > 0 &&
        (state.activeChapterId !== proposal.chapterId ||
          !state.project.chapters.some(
            (chapter) => chapter.id === proposal.chapterId,
          ))
      ) {
        return {
          status: "stale",
          staleChangeIds: selectedProposal.changes.map((item) => item.id),
        };
      }
      const stale = validateManuscriptChanges(selectedProposal, state.blocks);
      if (stale.length > 0) {
        return {
          status: "stale",
          staleChangeIds: stale.map((item) => item.changeId),
        };
      }
      const changes = materializeManuscriptChanges(
        proposal,
        changeIds,
        state.blocks,
      );
      const conflicts = conflictingTargetChangeIds(
        changes.map((change, index) => ({
          changeId: selectedProposal.changes[index].id,
          targetId: change.kind === "insert" ? null : change.blockId,
        })),
      );
      if (conflicts.length > 0) {
        return {
          status: "invalid",
          invalidChangeIds: conflicts,
          reason: "conflicting-changes",
        };
      }
      const resolveSpeakerId = (name: string): string | undefined =>
        state.meta.characters.find(
          (character) => character.name.toLowerCase() === name.toLowerCase(),
        )?.id;
      const outcome = applyProposal(state.blocks, changes, resolveSpeakerId);
      if (outcome.applied !== changes.length || outcome.skipped !== 0) {
        return {
          status: "invalid",
          invalidChangeIds: selectedProposal.changes.map((item) => item.id),
          reason: "apply-failed",
        };
      }
      if (changes.length > 0) {
        const meta = appliesOverview
          ? {
              ...state.meta,
              outline: editOverview(
                state.meta.outline,
                overviewChange!.after,
              ),
            }
          : state.meta;
        if (appliesOverview) persistMeta(meta);
        set({ ...manuscriptProposalMutation(state, outcome.blocks), meta });
      } else if (appliesOverview) {
        const meta = {
          ...state.meta,
          outline: editOverview(
            state.meta.outline,
            overviewChange!.after,
          ),
        };
        persistMeta(meta);
        set({ meta });
      }
      return { status: "applied", appliedChangeIds: changeIds };
    },

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
          // Splitting happens mid-edit; stay in edit mode on the focused piece,
          // caret at its start (the writer's caret was at the cut point).
          // Editing is single-block, so dismiss any multi-selection.
          selectedIds: [],
          editing: true,
          editCaret: "start",
          chapterDirty: true,
          past: capPush(s.past, { blocks: s.blocks, selectedId: s.selectedId }),
          future: [],
          lastTextEditId: null,
        };
      }),

    mergeWithPrevious: (id) =>
      set((s) => {
        const idx = s.blocks.findIndex((b) => b.id === id);
        if (idx < 1) return {};
        const prev = s.blocks[idx - 1];
        const cur = s.blocks[idx];
        // Same predicate as the key router (one rule, two enforcement points),
        // so no caller can fold a speaker's line away or drop a beat/title.
        if (!canMerge(prev.type, cur.type, carriesTailContent(cur) || Boolean(cur.title))) return {};
        // Splits trim the whitespace at the cut, so the symmetric merge restores
        // one space at a bare word boundary — otherwise Enter-then-Backspace
        // would silently fuse words. The caret lands after the join; a second
        // Backspace removes the restored space when fusion really is wanted.
        const needsSpace =
          prev.text.length > 0 &&
          cur.text.length > 0 &&
          !/\s$/.test(prev.text) &&
          !/^\s/.test(cur.text);
        const join = needsSpace ? " " : "";
        const blocks = [...s.blocks];
        blocks.splice(idx - 1, 2, { ...prev, text: prev.text + join + cur.text, dirty: true });
        return {
          blocks,
          selectedId: prev.id,
          selectedIds: [],
          editing: true,
          editCaret: prev.text.length + join.length,
          chapterDirty: true,
          past: capPush(s.past, { blocks: s.blocks, selectedId: s.selectedId }),
          future: [],
          lastTextEditId: null,
        };
      }),

    structureBlock: (id) =>
      set((s) => {
        const idx = s.blocks.findIndex((b) => b.id === id);
        if (idx < 0) return {};
        const produced = structurePassage(s.blocks[idx].text, s.meta.characters);
        if (produced.length <= 1) return {};
        const next = [...s.blocks];
        next.splice(idx, 1, ...produced);
        return {
          blocks: next,
          selectedId: produced[0].id,
          selectedIds: [],
          editing: false,
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

    deleteBlocks: (ids) =>
      set((s) => {
        const deletedIds = new Set(ids);
        const firstDeletedIndex = s.blocks.findIndex((block) =>
          deletedIds.has(block.id),
        );
        if (firstDeletedIndex < 0) return {};
        const blocks = s.blocks.filter((block) => !deletedIds.has(block.id));
        // Keep the multi-selection in lockstep with the block list: drop the
        // deleted id so the set never references a block that no longer exists.
        const selectedIds = s.selectedIds.filter((id) => !deletedIds.has(id));
        const selectedId =
          s.selectedId !== null && deletedIds.has(s.selectedId)
            ? // Deleting the active block: keep the active pointer on a surviving
              // member of the set if one remains, else the document neighbour.
              (selectedIds[selectedIds.length - 1] ??
                blocks[Math.max(0, firstDeletedIndex - 1)]?.id ??
                null)
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

    deleteBlock: (id) => get().deleteBlocks([id]),

    moveBlocks: (ids, dir) =>
      set((s) => {
        const next = [...s.blocks];
        const selectedIds = new Set(ids);
        let moved = false;

        if (dir === -1) {
          for (let index = 1; index < next.length; index += 1) {
            if (
              selectedIds.has(next[index].id) &&
              !selectedIds.has(next[index - 1].id)
            ) {
              [next[index - 1], next[index]] = [next[index], next[index - 1]];
              moved = true;
            }
          }
        } else {
          for (let index = next.length - 2; index >= 0; index -= 1) {
            if (
              selectedIds.has(next[index].id) &&
              !selectedIds.has(next[index + 1].id)
            ) {
              [next[index], next[index + 1]] = [next[index + 1], next[index]];
              moved = true;
            }
          }
        }

        if (!moved) return {};
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

    moveBlock: (id, dir) => get().moveBlocks([id], dir),

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
      set({ saving: true, saveError: null });
      try {
        const source = serializeChapter(blocks);
        await writeTextFile(project.root, chapter.file, source);
        // Re-parse what we wrote so spans reset and the chapter is clean again.
        const reparsed = parseChapter(source);
        const wordCount = countWords(reparsed);
        set((s) => {
          // parseChapter re-mints every block id. When the reparse preserved the
          // block count, adopt the OLD ids positionally so a plain save keeps ids
          // stable - pending proposals, finding anchors, and the selection all
          // stay pointed at the same blocks. When counts differ (a dirty block
          // re-segmented, e.g. a blank line split a narration in two) positions
          // no longer denote the same blocks, so fall back to fresh ids and a
          // cleared selection rather than land it on a wrong or dead block.
          const sameCount = reparsed.length === s.blocks.length;
          if (import.meta.env.DEV && !sameCount) {
            console.warn(
              `saveChapter: reparse changed block count ${s.blocks.length} -> ${reparsed.length}; clearing selection (positional id adoption unreliable)`,
            );
          }
          const blocks = sameCount
            ? reparsed.map((b, i) => ({ ...b, id: s.blocks[i].id }))
            : reparsed;
          return {
            blocks,
            selectedId: sameCount ? s.selectedId : null,
            selectedIds: sameCount ? s.selectedIds : [],
            chapterDirty: false,
            saving: false,
            saveError: null,
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
        // Stats capture is best-effort: a recordSave failure must never abort the save.
        try {
          const updated = get().project;
          if (updated) {
            const total = sumBy(updated.chapters, (c) => c.wordCount);
            useStatsStore.getState().recordSave(updated.root, total);
          }
        } catch (e) {
          console.warn("stats recordSave failed:", e);
        }
        // The working tree changed on disk; refresh the backup indicator now
        // instead of waiting for the next status poll tick.
        void useSyncStore.getState().refreshStatus();
        useStoryRefreshStore.getState().enqueueSavedChapter(
          project.root,
          activeChapterId,
          storyChapterFingerprint(get().blocks),
        );
      } catch (e) {
        const message = String(e);
        set({ saving: false, error: message, saveError: message });
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

    commitStoryRefresh: async (result, latestSavedFingerprints) => {
      const state = get();
      if (state.project === null || state.project.root !== result.projectRoot) {
        throw new Error(
          `Story refresh project does not match the open project: ${result.projectRoot}`,
        );
      }

      const staleChapterIds = new Set(
        Object.entries(result.analyzedChapterFingerprints).flatMap(
          ([chapterId, analyzedFingerprint]) => {
            const latestFingerprint = latestSavedFingerprints[chapterId];
            return latestFingerprint !== undefined &&
              latestFingerprint !== analyzedFingerprint
              ? [chapterId]
              : [];
          },
        ),
      );
      const storyIsStale =
        storyFieldsFingerprint(state.meta.outline) !==
        result.storyInputFingerprint;
      const topologyIsStale =
        chapterTopologyFingerprint(state.project.chapters) !==
        result.chapterTopologyFingerprint;
      const candidateInputIsStale =
        candidateInputFingerprint(state.meta.knowledge) !==
        result.candidateInputFingerprint;
      const knowledge = structuredClone(state.meta.knowledge);
      const liveChapterIds = new Set(
        state.project.chapters.map((chapter) => chapter.id),
      );

      for (const chapterId of Object.keys(knowledge.chapters)) {
        if (!liveChapterIds.has(chapterId)) {
          delete knowledge.chapters[chapterId];
        }
      }
      if (
        !storyIsStale &&
        !topologyIsStale &&
        staleChapterIds.size === 0
      ) {
        for (const chapterId of Object.keys(
          result.analyzedChapterFingerprints,
        )) {
          if (staleChapterIds.has(chapterId) || !liveChapterIds.has(chapterId)) {
            continue;
          }
          const chapterKnowledge = result.knowledge.chapters[chapterId];
          if (chapterKnowledge !== undefined) {
            knowledge.chapters[chapterId] = structuredClone(chapterKnowledge);
          }
        }
        knowledge.chapterTopologyFingerprint =
          result.knowledge.chapterTopologyFingerprint;
      }

      if (
        !storyIsStale &&
        !topologyIsStale &&
        staleChapterIds.size === 0 &&
        !candidateInputIsStale
      ) {
        knowledge.characterCandidates = structuredClone(
          result.knowledge.characterCandidates,
        );
        knowledge.acceptedCandidateFingerprints = [
          ...result.knowledge.acceptedCandidateFingerprints,
        ];
        knowledge.dismissedCandidateFingerprints = [
          ...result.knowledge.dismissedCandidateFingerprints,
        ];
      }

      const followUpReasons: StoryRefreshFollowUpReason[] = [];
      if (storyIsStale) followUpReasons.push("story-fields-stale");
      if (topologyIsStale) {
        followUpReasons.push("chapter-topology-stale");
      }
      if (staleChapterIds.size > 0) {
        followUpReasons.push("chapter-content-stale");
      }
      if (candidateInputIsStale) {
        followUpReasons.push("candidate-input-stale");
      }
      let characters = state.meta.characters;
      if (
        !storyIsStale &&
        !topologyIsStale &&
        staleChapterIds.size === 0
      ) {
        for (const update of result.characterUpdates) {
          const index = characters.findIndex(
            (character) => character.id === update.characterId,
          );
          if (index < 0) continue;
          const character = characters[index];
          if (
            characterProfileFingerprint(character.profile) !==
            update.inputFingerprint
          ) {
            if (!followUpReasons.includes("character-profile-stale")) {
              followUpReasons.push("character-profile-stale");
            }
            continue;
          }

          const knownObservationIds = new Set(
            Object.values(knowledge.chapters).flatMap((chapter) =>
              chapter.characterObservations
                .filter(
                  (observation) =>
                    observation.characterId === update.characterId,
                )
                .map((observation) => observation.id),
            ),
          );
          const patch = {
            additions: update.patch.additions.filter(
              (addition) =>
                addition.observationIds.length > 0 &&
                addition.observationIds.every((id) =>
                  knownObservationIds.has(id),
                ),
            ),
            corrections: update.patch.corrections.filter(
              (correction) =>
                correction.observationIds.length > 0 &&
                correction.observationIds.every((id) =>
                  knownObservationIds.has(id),
                ),
            ),
          };
          if (
            patch.additions.length !== update.patch.additions.length ||
            patch.corrections.length !== update.patch.corrections.length
          ) {
            if (!followUpReasons.includes("chapter-content-stale")) {
              followUpReasons.push("chapter-content-stale");
            }
          }
          if (
            patch.additions.length === 0 &&
            patch.corrections.length === 0
          ) {
            continue;
          }
          const applied = applyCharacterKnowledgePatch(
            character.profile,
            patch,
            knowledge.appliedCharacterObservationIds[character.id] ?? [],
          );
          characters = characters.map((item, characterIndex) =>
            characterIndex === index
              ? { ...item, profile: applied.profile }
              : item,
          );
          knowledge.appliedCharacterObservationIds[character.id] =
            applied.appliedObservationIds;
        }
      }

      const meta: ProjectMeta = {
        ...state.meta,
        outline:
          storyIsStale || topologyIsStale || staleChapterIds.size > 0
            ? state.meta.outline
            : { ...result.story },
        characters,
        knowledge,
      };
      await persistOptimisticMeta(state.project.root, state.meta, meta);
      return { followUpReasons };
    },

    applyCharacterProfileFromAgent: async (
      projectRoot,
      characterId,
      profile,
    ) => {
      const state = get();
      if (state.project === null || state.project.root !== projectRoot) {
        throw new Error(
          `Agent profile project does not match the open project: ${projectRoot}`,
        );
      }
      const character = state.meta.characters.find(
        (item) => item.id === characterId,
      );
      if (character === undefined) {
        throw new Error(`Agent profile character was not found: ${characterId}`);
      }
      const updated = { ...character, profile: { ...profile } };
      const meta = {
        ...state.meta,
        characters: state.meta.characters.map((item) =>
          item.id === characterId ? updated : item,
        ),
      };
      await persistOptimisticMeta(projectRoot, state.meta, meta);
      return updated;
    },

    acceptCharacterCandidate: async (candidateId) => {
      const state = get();
      if (state.project === null) {
        throw new Error("Cannot accept a character candidate without an open project");
      }
      const candidate = state.meta.knowledge.characterCandidates.find(
        (item) => item.id === candidateId,
      );
      if (candidate === undefined) {
        throw new Error(`Character candidate was not found: ${candidateId}`);
      }
      const id = uid("c");
      const character: Character = {
        id,
        name: candidate.name,
        role: candidate.role,
        color: DEFAULT_CHARACTER_COLOR,
        profile: { ...candidate.profile },
      };
      const meta = {
        ...state.meta,
        characters: [...state.meta.characters, character],
        knowledge: {
          ...state.meta.knowledge,
          characterCandidates:
            state.meta.knowledge.characterCandidates.filter(
              (item) => item.id !== candidateId,
            ),
          acceptedCandidateFingerprints: [
            ...new Set([
              ...state.meta.knowledge.acceptedCandidateFingerprints,
              candidate.evidenceFingerprint,
            ]),
          ],
        },
      };
      await persistOptimisticMeta(state.project.root, state.meta, meta);
      return id;
    },

    dismissCharacterCandidate: async (candidateId) => {
      const state = get();
      if (state.project === null) {
        throw new Error("Cannot dismiss a character candidate without an open project");
      }
      const candidate = state.meta.knowledge.characterCandidates.find(
        (item) => item.id === candidateId,
      );
      if (candidate === undefined) {
        throw new Error(`Character candidate was not found: ${candidateId}`);
      }
      const meta = {
        ...state.meta,
        knowledge: {
          ...state.meta.knowledge,
          characterCandidates:
            state.meta.knowledge.characterCandidates.filter(
              (item) => item.id !== candidateId,
            ),
          dismissedCandidateFingerprints: [
            ...new Set([
              ...state.meta.knowledge.dismissedCandidateFingerprints,
              candidate.evidenceFingerprint,
            ]),
          ],
        },
      };
      await persistOptimisticMeta(state.project.root, state.meta, meta);
    },

    removeCharacter: (id) =>
      set((s) => {
        const meta = {
          ...s.meta,
          characters: s.meta.characters.filter((c) => c.id !== id),
        };
        persistMeta(meta);
        return { meta };
      }),

    addLore: (title) => {
      const id = uid("l");
      set((s) => {
        const entry: LoreEntry = { id, title, description: "", characterIds: [], tags: [] };
        const meta = { ...s.meta, lore: [...s.meta.lore, entry] };
        persistMeta(meta);
        return { meta };
      });
      return id;
    },

    updateLore: (id, patch) =>
      set((s) => {
        const meta = { ...s.meta, lore: updateLore(s.meta.lore, id, patch) };
        persistMeta(meta);
        return { meta };
      }),

    removeLore: (id) =>
      set((s) => {
        const meta = { ...s.meta, lore: removeLore(s.meta.lore, id) };
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

    setPremise: (premise) =>
      set((s) => {
        const meta = { ...s.meta, outline: editPremise(s.meta.outline, premise) };
        persistMeta(meta);
        return { meta };
      }),

    setOverview: (overview) =>
      set((s) => {
        const meta = { ...s.meta, outline: editOverview(s.meta.outline, overview) };
        persistMeta(meta);
        return { meta };
      }),

    addCard: (chapterId) => {
      const { chapters, cardId } = addCardModel(get().meta.chapters, chapterId);
      set((s) => {
        const meta = { ...s.meta, chapters };
        persistMeta(meta);
        return { meta };
      });
      return cardId;
    },

    removeCard: (chapterId, cardId) =>
      set((s) => {
        const meta = { ...s.meta, chapters: removeCardModel(s.meta.chapters, chapterId, cardId) };
        persistMeta(meta);
        return { meta };
      }),

    editCard: (chapterId, cardId, patch) =>
      set((s) => {
        const meta = { ...s.meta, chapters: editCardModel(s.meta.chapters, chapterId, cardId, patch) };
        persistMeta(meta);
        return { meta };
      }),

    moveCardWithin: (chapterId, cardId, toIndex) =>
      set((s) => {
        const meta = { ...s.meta, chapters: moveCardWithinModel(s.meta.chapters, chapterId, cardId, toIndex) };
        persistMeta(meta);
        return { meta };
      }),

    moveCardToChapter: (fromChapterId, toChapterId, cardId, toIndex) =>
      set((s) => {
        const meta = {
          ...s.meta,
          chapters: moveCardToChapterModel(s.meta.chapters, fromChapterId, toChapterId, cardId, toIndex),
        };
        persistMeta(meta);
        return { meta };
      }),

    addCharacterToCard: (chapterId, cardId, characterId) =>
      set((s) => {
        const meta = { ...s.meta, chapters: addCharacterToCardModel(s.meta.chapters, chapterId, cardId, characterId) };
        persistMeta(meta);
        return { meta };
      }),

    removeCharacterFromCard: (chapterId, cardId, characterId) =>
      set((s) => {
        const meta = { ...s.meta, chapters: removeCharacterFromCardModel(s.meta.chapters, chapterId, cardId, characterId) };
        persistMeta(meta);
        return { meta };
      }),

    addLoreToCard: (chapterId, cardId, loreId) =>
      set((s) => {
        const meta = { ...s.meta, chapters: addLoreToCardModel(s.meta.chapters, chapterId, cardId, loreId) };
        persistMeta(meta);
        return { meta };
      }),

    removeLoreFromCard: (chapterId, cardId, loreId) =>
      set((s) => {
        const meta = { ...s.meta, chapters: removeLoreFromCardModel(s.meta.chapters, chapterId, cardId, loreId) };
        persistMeta(meta);
        return { meta };
      }),

    setCardContinuityFlags: (chapterId, cardId, flags) =>
      set((s) => {
        const meta = { ...s.meta, chapters: setCardContinuityFlagsModel(s.meta.chapters, chapterId, cardId, flags) };
        persistMeta(meta);
        return { meta };
      }),

    addCharacterToChapter: (chapterId, characterId) =>
      set((s) => {
        const meta = { ...s.meta, chapters: addCharacterToChapterModel(s.meta.chapters, chapterId, characterId) };
        persistMeta(meta);
        return { meta };
      }),

    removeCharacterFromChapter: (chapterId, characterId) =>
      set((s) => {
        const meta = { ...s.meta, chapters: removeCharacterFromChapterModel(s.meta.chapters, chapterId, characterId) };
        persistMeta(meta);
        return { meta };
      }),

    setChapterAct: (chapterId, act) =>
      set((s) => {
        const meta = { ...s.meta, chapters: setChapterActModel(s.meta.chapters, chapterId, act) };
        persistMeta(meta);
        return { meta };
      }),

    setChapterPlotPoint: (chapterId, plotPoint) =>
      set((s) => {
        const meta = { ...s.meta, chapters: setChapterPlotPointModel(s.meta.chapters, chapterId, plotPoint) };
        persistMeta(meta);
        return { meta };
      }),

    setChapterField: (chapterId, patch) =>
      set((s) => {
        const meta = { ...s.meta, chapters: editChapterField(s.meta.chapters, chapterId, patch) };
        persistMeta(meta);
        return { meta };
      }),

    applyAgentOutlineProposal: (proposal, changeIds) => {
      const mismatchedChangeIds = invalidProposalCorrelationIds(proposal);
      if (mismatchedChangeIds.length > 0) {
        return {
          status: "invalid",
          invalidChangeIds: mismatchedChangeIds,
          reason: "mismatched-precondition",
        };
      }
      const state = get();
      const overviewChange = proposal.overviewChange ?? null;
      if (
        state.project === null ||
        state.project.root !== proposal.projectRoot
      ) {
        return { status: "stale", staleChangeIds: changeIds };
      }
      const selectableChanges = [
        ...proposal.changes,
        ...(overviewChange ? [{ id: overviewChange.id }] : []),
      ];
      const invalidChangeIds = invalidSelectedChangeIds(
        selectableChanges,
        changeIds,
      );
      if (invalidChangeIds.length > 0) {
        return {
          status: "invalid",
          invalidChangeIds,
          reason: "unknown-selection",
        };
      }
      const selected = new Set(changeIds);
      const appliesOverview =
        overviewChange !== null && selected.has(overviewChange.id);
      if (
        appliesOverview &&
        storyOverviewFingerprint(state.meta.outline.overview) !==
          overviewChange!.sourceFingerprint
      ) {
        return {
          status: "stale",
          staleChangeIds: [overviewChange!.id],
        };
      }
      const selectedProposal = {
        ...proposal,
        changes: proposal.changes.filter((item) => selected.has(item.id)),
      };
      if (
        selectedProposal.changes.length > 0 &&
        !state.project.chapters.some(
          (chapter) => chapter.id === proposal.chapterId,
        )
      ) {
        return {
          status: "stale",
          staleChangeIds: selectedProposal.changes.map((item) => item.id),
        };
      }
      const cards = selectedProposal.changes.length === 0
        ? []
        : getChapterOutline(state.meta.chapters, proposal.chapterId).cards;
      const stale = validateOutlineChanges(selectedProposal, cards);
      if (stale.length > 0) {
        return {
          status: "stale",
          staleChangeIds: stale.map((item) => item.changeId),
        };
      }
      const conflicts = conflictingTargetChangeIds(
        selectedProposal.changes.map((item) => ({
          changeId: item.id,
          targetId: item.change.kind === "add" ? null : item.change.cardId,
        })),
      );
      if (conflicts.length > 0) {
        return {
          status: "invalid",
          invalidChangeIds: conflicts,
          reason: "conflicting-changes",
        };
      }
      const before = state.meta;
      const chapters = selectedProposal.changes.length === 0
        ? before.chapters
        : applyOutlineChangesStrict(
            before.chapters,
            proposal.chapterId,
            proposal.summary,
            selectedProposal.changes,
          );
      if (chapters === null) {
        return {
          status: "invalid",
          invalidChangeIds: selectedProposal.changes.map((item) => item.id),
          reason: "apply-failed",
        };
      }
      const meta = {
        ...before,
        chapters,
        ...(appliesOverview
          ? {
              outline: editOverview(
                before.outline,
                overviewChange!.after,
              ),
            }
          : {}),
      };
      const undoToken: OutlineUndoToken = {
        id: uid(),
        projectRoot: state.project.root,
        before,
        afterFingerprint: projectMetaFingerprint(meta),
      };
      persistMeta(meta);
      set({ meta });
      return {
        status: "applied",
        appliedChangeIds: changeIds,
        undoToken,
      };
    },

    undoAgentOutlineProposal: (token) => {
      const state = get();
      if (
        state.project === null ||
        state.project.root !== token.projectRoot ||
        projectMetaFingerprint(state.meta) !== token.afterFingerprint
      ) {
        return false;
      }
      persistMeta(token.before);
      set({ meta: token.before });
      return true;
    },
  };
});

/**
 * The blocks a `"block"`-scoped operation acts on: the multi-selection set when
 * one is active, otherwise the single selected block (empty when nothing is
 * selected). This is the single definition of the selection-precedence rule
 * shared by agent entry points.
 */
export function selectionTargetIds(
  selectedIds: string[],
  selectedId: string | null,
): string[] {
  return selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
}

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
