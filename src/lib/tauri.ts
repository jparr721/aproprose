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
  CompileResult,
  NovelMetadata,
  OpenOutcome,
  ProjectInfo,
  SkeletonModel,
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

// ── AI config ─────────────────────────────────────────────────────────────────
// The OpenAI key is entered in Settings and stored in the app-config dir on the
// Rust side (with optional dev fallbacks to an env var / `.env`). It is fetched
// at runtime to build the provider — never inlined into the bundle. The Settings
// UI only ever reads the *presence* of a key, never the secret itself.

export interface AiConfig {
  /** OpenAI API key, resolved on the Rust side — never bundled into JS. */
  apiKey: string;
}

export function getAiConfig(): Promise<AiConfig> {
  return invoke<AiConfig>("get_ai_config");
}

/** Whether a usable OpenAI key is configured (stored, or a dev fallback). */
export function hasOpenAiKey(): Promise<boolean> {
  return invoke<boolean>("has_openai_key");
}

/** Persist the OpenAI key to the app-config dir; an empty string clears it. */
export function setOpenAiKey(key: string): Promise<void> {
  return invoke<void>("set_openai_key", { key });
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
