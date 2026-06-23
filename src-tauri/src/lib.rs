//! aproprose — Rust backend.
//!
//! The webview is untrusted UI: every privileged operation (filesystem,
//! latexmk, reading the OpenAI key) lives here and is exposed as a narrow
//! `#[tauri::command]`. The command names + argument shapes are the contract
//! defined by `src/lib/tauri.ts`; Tauri maps the JS camelCase argument keys to
//! these snake_case parameters.

pub mod compile;
pub mod novel;
pub mod project;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use tauri::Manager;

use compile::CompileResult;
use project::ProjectInfo;

// ── Project ─────────────────────────────────────────────────────────────────

/// Parse a project directory: locate the main `.tex`, read title/author, and
/// enumerate the `\chapter{…}` / `\input{…}` pairs.
#[tauri::command]
fn open_project(root: String) -> Result<ProjectInfo, String> {
    project::open_project(Path::new(&root))
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
// bundle, never logged. Two dev-only fallbacks remain so contributors can run the
// app without clicking through Settings: the `OPENAI_API_KEY` process env var and
// a `.env` file. The stored key always wins so the in-app choice is authoritative.

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

/// Resolve the API key by precedence: the key saved in Settings wins, then the
/// `OPENAI_API_KEY` process env var, then a `.env` file (both dev fallbacks).
fn resolve_api_key(app: &tauri::AppHandle) -> Option<String> {
    if let Some(key) = read_stored_key(app) {
        return Some(key);
    }
    if let Ok(key) = std::env::var("OPENAI_API_KEY") {
        if !key.trim().is_empty() {
            return Some(key);
        }
    }
    load_env_key("OPENAI_API_KEY")
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

/// Find a `.env` file by walking up from the manifest dir and the current dir,
/// and return the requested key's value. Never logs the value.
///
/// Public so integration tests can exercise the exact resolution the
/// `get_ai_config` command relies on without going through the Tauri bridge.
pub fn load_env_key(key: &str) -> Option<String> {
    let mut roots: Vec<PathBuf> = Vec::new();
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd);
    }

    for start in roots {
        let mut dir: Option<&Path> = Some(start.as_path());
        while let Some(d) = dir {
            let candidate = d.join(".env");
            if candidate.is_file() {
                if let Ok(iter) = dotenvy::from_path_iter(&candidate) {
                    for (k, v) in iter.flatten() {
                        if k == key && !v.trim().is_empty() {
                            return Some(v);
                        }
                    }
                }
            }
            dir = d.parent();
        }
    }
    None
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .invoke_handler(tauri::generate_handler![
            open_project,
            read_text_file,
            write_text_file,
            compile_project,
            read_pdf,
            get_ai_config,
            has_openai_key,
            set_openai_key,
            read_app_data,
            write_app_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
