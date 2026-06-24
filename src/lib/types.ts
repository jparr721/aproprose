// types.ts — the shared domain model for aproprose.
//
// Everything in the app codes against these types: the LaTeX parser/serializer,
// the zustand stores, the Tauri bridge, the AI layer, and every UI component.
// Keeping them in one place is the contract that lets the layers stay decoupled.

// ── Blocks ───────────────────────────────────────────────────────────────────
// A novel chapter is modeled as an ordered list of blocks. Blocks are the
// authoring unit: the writer thinks in narration / dialogue / scene beats, and
// the AI reads the block stream to know what each section *is*.

export type BlockType =
  | "chapter" // a centered scene label or a `* * *` break
  | "narration" // a prose paragraph
  | "dialogue" // a quoted utterance (+ optional action beat)
  | "lore" // worldbuilding note — never rendered (stored as a LaTeX comment)
  | "scratchpad" // brainstorm note — never rendered (stored as a LaTeX comment)
  | "latex"; // raw LaTeX escape hatch — edited and emitted verbatim

/** A chapter sub-kind for `chapter` blocks. */
export type ChapterLevel = "scene" | "break";

export interface Block {
  id: string;
  type: BlockType;
  /**
   * The editable / displayable text.
   * - prose types (`narration`, `dialogue`, `chapter`, `lore`, `scratchpad`):
   *   cleaned of LaTeX — inline emphasis is written as `_italics_`, quotes as
   *   straight `"…"`, dashes as real `—` / `–`.
   * - `latex`: the raw LaTeX source, edited verbatim.
   */
  text: string;
  /**
   * The exact source substring this block was parsed from, INCLUDING its
   * trailing blank-line separator. Concatenating every block's `raw` in order
   * reproduces the original file byte-for-byte — this is what makes an unedited
   * save a no-op and guarantees we never corrupt the writer's manuscript.
   */
  raw: string;
  /**
   * True once the block has been edited (or created fresh in the UI). Dirty
   * blocks are re-serialized from `text`/fields; clean blocks emit `raw`.
   */
  dirty: boolean;

  /** dialogue: speaker character id (see {@link Character}). */
  speaker?: string;
  /** dialogue: trailing action beat (rendered after the quote, e.g. "He nods."). */
  beat?: string;
  /** lore: optional short title. */
  title?: string;
  /** chapter: `scene` (centered label) or `break` (`* * *` separator). */
  level?: ChapterLevel;
}

// ── Project model ─────────────────────────────────────────────────────────────

export type ChapterStatus = "active" | "draft" | "outline" | "planned";

/** A chapter as discovered in the project's main `.tex` file. */
export interface ChapterRef {
  /** Stable id derived from the input file path. */
  id: string;
  /** Display label, e.g. roman numeral "II" or "1". */
  label: string;
  /** Title from the `\chapter{…}` command. */
  title: string;
  /** Project-relative path of the `\input{…}` file (e.g. "content/chapter0.tex"). */
  file: string;
  /** Word count of the chapter body (computed on load). */
  wordCount: number;
}

/** Editable manuscript metadata, mirrored from `metadata.tex`. Edition year is
 *  always the current year (rendered as `\the\year`), so it is not a field. */
export interface NovelMetadata {
  title: string;
  subtitle: string;
  author: string;
  publisher: string;
  isbn: string;
}

/** One chapter in a skeleton-mutation request. `file: null` means "new chapter —
 *  the backend allocates a stable filename and creates an empty body". */
export interface SkeletonChapter {
  title: string;
  file: string | null;
}

/** The full skeleton the app owns; the backend regenerates the `.tex` from it. */
export interface SkeletonModel {
  metadata: NovelMetadata;
  chapters: SkeletonChapter[];
}

/** The result of opening a folder: a ready managed project, or a migration signal. */
export interface OpenOutcome {
  status: "managed" | "needsMigration";
  project: ProjectInfo | null;
  mainFile: string | null;
  detectedChapters: number | null;
}

export interface Character {
  id: string;
  name: string;
  /** An oklch() color string used for the speaker dot / avatar. */
  color: string;
  role: string;
}

export interface LoreEntry {
  id: string;
  title: string;
}

/** The shape returned by the Rust `open_project` command. */
export interface ProjectInfo {
  /** Absolute path of the project directory. */
  root: string;
  /** Display name (book title if found, else directory name). */
  name: string;
  /** Project-relative path of the main `.tex` file (e.g. "main.tex"). */
  mainFile: string;
  /** `\title` / `\booktitle` if found in the preamble. */
  title: string | null;
  /** `\author` / `\authorname` if found in the preamble. */
  author: string | null;
  metadata: NovelMetadata;
  chapters: ChapterRef[];
}

/**
 * Per-project metadata the app owns but the `.tex` files don't carry: the cast,
 * chapter statuses, lore index. Persisted in the app config dir keyed by the
 * project path, so the user's repository is never touched.
 */
export interface ProjectMeta {
  characters: Character[];
  lore: LoreEntry[];
  /** chapter id -> status override. */
  statuses: Record<string, ChapterStatus>;
}

/** A previously opened project, for the recents list / switcher. */
export interface RecentProject {
  root: string;
  name: string;
  /** ms since epoch of last open. */
  openedAt: number;
}

// ── Settings ──────────────────────────────────────────────────────────────────

export type Theme = "light" | "sepia" | "dark";
export type LayoutMode = "two" | "three" | "focus";
export type BlockStyle = "typo" | "cards";

export interface Settings {
  theme: Theme;
  layout: LayoutMode;
  blockStyle: BlockStyle;
  /** Editor prose font-size in px. */
  proseSize: number;
  /** PDF preview zoom as a scale factor (1 = 100%). */
  pdfZoom: number;
  /** OpenAI model id chosen in Settings. Null until the user picks one - no default. */
  aiModel: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "light",
  layout: "two",
  blockStyle: "typo",
  proseSize: 17.5,
  pdfZoom: 1.1,
  aiModel: null,
};

// ── Compilation ───────────────────────────────────────────────────────────────

export interface CompileError {
  file: string | null;
  line: number | null;
  message: string;
}

export interface CompileResult {
  ok: boolean;
  /** base64-encoded PDF bytes when the build produced output. */
  pdfBase64: string | null;
  /** The raw build log (latexmk / pdflatex output). */
  log: string;
  errors: CompileError[];
  durationMs: number;
}

// ── AI ────────────────────────────────────────────────────────────────────────

/** A single continuation the AI proposes for the cursor position. */
export interface Suggestion {
  type: "dialogue" | "narration";
  /** Display name of the speaker, for dialogue suggestions. */
  speaker?: string;
  text: string;
  rationale: string;
}

export interface SuggestResult {
  suggestions: Suggestion[];
  /** Short "after this, you could…" follow-up prompts. */
  followups: string[];
}

export type CritiqueKind = "strength" | "watch" | "idea";
export interface CritiqueNote {
  kind: CritiqueKind;
  /** Short category tag, e.g. "Voice", "Pacing". */
  tag: string;
  text: string;
}

export type ContinuitySeverity = "ok" | "warn" | "flag";
export interface ContinuityFlag {
  sev: ContinuitySeverity;
  tag: string;
  text: string;
}

export interface CastMember {
  name: string;
  /** oklch() color for the avatar; omitted members render as a ghost avatar. */
  color?: string;
  /** State label, e.g. "POV", "Active", "Background", "Deceased", "Unknown". */
  state: string;
  detail: string;
  /** True for characters referenced but not physically present in the scene. */
  offPage: boolean;
}

export interface CastResult {
  inScene: CastMember[];
  offPage: CastMember[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** A single proposed in-place revision of one block (see the AI "Edit" tab). */
export interface BlockEdit {
  /** The id of an existing block to revise. */
  blockId: string;
  /** The full revised cleaned text for that block. */
  newText: string;
  /** A short phrase: what changed and why. */
  reason: string;
}

// ── Backup / sync ─────────────────────────────────────────────────────────────

export interface ToolingStatus {
  gitInstalled: boolean;
  gitVersion: string | null;
  ghInstalled: boolean;
  ghAuthed: boolean;
  login: string | null;
}

export interface ChangedFile {
  /** Project-relative path. */
  path: string;
  /** Two-char git short status, e.g. "M ", "??", "UU". */
  status: string;
  conflicted: boolean;
}

export interface RepoStatus {
  isRepo: boolean;
  hasRemote: boolean;
  remoteUrl: string | null;
  branch: string | null;
  ahead: number;
  behind: number;
  dirty: boolean;
  changedFiles: ChangedFile[];
  conflictedFiles: string[];
}

export type SyncOutcome =
  | { kind: "clean" }
  | { kind: "synced" }
  | { kind: "conflict"; files: string[] }
  | { kind: "pushRejected" }
  | { kind: "needsSetup"; reason: string }
  | { kind: "authMissing" }
  | { kind: "offline" };

export type SyncStatus =
  | "disabled"
  | "clean"
  | "dirty"
  | "syncing"
  | "synced"
  | "error"
  | "conflict"
  | "offline"
  | "needsSetup";

export interface SyncPrefs {
  autoSync: boolean;
  intervalMinutes: number;
}

export interface NameCheck {
  available: boolean;
  reason: string | null;
}

export interface RepoCreated {
  remoteUrl: string;
  owner: string;
}
