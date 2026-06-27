//! ai_cli.rs - subscription AI providers backed by local CLIs (codex, claude).
//!
//! The webview cannot spawn processes, so the CLIs run here. We detect each CLI
//! and its existing login, and (in the generate command) drive it non-interactively
//! with native JSON-schema output. We never drive `codex login` / `claude login`;
//! the user authenticates in their terminal and we report status.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CliKind {
    Codex,
    Claude,
}

/// Status of a CLI provider, surfaced in Settings. Mirrors `CliProviderStatus`
/// in `src/lib/tauri.ts`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProviderStatus {
    installed: bool,
    authenticated: bool,
    model: Option<String>,
    version: Option<String>,
}

fn binary_name(kind: CliKind) -> &'static str {
    match kind {
        CliKind::Codex => "codex",
        CliKind::Claude => "claude",
    }
}

/// File whose presence indicates the user has logged the CLI in.
fn auth_path(kind: CliKind, home: &Path) -> PathBuf {
    match kind {
        CliKind::Codex => home.join(".codex").join("auth.json"),
        CliKind::Claude => home.join(".claude").join(".credentials.json"),
    }
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "cannot resolve home directory".to_string())
}

/// Run `<cli> --version`; `None` when the binary is missing or errors.
fn cli_version(kind: CliKind) -> Option<String> {
    let out = Command::new(binary_name(kind)).arg("--version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

/// Best-effort resolved default model from the CLI's own config.
fn resolve_model(kind: CliKind, home: &Path) -> Option<String> {
    match kind {
        CliKind::Codex => {
            let toml = std::fs::read_to_string(home.join(".codex").join("config.toml")).ok()?;
            parse_codex_model(&toml)
        }
        CliKind::Claude => {
            let json = std::fs::read_to_string(home.join(".claude").join("settings.json")).ok()?;
            parse_claude_model(&json)
        }
    }
}

/// Extract a top-level `model = "..."` from codex's config.toml without a TOML dep.
fn parse_codex_model(toml: &str) -> Option<String> {
    for line in toml.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("model") {
            // Guard against `model_provider = ...` etc: next must be `=` after ws.
            if let Some(rest) = rest.trim_start().strip_prefix('=') {
                let v = rest.trim().trim_matches('"').trim().to_string();
                if !v.is_empty() {
                    return Some(v);
                }
            }
        }
    }
    None
}

/// Extract a top-level `"model"` from claude's settings.json.
fn parse_claude_model(json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    v.get("model")?.as_str().map(|s| s.to_string())
}

/// Detect a CLI provider and its login. Never spawns the agent itself.
#[tauri::command]
pub fn cli_provider_status(kind: CliKind) -> Result<CliProviderStatus, String> {
    let home = home_dir()?;
    let version = cli_version(kind);
    Ok(CliProviderStatus {
        installed: version.is_some(),
        authenticated: auth_path(kind, &home).exists(),
        model: resolve_model(kind, &home),
        version,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_paths_are_per_cli() {
        let h = Path::new("/home/u");
        assert!(auth_path(CliKind::Codex, h).ends_with(".codex/auth.json"));
        assert!(auth_path(CliKind::Claude, h).ends_with(".claude/.credentials.json"));
    }

    #[test]
    fn binary_names() {
        assert_eq!(binary_name(CliKind::Codex), "codex");
        assert_eq!(binary_name(CliKind::Claude), "claude");
    }

    #[test]
    fn codex_model_parses_and_ignores_model_provider() {
        assert_eq!(
            parse_codex_model("model = \"gpt-5-codex\"\n").as_deref(),
            Some("gpt-5-codex")
        );
        assert_eq!(parse_codex_model("model_provider = \"openai\"\n"), None);
        assert_eq!(parse_codex_model("# nothing here\n"), None);
    }

    #[test]
    fn claude_model_parses_from_settings() {
        assert_eq!(
            parse_claude_model(r#"{"model":"claude-x","other":1}"#).as_deref(),
            Some("claude-x")
        );
        assert_eq!(parse_claude_model("{}"), None);
    }
}
