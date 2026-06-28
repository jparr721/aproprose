//! aproprose — Rust backend.
//!
//! The webview is untrusted UI: every privileged operation (filesystem,
//! latexmk, reading the OpenAI key) lives here and is exposed as a narrow
//! `#[tauri::command]`. The command names + argument shapes are the contract
//! defined by `src/lib/tauri.ts`; Tauri maps the JS camelCase argument keys to
//! these snake_case parameters.

pub mod ai_cli;
pub mod compile;
pub mod git;
pub mod novel;
pub mod path_env;
pub mod project;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use tauri::Manager;

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
// The OpenAI key is entered by the user in the app's Settings and stored as a
// plaintext JSON file in the app-config dir (`openai_key.json`). It is read here
// and handed to the frontend AI layer at runtime — never written into the JS
// bundle, never logged. There is no environment or `.env` fallback: the key comes
// only from what the user saved in Settings.

/// The OpenAI key handed to the frontend AI layer. Mirrors `AiConfig` in
/// `src/lib/tauri.ts`. The key is read here and never logged.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiConfig {
    api_key: String,
}

/// On-disk shape of the stored key (`<app_config_dir>/openai_key.json`).
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredApiKey {
    api_key: String,
}

/// Path of the stored-key file in the app config dir.
fn openai_key_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no app config dir: {e}"))?;
    Ok(base.join("openai_key.json"))
}

/// Read the key the user saved in Settings, if any (trimmed, non-empty).
fn read_stored_key(app: &tauri::AppHandle) -> Option<String> {
    let path = openai_key_path(app).ok()?;
    let raw = std::fs::read_to_string(&path).ok()?;
    let parsed: StoredApiKey = serde_json::from_str(&raw).ok()?;
    let key = parsed.api_key.trim().to_string();
    (!key.is_empty()).then_some(key)
}

/// Return the API key the user saved in Settings, or `None` when none is stored.
fn resolve_api_key(app: &tauri::AppHandle) -> Option<String> {
    read_stored_key(app)
}

/// Return the resolved OpenAI key for the frontend AI layer, or an actionable
/// error when none is configured.
#[tauri::command]
fn get_ai_config(app: tauri::AppHandle) -> Result<AiConfig, String> {
    resolve_api_key(&app)
        .map(|api_key| AiConfig { api_key })
        .ok_or_else(|| "No OpenAI API key set — add one in Settings.".to_string())
}

/// Whether a usable key is available from any source. Lets the Settings UI show
/// configured/not-configured state without ever reading the secret back into JS.
#[tauri::command]
fn has_openai_key(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(resolve_api_key(&app).is_some())
}

/// Save (or, when `key` is blank, clear) the user's OpenAI key in the app config
/// dir. The value is never logged; on Unix the file is chmod'd to owner-only.
#[tauri::command]
fn set_openai_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let path = openai_key_path(&app)?;
    let trimmed = key.trim();

    if trimmed.is_empty() {
        return match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("cannot remove {}: {e}", path.display())),
        };
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    let body = serde_json::to_string(&StoredApiKey {
        api_key: trimmed.to_string(),
    })
    .map_err(|e| format!("cannot serialize key: {e}"))?;
    std::fs::write(&path, body).map_err(|e| format!("cannot write {}: {e}", path.display()))?;

    // Best effort: keep the secret readable only by the owner.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }

    Ok(())
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
    // user-installed tools (latexmk, the Codex/Claude CLIs, git/gh). Recover the
    // real PATH before any command can spawn a child.
    path_env::repair_path();

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
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
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
            #[cfg(not(target_os = "macos"))]
            let _ = app;
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
            has_openai_key,
            set_openai_key,
            ai_cli::cli_provider_status,
            ai_cli::cli_generate,
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
