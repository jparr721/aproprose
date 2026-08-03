// tauri.ts — typed bridge to the Rust backend.
//
// Every privileged operation (filesystem, latexmk, reading the API key) lives in
// Rust and is exposed as a narrow `#[tauri::command]`. This module is the single
// place the frontend talks to that surface, so the command names + argument
// shapes here ARE the contract the Rust side implements (see src-tauri/src).
//
// Tauri converts JS camelCase argument keys to Rust snake_case parameters, so we
// pass camelCase here and the Rust signatures use snake_case.

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type {
  AgentErrorCode,
  AgentFailure,
  AgentTask,
} from "@/lib/ai/agent-types";
import {
  agentFailureFromReason,
  settingsUnavailableFailure,
} from "@/lib/ai/agent-failure";
import type {
  AiProvider,
  CompileResult,
  NameCheck,
  NovelMetadata,
  OpenOutcome,
  ProjectInfo,
  RepoCreated,
  RepoStatus,
  SkeletonModel,
  SyncOutcome,
  ToolingStatus,
} from "@/lib/types";

// ── Project ───────────────────────────────────────────────────────────────────

/** Show the native folder picker. Returns the chosen absolute path, or null. */
export async function pickProjectDir(): Promise<string | null> {
  const result = await openDialog({
    directory: true,
    multiple: false,
    title: "Open a LaTeX project",
  });
  return typeof result === "string" ? result : null;
}

/**
 * Open a project folder. Managed projects return `{status: "managed", project}`;
 * legacy folders return `{status: "needsMigration", mainFile, detectedChapters}`.
 */
export function openProject(root: string): Promise<OpenOutcome> {
  return invoke<OpenOutcome>("open_project", { root });
}

/** Scaffold a new managed novel under `parent` and open it. */
export function createProject(
  parent: string,
  name: string,
  metadata: NovelMetadata,
): Promise<ProjectInfo> {
  return invoke<ProjectInfo>("create_project", { parent, name, metadata });
}

/** Regenerate metadata.tex + chapters.tex from the model; returns the fresh project. */
export function writeSkeleton(
  root: string,
  model: SkeletonModel,
): Promise<ProjectInfo> {
  return invoke<ProjectInfo>("write_skeleton", { root, model });
}

/** Delete a chapter: regenerate from the trimmed model and remove its body file. */
export function deleteChapterCmd(
  root: string,
  model: SkeletonModel,
  file: string,
): Promise<ProjectInfo> {
  return invoke<ProjectInfo>("delete_chapter", { root, model, file });
}

/** Convert a legacy project to the managed layout (one-time). */
export function migrateToManaged(root: string): Promise<ProjectInfo> {
  return invoke<ProjectInfo>("migrate_to_managed", { root });
}

// ── Files ─────────────────────────────────────────────────────────────────────
// Paths may be absolute or project-relative; the Rust side resolves them against
// the supplied project root so the frontend never builds OS paths by hand.

export function readTextFile(root: string, path: string): Promise<string> {
  return invoke<string>("read_text_file", { root, path });
}

export function writeTextFile(
  root: string,
  path: string,
  content: string,
): Promise<void> {
  return invoke<void>("write_text_file", { root, path, content });
}

// ── Compile ─────────────────────────────────────────────────────────────────

/** Run latexmk in the project root and return status + log + base64 PDF. */
export function compileProject(
  root: string,
  mainFile: string,
): Promise<CompileResult> {
  return invoke<CompileResult>("compile_project", { root, mainFile });
}

/** Read an existing PDF (project-relative path) as base64, or null if absent. */
export function readPdf(root: string, path: string): Promise<string | null> {
  return invoke<string | null>("read_pdf", { root, path });
}

/** The absolute path where the compiled PDF lands, resolved on the Rust side. */
export function pdfPath(root: string, mainFile: string): Promise<string> {
  return invoke<string>("pdf_path", { root, mainFile });
}

// ── AI config ─────────────────────────────────────────────────────────────────
// Provider keys are entered in Settings and stored in the app-config dir on the
// Rust side. A selected key is fetched at runtime to build the provider and is
// never inlined into the bundle. The Settings UI only reads whether a key exists.

export interface AiConfig {
  /** Provider API key, resolved on the Rust side and never bundled into JS. */
  apiKey: string;
}

export type AiKeyStatus =
  | { status: "configured" }
  | { status: "missing" }
  | { status: "unavailable"; failure: AgentFailure };

export type AiKeyWriteOutcome =
  | { status: "saved" }
  | { status: "failure"; failure: AgentFailure };

export class AiConfigurationError extends Error {
  readonly failure: AgentFailure;

  constructor(failure: AgentFailure) {
    super(failure.message);
    this.name = "AiConfigurationError";
    this.failure = failure;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeAiConfigFailure(value: unknown, provider: AiProvider): AgentFailure {
  if (isRecord(value) && typeof value.reason === "string") {
    const reasons = [
      "model-unselected",
      "key-missing",
      "key-rejected",
      "model-unavailable",
      "settings-unavailable",
      "quota",
      "transport",
      "tool",
      "compaction",
      "transition",
      "unknown",
    ] as const;
    if (reasons.includes(value.reason as (typeof reasons)[number])) {
      return agentFailureFromReason(
        value.reason as (typeof reasons)[number],
        provider,
      );
    }
  }
  return settingsUnavailableFailure();
}

export async function getAiConfig(provider: AiProvider): Promise<AiConfig> {
  const outcome = await invoke<unknown>("get_ai_config", { provider });
  if (
    isRecord(outcome) &&
    outcome.status === "configured" &&
    typeof outcome.apiKey === "string"
  ) {
    return { apiKey: outcome.apiKey };
  }
  const failure = isRecord(outcome) ? outcome.failure : undefined;
  throw new AiConfigurationError(safeAiConfigFailure(failure, provider));
}

export async function getAiKeyStatus(provider: AiProvider): Promise<AiKeyStatus> {
  const outcome = await invoke<unknown>("get_ai_key_status", { provider });
  if (!isRecord(outcome)) {
    return { status: "unavailable", failure: settingsUnavailableFailure() };
  }
  if (outcome.status === "configured") return { status: "configured" };
  if (outcome.status === "missing") return { status: "missing" };
  return {
    status: "unavailable",
    failure: safeAiConfigFailure(outcome.failure, provider),
  };
}

export async function setAiKey(
  provider: AiProvider,
  key: string,
): Promise<AiKeyWriteOutcome> {
  const outcome = await invoke<unknown>("set_ai_key", { provider, key });
  if (isRecord(outcome) && outcome.status === "saved") return { status: "saved" };
  return {
    status: "failure",
    failure: safeAiConfigFailure(
      isRecord(outcome) ? outcome.failure : undefined,
      provider,
    ),
  };
}

// ── App data (recents, per-project metadata) ───────────────────────────────────
// Generic key/value JSON blobs stored under the app config dir. The frontend
// owns the schema; Rust only does the file IO so nothing lands in the user repo.

export async function readAppData<T>(key: string): Promise<T | null> {
  const raw = await invoke<string | null>("read_app_data", { key });
  return raw == null ? null : (JSON.parse(raw) as T);
}

export function writeAppData<T>(key: string, value: T): Promise<void> {
  return invoke<void>("write_app_data", { key, value: JSON.stringify(value) });
}

// ── AI diagnostics ───────────────────────────────────────────────────────────

export interface AgentToolFailureChangeTarget {
  kind: string;
  targetId: string | null;
  afterId: string | null;
  toIndex: number | null;
}

export interface AgentFailureLogEntry {
  kind: "tool" | "run";
  occurredAt: string;
  runId: string;
  provider: AiProvider;
  modelId: string | null;
  task: AgentTask;
  toolName: string | null;
  toolCallId: string | null;
  changeTargets: AgentToolFailureChangeTarget[] | null;
  errorCode: AgentErrorCode;
  error: string;
}

export function appendAgentFailureLog(
  entry: AgentFailureLogEntry,
): Promise<void> {
  return invoke<void>("append_agent_failure_log", { entry });
}

// ── Backup / sync ─────────────────────────────────────────────────────────────

export function gitToolingStatus(): Promise<ToolingStatus> {
  return invoke<ToolingStatus>("git_tooling_status");
}

export function gitRepoStatus(root: string): Promise<RepoStatus> {
  return invoke<RepoStatus>("git_repo_status", { root });
}

export function gitDiff(root: string, file?: string): Promise<string> {
  return invoke<string>("git_diff", { root, file: file ?? null });
}

export function syncProject(root: string, message: string): Promise<SyncOutcome> {
  return invoke<SyncOutcome>("sync_project", { root, message });
}

export function ghCheckRepoName(name: string): Promise<NameCheck> {
  return invoke<NameCheck>("gh_check_repo_name", { name });
}

export function enableBackup(root: string, name: string, isPrivate: boolean): Promise<RepoCreated> {
  return invoke<RepoCreated>("enable_backup_cmd", { root, name, private: isPrivate });
}

export function readProjectMeta(root: string): Promise<string | null> {
  return invoke<string | null>("read_project_meta", { root });
}

export function writeProjectMeta(root: string, value: string): Promise<void> {
  return invoke<void>("write_project_meta", { root, value });
}
