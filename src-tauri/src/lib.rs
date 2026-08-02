//! aproprose — Rust backend.
//!
//! The webview is untrusted UI: every privileged operation (filesystem,
//! latexmk, reading provider API keys) lives here and is exposed as a narrow
//! `#[tauri::command]`. The command names + argument shapes are the contract
//! defined by `src/lib/tauri.ts`; Tauri maps the JS camelCase argument keys to
//! these snake_case parameters.

pub mod compile;
pub mod git;
pub mod novel;
pub mod path_env;
pub mod project;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

use compile::CompileResult;
use project::{NovelMetadata, ProjectInfo};

// ── Project ─────────────────────────────────────────────────────────────────

/// Open a project folder: managed → ready `ProjectInfo`; legacy → a
/// `needsMigration` signal the UI turns into a convert prompt.
#[tauri::command]
fn open_project(root: String) -> Result<novel::OpenOutcome, String> {
    novel::detect_and_open(Path::new(&root))
}

/// Scaffold a new managed novel under `parent` and open it.
#[tauri::command]
fn create_project(
    parent: String,
    name: String,
    metadata: NovelMetadata,
) -> Result<ProjectInfo, String> {
    novel::create_project(Path::new(&parent), &name, &metadata)
}

/// Regenerate metadata.tex + chapters.tex from the model (add/rename/reorder/
/// metadata edits). Creates an empty body for any new chapter; never deletes.
#[tauri::command]
fn write_skeleton(root: String, model: novel::SkeletonModel) -> Result<ProjectInfo, String> {
    novel::write_skeleton(Path::new(&root), &model)
}

/// Delete a chapter: regenerate from the (already-trimmed) model and remove its body file.
#[tauri::command]
fn delete_chapter(
    root: String,
    model: novel::SkeletonModel,
    file: String,
) -> Result<ProjectInfo, String> {
    novel::delete_chapter(Path::new(&root), &model, &file)
}

/// Convert a legacy project to the managed layout (one-time).
#[tauri::command]
fn migrate_to_managed(root: String) -> Result<ProjectInfo, String> {
    novel::migrate_to_managed(Path::new(&root))
}

/// Read `<root>/.aproprose/meta.json`, or `None` if it doesn't exist.
#[tauri::command]
fn read_project_meta(root: String) -> Result<Option<String>, String> {
    project::read_meta(Path::new(&root))
}

/// Write `<root>/.aproprose/meta.json`, creating `.aproprose/` if needed.
#[tauri::command]
fn write_project_meta(root: String, value: String) -> Result<(), String> {
    project::write_meta(Path::new(&root), &value)
}

// ── Files ───────────────────────────────────────────────────────────────────

/// Read a UTF-8 text file. `path` may be absolute or relative to `root`; either
/// way the resolved path must stay inside `root`.
#[tauri::command]
fn read_text_file(root: String, path: String) -> Result<String, String> {
    let resolved = resolve_within_root(&root, &path)?;
    std::fs::read_to_string(&resolved)
        .map_err(|e| format!("cannot read {}: {e}", resolved.display()))
}

/// Write a UTF-8 text file, creating parent directories as needed. `path` may
/// be absolute or relative to `root`; the resolved path must stay inside it.
#[tauri::command]
fn write_text_file(root: String, path: String, content: String) -> Result<(), String> {
    let resolved = resolve_within_root(&root, &path)?;
    if let Some(parent) = resolved.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    std::fs::write(&resolved, content)
        .map_err(|e| format!("cannot write {}: {e}", resolved.display()))
}

// ── Compile ─────────────────────────────────────────────────────────────────

/// Run latexmk (or pdflatex) in `root` and return status + log + base64 PDF.
#[tauri::command]
async fn compile_project(root: String, main_file: String) -> Result<CompileResult, String> {
    let root_path = Path::new(&root)
        .canonicalize()
        .map_err(|e| format!("invalid project root {root}: {e}"))?;
    Ok(compile::compile_project(&root_path, &main_file).await)
}

/// The absolute path where the compiled PDF lands (whether or not it exists yet),
/// resolved the same way the compiler writes it so the frontend never rebuilds it.
#[tauri::command]
fn pdf_path(root: String, main_file: String) -> Result<String, String> {
    let root_path = Path::new(&root)
        .canonicalize()
        .map_err(|e| format!("invalid project root {root}: {e}"))?;
    Ok(compile::pdf_output_path(&root_path, &main_file)
        .to_string_lossy()
        .into_owned())
}

/// Read an existing file (project-relative path) as base64, or `None` if absent.
#[tauri::command]
fn read_pdf(root: String, path: String) -> Result<Option<String>, String> {
    let resolved = match resolve_within_root(&root, &path) {
        Ok(p) => p,
        // A path that doesn't exist yet can't be canonicalized; treat as absent.
        Err(_) => return Ok(None),
    };
    match std::fs::read(&resolved) {
        Ok(bytes) if !bytes.is_empty() => Ok(Some(BASE64.encode(bytes))),
        Ok(_) => Ok(None),
        Err(_) => Ok(None),
    }
}

// ── AI config ─────────────────────────────────────────────────────────────────
//
// Provider keys are entered in Settings and stored as separate plaintext JSON
// files in the app-config dir. The selected key is handed to the frontend AI
// layer at runtime, never written into the JS bundle, and never logged.

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum AiProvider {
    Openai,
    Openrouter,
}

/// On-disk shape of each stored provider key.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredApiKey {
    api_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiConfigFailure {
    reason: String,
    message: String,
    action: String,
    settings_target: Option<String>,
}

#[derive(Serialize)]
#[serde(
    tag = "status",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
enum AiConfigOutcome {
    Configured { api_key: String },
    Failure { failure: AiConfigFailure },
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
enum AiKeyStatus {
    Configured,
    Missing,
    Unavailable { failure: AiConfigFailure },
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
enum AiKeyWriteOutcome {
    Saved,
    Failure { failure: AiConfigFailure },
}

fn provider_key_filename(provider: AiProvider) -> &'static str {
    match provider {
        AiProvider::Openai => "openai_key.json",
        AiProvider::Openrouter => "openrouter_key.json",
    }
}

fn provider_name(provider: AiProvider) -> &'static str {
    match provider {
        AiProvider::Openai => "OpenAI",
        AiProvider::Openrouter => "OpenRouter",
    }
}

fn settings_unavailable_failure() -> AiConfigFailure {
    AiConfigFailure {
        reason: "settings-unavailable".to_string(),
        message: "AI settings are unavailable. Retry.".to_string(),
        action: "retry".to_string(),
        settings_target: None,
    }
}

fn key_missing_failure(provider: AiProvider) -> AiConfigFailure {
    AiConfigFailure {
        reason: "key-missing".to_string(),
        message: format!("Add an {} key, then submit again.", provider_name(provider)),
        action: "add-key".to_string(),
        settings_target: Some("key".to_string()),
    }
}

/// Path of a provider's stored-key file in the app config dir.
fn api_key_path(app: &tauri::AppHandle, provider: AiProvider) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no app config dir: {e}"))?;
    Ok(base.join(provider_key_filename(provider)))
}

enum StoredKeyState {
    Configured(String),
    Missing,
}

fn read_stored_key(
    app: &tauri::AppHandle,
    provider: AiProvider,
) -> Result<StoredKeyState, AiConfigFailure> {
    let path = api_key_path(app, provider).map_err(|_| settings_unavailable_failure())?;
    read_stored_key_path(&path)
}

fn read_stored_key_path(path: &Path) -> Result<StoredKeyState, AiConfigFailure> {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(StoredKeyState::Missing)
        }
        Err(_) => return Err(settings_unavailable_failure()),
    };
    let parsed: StoredApiKey =
        serde_json::from_str(&raw).map_err(|_| settings_unavailable_failure())?;
    let key = parsed.api_key.trim().to_string();
    if key.is_empty() {
        Ok(StoredKeyState::Missing)
    } else {
        Ok(StoredKeyState::Configured(key))
    }
}

fn key_status_from_storage(stored_key: Result<StoredKeyState, AiConfigFailure>) -> AiKeyStatus {
    match stored_key {
        Ok(StoredKeyState::Configured(_)) => AiKeyStatus::Configured,
        Ok(StoredKeyState::Missing) => AiKeyStatus::Missing,
        Err(failure) => AiKeyStatus::Unavailable { failure },
    }
}

#[tauri::command]
fn get_ai_config(app: tauri::AppHandle, provider: AiProvider) -> AiConfigOutcome {
    match read_stored_key(&app, provider) {
        Ok(StoredKeyState::Configured(api_key)) => AiConfigOutcome::Configured { api_key },
        Ok(StoredKeyState::Missing) => AiConfigOutcome::Failure {
            failure: key_missing_failure(provider),
        },
        Err(failure) => AiConfigOutcome::Failure { failure },
    }
}

#[tauri::command]
fn get_ai_key_status(app: tauri::AppHandle, provider: AiProvider) -> AiKeyStatus {
    key_status_from_storage(read_stored_key(&app, provider))
}

/// Save (or, when `key` is blank, clear) a provider key in the app config
/// dir. The value is never logged; on Unix the file is chmod'd to owner-only.
fn write_ai_key(
    app: &tauri::AppHandle,
    provider: AiProvider,
    key: String,
) -> Result<(), AiConfigFailure> {
    let path = api_key_path(app, provider).map_err(|_| settings_unavailable_failure())?;
    let trimmed = key.trim();

    if trimmed.is_empty() {
        return match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(settings_unavailable_failure()),
        };
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| settings_unavailable_failure())?;
    }
    let body = serde_json::to_string(&StoredApiKey {
        api_key: trimmed.to_string(),
    })
    .map_err(|_| settings_unavailable_failure())?;
    std::fs::write(&path, body).map_err(|_| settings_unavailable_failure())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|_| settings_unavailable_failure())?;
    }

    Ok(())
}

#[tauri::command]
fn set_ai_key(app: tauri::AppHandle, provider: AiProvider, key: String) -> AiKeyWriteOutcome {
    match write_ai_key(&app, provider, key) {
        Ok(()) => AiKeyWriteOutcome::Saved,
        Err(failure) => AiKeyWriteOutcome::Failure { failure },
    }
}

// ── AI diagnostics ───────────────────────────────────────────────────────────

const AGENT_FAILURE_LOG_RETENTION: Duration = Duration::from_secs(24 * 60 * 60);
const AGENT_FAILURE_LOG_MAX_ENTRIES: usize = 1_000;
const AGENT_FAILURE_LOG_MAX_ENTRY_BYTES: usize = 16 * 1024;
static AGENT_FAILURE_LOG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentToolFailureChangeTarget {
    kind: String,
    target_id: Option<String>,
    after_id: Option<String>,
    to_index: Option<i64>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum AgentFailureLogKind {
    Tool,
    Run,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentFailureLogEntry {
    kind: AgentFailureLogKind,
    occurred_at: String,
    run_id: String,
    provider: AiProvider,
    model_id: Option<String>,
    task: serde_json::Value,
    tool_name: Option<String>,
    tool_call_id: Option<String>,
    change_targets: Option<Vec<AgentToolFailureChangeTarget>>,
    error_code: String,
    error: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentFailureLog {
    window_started_at_ms: u64,
    entries: Vec<serde_json::Value>,
}

fn agent_failure_log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no app config dir: {e}"))?;
    Ok(base.join("logs").join("ai-failures.json"))
}

fn agent_failure_log_lock() -> &'static Mutex<()> {
    AGENT_FAILURE_LOG_LOCK.get_or_init(|| Mutex::new(()))
}

fn millis_since_unix_epoch(now: SystemTime) -> Result<u64, String> {
    let elapsed = now
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("cannot determine current time: {e}"))?;
    u64::try_from(elapsed.as_millis())
        .map_err(|_| "current time is outside the supported log range".to_string())
}

fn truncate_agent_failure_log_text(value: &str, max_characters: usize) -> String {
    let mut characters = value.chars();
    let text: String = characters.by_ref().take(max_characters).collect();
    if characters.next().is_none() {
        text
    } else {
        format!("{text} [truncated]")
    }
}

fn agent_failure_log_field(
    entry: &serde_json::Value,
    name: &str,
    max_characters: usize,
) -> serde_json::Value {
    entry
        .get(name)
        .and_then(serde_json::Value::as_str)
        .map(|value| {
            serde_json::Value::String(truncate_agent_failure_log_text(value, max_characters))
        })
        .unwrap_or(serde_json::Value::Null)
}

fn compact_agent_failure_log_entry(entry: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "kind": agent_failure_log_field(entry, "kind", 128),
        "occurredAt": agent_failure_log_field(entry, "occurredAt", 128),
        "runId": agent_failure_log_field(entry, "runId", 128),
        "provider": agent_failure_log_field(entry, "provider", 64),
        "modelId": agent_failure_log_field(entry, "modelId", 128),
        "toolName": agent_failure_log_field(entry, "toolName", 128),
        "toolCallId": agent_failure_log_field(entry, "toolCallId", 128),
        "errorCode": agent_failure_log_field(entry, "errorCode", 128),
        "error": agent_failure_log_field(entry, "error", 1_024),
        "truncated": true,
    })
}

fn bound_agent_failure_log_entry(entry: serde_json::Value) -> Result<serde_json::Value, String> {
    let encoded = serde_json::to_vec(&entry)
        .map_err(|error| format!("cannot serialize agent failure entry: {error}"))?;
    if encoded.len() <= AGENT_FAILURE_LOG_MAX_ENTRY_BYTES {
        return Ok(entry);
    }
    Ok(compact_agent_failure_log_entry(&entry))
}

fn append_agent_failure_log_entry(
    path: &Path,
    entry: serde_json::Value,
    now: SystemTime,
) -> Result<(), String> {
    let now_ms = millis_since_unix_epoch(now)?;
    let entry = bound_agent_failure_log_entry(entry)?;
    let mut log = match std::fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or(AgentFailureLog {
            window_started_at_ms: now_ms,
            entries: Vec::new(),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => AgentFailureLog {
            window_started_at_ms: now_ms,
            entries: Vec::new(),
        },
        Err(error) => return Err(format!("cannot read {}: {error}", path.display())),
    };
    let entries = std::mem::take(&mut log.entries);
    log.entries = entries
        .into_iter()
        .map(bound_agent_failure_log_entry)
        .collect::<Result<Vec<_>, _>>()?;
    let should_rotate = match UNIX_EPOCH
        .checked_add(Duration::from_millis(log.window_started_at_ms))
        .and_then(|window_started_at| now.duration_since(window_started_at).ok())
    {
        Some(elapsed) => elapsed >= AGENT_FAILURE_LOG_RETENTION,
        None => true,
    };
    if should_rotate {
        log = AgentFailureLog {
            window_started_at_ms: now_ms,
            entries: vec![entry],
        };
    } else {
        log.entries.push(entry);
        if log.entries.len() > AGENT_FAILURE_LOG_MAX_ENTRIES {
            let first_retained = log.entries.len() - AGENT_FAILURE_LOG_MAX_ENTRIES;
            log.entries = log.entries.split_off(first_retained);
        }
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    }
    let body = serde_json::to_string_pretty(&log)
        .map_err(|error| format!("cannot serialize agent failure log: {error}"))?;
    std::fs::write(path, body)
        .map_err(|error| format!("cannot write {}: {error}", path.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("cannot set permissions on {}: {error}", path.display()))?;
    }

    Ok(())
}

#[tauri::command]
fn append_agent_failure_log(
    app: tauri::AppHandle,
    entry: AgentFailureLogEntry,
) -> Result<(), String> {
    let entry = serde_json::to_value(entry)
        .map_err(|error| format!("cannot serialize agent failure: {error}"))?;
    let path = agent_failure_log_path(&app)?;
    let _guard = agent_failure_log_lock()
        .lock()
        .map_err(|_| "agent failure log is unavailable".to_string())?;
    append_agent_failure_log_entry(&path, entry, SystemTime::now())
}

// ── App data (recents, per-project metadata) ─────────────────────────────────

/// Read an opaque JSON blob previously stored under `key`, or `None`.
#[tauri::command]
fn read_app_data(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let path = app_data_path(&app, &key)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot read {}: {e}", path.display())),
    }
}

/// Store an opaque JSON blob under `key` in the app config dir.
#[tauri::command]
fn write_app_data(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let path = app_data_path(&app, &key)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    std::fs::write(&path, value).map_err(|e| format!("cannot write {}: {e}", path.display()))
}

/// Build the on-disk path for an app-data key: `<app_config_dir>/data/<key>.json`.
/// The key is sanitized to a safe filename so it can never escape the data dir.
fn app_data_path(app: &tauri::AppHandle, key: &str) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no app config dir: {e}"))?;
    let safe = sanitize_key(key);
    Ok(base.join("data").join(format!("{safe}.json")))
}

/// Reduce an arbitrary key to a single safe filename component (alphanumerics,
/// `-`, `_`, `.` preserved; everything else becomes `_`). Empty keys map to a
/// stable placeholder so a path is always produced.
fn sanitize_key(key: &str) -> String {
    let mut out = String::with_capacity(key.len());
    for ch in key.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    // Guard against `.`/`..` resolving to the data dir itself or its parent.
    let out = out.trim_matches('.').to_string();
    if out.is_empty() {
        "_".to_string()
    } else {
        out
    }
}

// ── Path safety ───────────────────────────────────────────────────────────────

/// Resolve `path` (absolute or relative to `root`) and refuse anything that
/// escapes `root`. The check canonicalizes `root` and the resolved target's
/// existing prefix so symlinks and `..` segments can't break out.
fn resolve_within_root(root: &str, path: &str) -> Result<PathBuf, String> {
    let root_canon = Path::new(root)
        .canonicalize()
        .map_err(|e| format!("invalid project root {root}: {e}"))?;

    let candidate = {
        let p = Path::new(path);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            root_canon.join(p)
        }
    };

    // Normalize lexically (resolve `.`/`..`) without requiring the file to
    // exist yet (writes create new files). This collapses traversal segments
    // before the prefix check.
    let normalized = lexical_normalize(&candidate);

    if !normalized.starts_with(&root_canon) {
        return Err(format!(
            "path {} escapes project root {}",
            normalized.display(),
            root_canon.display()
        ));
    }

    // For an existing target, canonicalize to defeat symlink traversal too.
    if let Ok(real) = normalized.canonicalize() {
        if !real.starts_with(&root_canon) {
            return Err(format!(
                "path {} escapes project root {}",
                real.display(),
                root_canon.display()
            ));
        }
        return Ok(real);
    }

    Ok(normalized)
}

/// Collapse `.` and `..` components lexically (no filesystem access).
fn lexical_normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

// ── Entry ───────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // A GUI launch (Finder/Dock/.dmg) inherits launchd's minimal PATH, hiding
    // user-installed tools (latexmk, pdflatex, git, and gh). Recover the
    // real PATH before any command can spawn a child.
    path_env::repair_path();

    // Persist geometry only — restoring decorations/visibility/fullscreen would
    // fight the frameless custom titlebar on relaunch.
    let window_state_flags = StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED;

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Persist + restore the main window's size/position across launches so it
        // reopens exactly where it was last closed.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags)
                .build(),
        )
        .setup(move |app| {
            // The plugin only flushes state to disk on RunEvent::Exit. Save the
            // instant the main window starts closing (close button / Cmd+Q, which
            // fire CloseRequested before Exit) so geometry is captured even if the
            // plugin's Exit save is skipped. A hard kill (Ctrl+C / SIGINT, force-quit
            // / SIGKILL) runs no event loop, so neither path can persist there.
            if let Some(window) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        let _ = handle.save_window_state(window_state_flags);
                    }
                });
            }

            // macOS only: add a "Check for Updates" item to the native
            // application menu. It emits `check-for-updates`, which the webview's
            // UpdateChecker handles. Other platforms keep their default chrome
            // (the window is frameless, so no in-window menubar).
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, MenuItemBuilder};
                use tauri::Emitter;

                let menu = Menu::default(app.handle())?;
                let check = MenuItemBuilder::with_id("check-for-updates", "Check for Updates")
                    .build(app)?;
                let whats_new =
                    MenuItemBuilder::with_id("show-whats-new", "What's New").build(app)?;

                let items = menu.items()?;
                if let Some(app_submenu) = items.first().and_then(|kind| kind.as_submenu()) {
                    app_submenu.insert(&check, 1)?;
                    app_submenu.insert(&whats_new, 2)?;
                }

                app.set_menu(menu)?;
                app.on_menu_event(move |app_handle, event| {
                    if event.id() == check.id() {
                        let _ = app_handle.emit("check-for-updates", ());
                    } else if event.id() == whats_new.id() {
                        let _ = app_handle.emit("show-whats-new", ());
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_project,
            create_project,
            write_skeleton,
            delete_chapter,
            migrate_to_managed,
            read_project_meta,
            write_project_meta,
            read_text_file,
            write_text_file,
            compile_project,
            pdf_path,
            read_pdf,
            get_ai_config,
            get_ai_key_status,
            set_ai_key,
            append_agent_failure_log,
            read_app_data,
            write_app_data,
            git::git_tooling_status,
            git::git_repo_status,
            git::git_diff,
            git::sync_project,
            git::gh_check_repo_name,
            git::enable_backup_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod capability_tests {
    use super::{
        append_agent_failure_log_entry, key_status_from_storage, provider_key_filename,
        read_stored_key_path, AiConfigOutcome, AiKeyStatus, AiProvider, StoredKeyState,
    };
    use serde_json::{json, Value};
    use std::time::{Duration, SystemTime};

    #[test]
    fn ai_providers_use_separate_key_files() {
        let openrouter: AiProvider = serde_json::from_str("\"openrouter\"")
            .expect("OpenRouter must deserialize from the frontend value");
        assert_eq!(provider_key_filename(AiProvider::Openai), "openai_key.json");
        assert_eq!(provider_key_filename(openrouter), "openrouter_key.json");
    }

    #[test]
    fn key_status_distinguishes_a_missing_key_from_unavailable_storage() {
        let directory = tempfile::tempdir().expect("temporary directory must be available");
        let path = directory.path().join("openai_key.json");

        let missing = key_status_from_storage(read_stored_key_path(&path));
        assert!(matches!(missing, AiKeyStatus::Missing));

        std::fs::write(&path, "not valid key storage")
            .expect("corrupt key storage fixture must be written");
        let unavailable = key_status_from_storage(read_stored_key_path(&path));
        match unavailable {
            AiKeyStatus::Unavailable { failure } => {
                assert_eq!(failure.reason, "settings-unavailable");
                assert_eq!(failure.message, "AI settings are unavailable. Retry.");
                assert_eq!(failure.action, "retry");
                assert_eq!(failure.settings_target, None);
            }
            AiKeyStatus::Configured | AiKeyStatus::Missing => {
                panic!("corrupt key storage must be unavailable")
            }
        }

        match read_stored_key_path(&path) {
            Ok(StoredKeyState::Configured(_)) | Ok(StoredKeyState::Missing) => {
                panic!("corrupt key storage must not produce a key state")
            }
            Err(_) => {}
        }
    }

    #[test]
    fn configured_key_outcomes_use_the_frontend_api_key_field() {
        assert_eq!(
            serde_json::to_value(AiConfigOutcome::Configured {
                api_key: "test-key".to_string(),
            })
            .expect("configured key outcome must serialize"),
            json!({ "status": "configured", "apiKey": "test-key" })
        );
    }

    #[test]
    fn http_capability_allows_model_metadata_endpoint() {
        let capability: Value = serde_json::from_str(include_str!("../capabilities/default.json"))
            .expect("default capability must be valid JSON");
        let http = capability["permissions"]
            .as_array()
            .expect("permissions must be an array")
            .iter()
            .find(|permission| permission["identifier"] == "http:default")
            .expect("http:default permission must exist");
        let urls: Vec<&str> = http["allow"]
            .as_array()
            .expect("http allowlist must be an array")
            .iter()
            .map(|entry| {
                entry["url"]
                    .as_str()
                    .expect("http allowlist entries must contain URLs")
            })
            .collect();

        assert!(urls.contains(&"https://models.dev/*"));
        assert!(urls.contains(&"https://openrouter.ai/*"));
    }

    #[test]
    fn agent_failure_log_appends_inside_the_retention_window() {
        let directory = tempfile::tempdir().expect("temporary directory must be available");
        let path = directory.path().join("ai-failures.json");
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);

        append_agent_failure_log_entry(&path, json!({ "runId": "run-1" }), now)
            .expect("first failure must be written");
        append_agent_failure_log_entry(
            &path,
            json!({ "runId": "run-2" }),
            now + Duration::from_secs(23 * 60 * 60 + 59 * 60 + 59),
        )
        .expect("second failure must be appended");

        assert_eq!(
            serde_json::from_str::<Value>(
                &std::fs::read_to_string(path).expect("log must be readable"),
            )
            .expect("log must be valid JSON"),
            json!({
                "windowStartedAtMs": 1_000_000_000u64,
                "entries": [{ "runId": "run-1" }, { "runId": "run-2" }],
            })
        );
    }

    #[test]
    fn agent_failure_log_replaces_entries_after_twenty_four_hours() {
        let directory = tempfile::tempdir().expect("temporary directory must be available");
        let path = directory.path().join("ai-failures.json");
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        append_agent_failure_log_entry(&path, json!({ "runId": "expired" }), now)
            .expect("expired failure must be written");
        let fresh_at = now + Duration::from_secs(24 * 60 * 60);

        append_agent_failure_log_entry(&path, json!({ "runId": "fresh" }), fresh_at)
            .expect("fresh failure must be written");

        assert_eq!(
            serde_json::from_str::<Value>(
                &std::fs::read_to_string(path).expect("log must be readable"),
            )
            .expect("log must be valid JSON"),
            json!({
                "windowStartedAtMs": 1_086_400_000u64,
                "entries": [{ "runId": "fresh" }],
            })
        );
    }

    #[test]
    fn agent_failure_log_keeps_only_the_most_recent_thousand_entries() {
        let directory = tempfile::tempdir().expect("temporary directory must be available");
        let path = directory.path().join("ai-failures.json");
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);

        for index in 1..=1_001 {
            append_agent_failure_log_entry(&path, json!({ "runId": format!("run-{index}") }), now)
                .expect("failure must be written");
        }

        let log: Value =
            serde_json::from_str(&std::fs::read_to_string(path).expect("log must be readable"))
                .expect("log must be valid JSON");
        let entries = log["entries"]
            .as_array()
            .expect("log entries must be an array");

        assert_eq!(entries.len(), 1_000);
        assert_eq!(entries[0], json!({ "runId": "run-2" }));
        assert_eq!(entries[999], json!({ "runId": "run-1001" }));
    }

    #[test]
    fn agent_failure_log_truncates_oversized_entries() {
        let directory = tempfile::tempdir().expect("temporary directory must be available");
        let path = directory.path().join("ai-failures.json");
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let payload = vec!["x".repeat(2_048); 100];

        append_agent_failure_log_entry(
            &path,
            json!({
                "kind": "tool",
                "occurredAt": "2026-08-02T12:00:00.000Z",
                "runId": "run-1",
                "error": "Block not found: missing-block",
                "payload": payload,
            }),
            now,
        )
        .expect("oversized failure must be written");

        let log: Value =
            serde_json::from_str(&std::fs::read_to_string(path).expect("log must be readable"))
                .expect("log must be valid JSON");
        let entry = &log["entries"][0];

        assert_eq!(entry["truncated"], true);
        assert!(
            serde_json::to_vec(entry)
                .expect("entry must serialize")
                .len()
                <= 16 * 1024
        );
    }

    #[cfg(unix)]
    #[test]
    fn agent_failure_log_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().expect("temporary directory must be available");
        let path = directory.path().join("ai-failures.json");
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);

        append_agent_failure_log_entry(&path, json!({ "runId": "run-1" }), now)
            .expect("failure must be written");

        let permissions = std::fs::metadata(path)
            .expect("log metadata must be readable")
            .permissions();
        assert_eq!(permissions.mode() & 0o777, 0o600);
    }
}
