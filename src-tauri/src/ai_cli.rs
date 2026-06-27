//! ai_cli.rs - subscription AI providers backed by local CLIs (codex, claude).
//!
//! The webview cannot spawn processes, so the CLIs run here. We detect each CLI
//! and its existing login, and (in the generate command) drive it non-interactively
//! with native JSON-schema output. We never drive `codex login` / `claude login`;
//! the user authenticates in their terminal and we report status.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};

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
    let out = Command::new(binary_name(kind))
        .arg("--version")
        .output()
        .ok()?;
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
                let v = rest.trim();
                let v = v
                    .strip_prefix('"')
                    .and_then(|s| s.strip_suffix('"'))
                    .or_else(|| v.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')))
                    .unwrap_or(v)
                    .trim()
                    .to_string();
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliGenerateArgs {
    kind: CliKind,
    system: Option<String>,
    prompt: String,
    /// Optional JSON Schema (from the AI SDK responseFormat) the output must match.
    schema: Option<serde_json::Value>,
}

/// Mirrors `CliGenerateResult` in `src/lib/tauri.ts`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliGenerateResult {
    text: String,
    model: Option<String>,
}

static SEQ: AtomicU32 = AtomicU32::new(0);

/// Unique throwaway dir under the OS temp dir (mirrors git.rs's convention).
fn unique_temp(prefix: &str) -> PathBuf {
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("{prefix}-{}-{}", std::process::id(), n))
}

/// codex exec flags (prompt is passed separately as a positional arg).
fn codex_args(cwd: &str, out_file: &str, schema_file: Option<&str>) -> Vec<String> {
    let mut a = vec![
        "exec".into(),
        "--skip-git-repo-check".into(),
        "--ephemeral".into(),
        "--sandbox".into(),
        "read-only".into(),
        "-C".into(),
        cwd.into(),
        "-o".into(),
        out_file.into(),
    ];
    if let Some(s) = schema_file {
        a.push("--output-schema".into());
        a.push(s.into());
    }
    a
}

/// claude -p flags (prompt is passed separately as a positional arg). No --bare:
/// that would disable subscription OAuth. dontAsk denies tools so it cannot edit files.
fn claude_args(system: Option<&str>, schema_json: Option<&str>) -> Vec<String> {
    let mut a = vec![
        "-p".into(),
        "--output-format".into(),
        "json".into(),
        "--permission-mode".into(),
        "dontAsk".into(),
    ];
    if let Some(sys) = system {
        a.push("--system-prompt".into());
        a.push(sys.into());
    }
    if let Some(schema) = schema_json {
        a.push("--json-schema".into());
        a.push(schema.into());
    }
    a
}

/// Parse claude's `--output-format json` envelope into our result.
fn parse_claude_output(stdout: &str, want_schema: bool) -> Result<CliGenerateResult, String> {
    let v: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("claude returned non-JSON output: {e}"))?;
    if v.get("is_error").and_then(|b| b.as_bool()).unwrap_or(false) {
        let msg = v
            .get("result")
            .and_then(|r| r.as_str())
            .unwrap_or("claude reported an error");
        return Err(msg.to_string());
    }
    let model = v
        .get("model")
        .and_then(|m| m.as_str())
        .map(|s| s.to_string());
    let text = if want_schema {
        let so = v
            .get("structured_output")
            .ok_or("claude response had no structured_output")?;
        serde_json::to_string(so)
            .map_err(|e| format!("cannot reserialize structured_output: {e}"))?
    } else {
        v.get("result")
            .and_then(|r| r.as_str())
            .ok_or("claude response had no result field")?
            .to_string()
    };
    Ok(CliGenerateResult { text, model })
}

fn run_cli(
    kind: CliKind,
    system: Option<&str>,
    prompt: &str,
    schema: Option<&serde_json::Value>,
    home: &Path,
    work: &Path,
) -> Result<CliGenerateResult, String> {
    let work_str = work.to_str().ok_or("temp dir path is not valid UTF-8")?;
    match kind {
        CliKind::Codex => {
            let out_file = work.join("out.txt");
            let out_str = out_file.to_str().ok_or("temp path not UTF-8")?;
            let schema_file = match schema {
                Some(s) => {
                    let p = work.join("schema.json");
                    std::fs::write(&p, serde_json::to_string(s).map_err(|e| e.to_string())?)
                        .map_err(|e| format!("cannot write schema: {e}"))?;
                    Some(p)
                }
                None => None,
            };
            let full_prompt = match system {
                Some(s) => format!("{s}\n\n{prompt}"),
                None => prompt.to_string(),
            };
            let args = codex_args(
                work_str,
                out_str,
                schema_file.as_deref().and_then(|p| p.to_str()),
            );
            let output = Command::new("codex")
                .args(&args)
                .arg(&full_prompt)
                .current_dir(work)
                .output()
                .map_err(|e| format!("failed to run codex: {e}"))?;
            if !output.status.success() {
                let err = String::from_utf8_lossy(&output.stderr);
                return Err(format!("codex exited with an error: {}", err.trim()));
            }
            let text = std::fs::read_to_string(&out_file)
                .map_err(|e| format!("cannot read codex output: {e}"))?
                .trim()
                .to_string();
            Ok(CliGenerateResult {
                text,
                model: resolve_model(kind, home),
            })
        }
        CliKind::Claude => {
            let schema_json = match schema {
                Some(s) => Some(serde_json::to_string(s).map_err(|e| e.to_string())?),
                None => None,
            };
            let want_schema = schema_json.is_some();
            let args = claude_args(system, schema_json.as_deref());
            let output = Command::new("claude")
                .args(&args)
                .arg(prompt)
                .current_dir(work)
                .output()
                .map_err(|e| format!("failed to run claude: {e}"))?;
            if !output.status.success() {
                let err = String::from_utf8_lossy(&output.stderr);
                return Err(format!("claude exited with an error: {}", err.trim()));
            }
            let stdout = String::from_utf8_lossy(&output.stdout);
            parse_claude_output(&stdout, want_schema)
        }
    }
}

/// Generate text (or schema-conforming JSON) through the selected CLI's subscription.
#[tauri::command]
pub fn cli_generate(args: CliGenerateArgs) -> Result<CliGenerateResult, String> {
    let CliGenerateArgs {
        kind,
        system,
        prompt,
        schema,
    } = args;
    let home = home_dir()?;
    if cli_version(kind).is_none() {
        return Err(format!(
            "{0} CLI not found on PATH - install it, then run `{0} login`.",
            binary_name(kind)
        ));
    }
    if !auth_path(kind, &home).exists() {
        return Err(format!(
            "Not signed in to {0} - run `{0} login` in your terminal, then try again.",
            binary_name(kind)
        ));
    }

    let work = unique_temp("aproprose-aicli");
    std::fs::create_dir_all(&work).map_err(|e| format!("cannot create temp dir: {e}"))?;
    let result = run_cli(
        kind,
        system.as_deref(),
        &prompt,
        schema.as_ref(),
        &home,
        &work,
    );
    let _ = std::fs::remove_dir_all(&work);
    result
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
        assert_eq!(
            parse_codex_model("model = 'gpt-5-codex'\n").as_deref(),
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

    #[test]
    fn codex_args_omit_schema_when_none() {
        let a = codex_args("/tmp/w", "/tmp/w/out.txt", None);
        assert_eq!(a[0], "exec");
        assert!(a
            .windows(2)
            .any(|w| w[0] == "--sandbox" && w[1] == "read-only"));
        assert!(a
            .windows(2)
            .any(|w| w[0] == "-o" && w[1] == "/tmp/w/out.txt"));
        assert!(!a.iter().any(|s| s == "--output-schema"));
    }

    #[test]
    fn codex_args_include_schema_when_present() {
        let a = codex_args("/tmp/w", "/tmp/w/out.txt", Some("/tmp/w/schema.json"));
        assert!(a
            .windows(2)
            .any(|w| w[0] == "--output-schema" && w[1] == "/tmp/w/schema.json"));
    }

    #[test]
    fn claude_args_plain_text() {
        let a = claude_args(Some("be terse"), None);
        assert!(a
            .windows(2)
            .any(|w| w[0] == "--output-format" && w[1] == "json"));
        assert!(a
            .windows(2)
            .any(|w| w[0] == "--permission-mode" && w[1] == "dontAsk"));
        assert!(a
            .windows(2)
            .any(|w| w[0] == "--system-prompt" && w[1] == "be terse"));
        assert!(!a.iter().any(|s| s == "--json-schema"));
        assert!(!a.iter().any(|s| s == "--bare"));
    }

    #[test]
    fn claude_args_with_schema() {
        let a = claude_args(None, Some("{\"type\":\"object\"}"));
        assert!(a
            .windows(2)
            .any(|w| w[0] == "--json-schema" && w[1] == "{\"type\":\"object\"}"));
    }

    #[test]
    fn parse_claude_plain_text() {
        let r = parse_claude_output(
            r#"{"is_error":false,"result":"hello","model":"claude-x"}"#,
            false,
        )
        .unwrap();
        assert_eq!(r.text, "hello");
        assert_eq!(r.model.as_deref(), Some("claude-x"));
    }

    #[test]
    fn parse_claude_structured_reserializes_object() {
        let r = parse_claude_output(
            r#"{"is_error":false,"structured_output":{"a":1},"model":"claude-x"}"#,
            true,
        )
        .unwrap();
        assert_eq!(r.text, "{\"a\":1}");
    }

    #[test]
    fn parse_claude_error_is_surfaced() {
        let e = parse_claude_output(r#"{"is_error":true,"result":"boom"}"#, false).unwrap_err();
        assert!(e.contains("boom"));
    }
}
