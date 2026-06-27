//! ai_cli.rs - subscription AI providers backed by local CLIs (codex, claude).
//!
//! The webview cannot spawn processes, so the CLIs run here. We detect each CLI
//! and its existing login, and (in the generate command) drive it non-interactively
//! with native JSON-schema output. We never drive `codex login` / `claude login`;
//! the user authenticates in their terminal and we report status.

use serde::{Deserialize, Serialize};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CliKind {
    Codex,
    Claude,
}

/// Status of a CLI provider, surfaced in Settings. Mirrors `CliProviderStatus`
/// in `src/lib/tauri.ts`. `installed` reflects whether the binary is on PATH and
/// is independent of `version` (a present binary with a quirky `--version` is
/// still installed).
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

struct CliProbe {
    installed: bool,
    version: Option<String>,
}

/// Probe the CLI on PATH. `installed` reflects whether the binary could be
/// spawned at all (false only when the OS reports NotFound), so a present binary
/// whose `--version` exits non-zero or prints nothing is still reported as
/// installed. `version` is the parsed `--version` string when that call succeeds.
fn cli_probe(kind: CliKind) -> CliProbe {
    match Command::new(binary_name(kind)).arg("--version").output() {
        Ok(out) => {
            let version = if out.status.success() {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                (!s.is_empty()).then_some(s)
            } else {
                None
            };
            CliProbe {
                installed: true,
                version,
            }
        }
        Err(e) if e.kind() == ErrorKind::NotFound => CliProbe {
            installed: false,
            version: None,
        },
        // Present but un-runnable for another reason (e.g. permissions): still
        // "installed" - telling the user to install it would be wrong.
        Err(_) => CliProbe {
            installed: true,
            version: None,
        },
    }
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

/// Extract the top-level `model = "<value>"` from codex's config.toml without a
/// TOML dep. Only keys before the first `[section]` header are considered (so a
/// `[profiles.x]` model is never mistaken for the default), and a trailing inline
/// comment is stripped before unquoting.
fn parse_codex_model(toml: &str) -> Option<String> {
    for line in toml.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            // Past the top-level table; section-scoped keys are not the default.
            break;
        }
        if let Some(rest) = line.strip_prefix("model") {
            // Guard against `model_provider = <value>` etc: next must be `=` after ws.
            if let Some(rest) = rest.trim_start().strip_prefix('=') {
                let v = strip_toml_value(rest.trim());
                if !v.is_empty() {
                    return Some(v);
                }
            }
        }
    }
    None
}

/// Strip surrounding quotes and any trailing inline comment from a TOML scalar.
fn strip_toml_value(raw: &str) -> String {
    // Quoted: take the content between the first matching quote pair, dropping a
    // trailing ` # comment` (or anything else) after the closing quote.
    for q in ['"', '\''] {
        if let Some(after) = raw.strip_prefix(q) {
            if let Some(end) = after.find(q) {
                return after[..end].to_string();
            }
        }
    }
    // Bare value: cut at the first `#` inline comment, then trim.
    let end = raw.find('#').unwrap_or(raw.len());
    raw[..end].trim().to_string()
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
    let probe = cli_probe(kind);
    Ok(CliProviderStatus {
        installed: probe.installed,
        authenticated: auth_path(kind, &home).exists(),
        model: resolve_model(kind, &home),
        version: probe.version,
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

/// Whether an env var name looks like it carries a secret (API key/token/secret).
fn is_secret_env_key(key: &str) -> bool {
    let up = key.to_ascii_uppercase();
    up.contains("API_KEY") || up.contains("SECRET") || up.contains("TOKEN") || up.ends_with("_KEY")
}

/// Drop secret-bearing vars from the inherited environment before handing it to a
/// model-driven subprocess. The CLIs read their own credentials from disk, so
/// stripping host API keys/tokens costs them nothing and avoids exposing secrets.
fn scrub_secret_env(cmd: &mut Command) {
    for (key, _) in std::env::vars_os() {
        if key.to_str().map(is_secret_env_key).unwrap_or(false) {
            cmd.env_remove(&key);
        }
    }
}

/// Preflight: the CLI must be installed and signed in before we try to generate.
/// Pure so the user-facing messages (which the Settings flow promises) are tested.
fn guard_ready(installed: bool, authenticated: bool, kind: CliKind) -> Result<(), String> {
    if !installed {
        return Err(format!(
            "{0} CLI not found on PATH - install it, then run `{0} login`.",
            binary_name(kind)
        ));
    }
    if !authenticated {
        return Err(format!(
            "Not signed in to {0} - run `{0} login` in your terminal, then try again.",
            binary_name(kind)
        ));
    }
    Ok(())
}

/// codex exec argv, ending with `-- <prompt>` so a prompt that looks like a flag
/// can never be parsed as one (and thus can never toggle sandbox/approval flags).
fn codex_args(cwd: &str, out_file: &str, schema_file: Option<&str>, prompt: &str) -> Vec<String> {
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
    a.push("--".into());
    a.push(prompt.into());
    a
}

/// claude -p argv, ending with `-- <prompt>`. No --bare: that would disable
/// subscription OAuth. dontAsk denies tools so it cannot edit files. The `--`
/// terminator keeps a prompt that begins with `-`/`--` from being read as a flag.
fn claude_args(system: Option<&str>, schema_json: Option<&str>, prompt: &str) -> Vec<String> {
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
    a.push("--".into());
    a.push(prompt.into());
    a
}

/// Post-process codex's `--output-last-message` contents: reject empty output as
/// an error (with stderr context) rather than letting it pass as a silent empty
/// success, and when a schema was requested parse + reserialize so only canonical
/// JSON reaches the adapter (mirroring claude's `structured_output` path).
fn finalize_codex_output(raw: &str, schema_present: bool, stderr: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        let err = stderr.trim();
        return Err(if err.is_empty() {
            "codex produced no output".to_string()
        } else {
            format!("codex produced no output. stderr: {err}")
        });
    }
    if schema_present {
        let v: serde_json::Value = serde_json::from_str(trimmed)
            .map_err(|e| format!("codex did not return schema-conforming JSON: {e}"))?;
        serde_json::to_string(&v).map_err(|e| format!("cannot reserialize codex output: {e}"))
    } else {
        Ok(trimmed.to_string())
    }
}

/// claude reports model usage under `modelUsage` (a map keyed by model id); take
/// the first key as the model that served the request. The success envelope has
/// no top-level `model` field.
fn claude_model_from_envelope(v: &serde_json::Value) -> Option<String> {
    v.get("modelUsage")?
        .as_object()?
        .keys()
        .next()
        .map(|s| s.to_string())
}

/// Build the most informative error for a non-zero claude exit: prefer the
/// `result` message from a JSON envelope on stdout (rate-limit / auth / credit
/// errors arrive this way), falling back to stderr.
fn claude_failure_message(stdout: &str, stderr: &str) -> String {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(stdout.trim()) {
        if let Some(msg) = v.get("result").and_then(|r| r.as_str()) {
            let msg = msg.trim();
            if !msg.is_empty() {
                return msg.to_string();
            }
        }
    }
    let err = stderr.trim();
    if err.is_empty() {
        "claude exited with an error (no stderr)".to_string()
    } else {
        format!("claude exited with an error: {err}")
    }
}

/// Parse claude's `--output-format json` envelope into our result.
fn parse_claude_output(stdout: &str, want_schema: bool) -> Result<CliGenerateResult, String> {
    let v: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("claude returned non-JSON output: {e}"))?;
    let is_error = match v.get("is_error") {
        None => false,
        Some(serde_json::Value::Bool(b)) => *b,
        // An unparseable error flag is suspicious, not a license to assume success.
        Some(other) => {
            return Err(format!(
                "claude envelope has a non-boolean is_error: {other}"
            ))
        }
    };
    if is_error {
        let msg = match v.get("result") {
            Some(serde_json::Value::String(s)) => s.clone(),
            Some(other) => other.to_string(),
            None => "claude reported an error (no result field in envelope)".to_string(),
        };
        return Err(msg);
    }
    let model = claude_model_from_envelope(&v);
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
    match kind {
        CliKind::Codex => {
            let work_str = work.to_str().ok_or("temp dir path is not valid UTF-8")?;
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
                &full_prompt,
            );
            let mut cmd = Command::new("codex");
            cmd.args(&args).current_dir(work);
            scrub_secret_env(&mut cmd);
            let output = cmd
                .output()
                .map_err(|e| format!("failed to run codex: {e}"))?;
            if !output.status.success() {
                let err = String::from_utf8_lossy(&output.stderr);
                return Err(format!("codex exited with an error: {}", err.trim()));
            }
            let raw = std::fs::read_to_string(&out_file)
                .map_err(|e| format!("cannot read codex output: {e}"))?;
            let stderr = String::from_utf8_lossy(&output.stderr);
            let text = finalize_codex_output(&raw, schema.is_some(), &stderr)?;
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
            let args = claude_args(system, schema_json.as_deref(), prompt);
            let mut cmd = Command::new("claude");
            cmd.args(&args).current_dir(work);
            scrub_secret_env(&mut cmd);
            let output = cmd
                .output()
                .map_err(|e| format!("failed to run claude: {e}"))?;
            let stdout = String::from_utf8_lossy(&output.stdout);
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(claude_failure_message(&stdout, &stderr));
            }
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
    let probe = cli_probe(kind);
    guard_ready(probe.installed, auth_path(kind, &home).exists(), kind)?;

    // tempfile gives a fresh 0700 dir with a random suffix that fails if the path
    // already exists, closing the predictable-name TOCTOU on shared /tmp. The dir
    // is removed by close() below (Drop is the fallback if we return early).
    let dir = tempfile::Builder::new()
        .prefix("aproprose-aicli-")
        .tempdir()
        .map_err(|e| format!("cannot create temp dir: {e}"))?;
    let result = run_cli(
        kind,
        system.as_deref(),
        &prompt,
        schema.as_ref(),
        &home,
        dir.path(),
    );
    if let Err(e) = dir.close() {
        eprintln!("aproprose: failed to clean temp dir: {e}");
    }
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

    // Guards the wire contract these structs hand-mirror in `src/lib/tauri.ts`.
    // A Rust-side rename, a `skip_serializing_if` on an Option, or a CliKind tag
    // change would break this before it silently desyncs the frontend reads.
    #[test]
    fn wire_contract_matches_typescript_mirror() {
        use serde_json::json;

        // Serialize structs use camelCase keys and emit `null` (never omit) for
        // `None`, matching the TS `string | null` fields.
        assert_eq!(
            serde_json::to_value(CliProviderStatus {
                installed: true,
                authenticated: false,
                model: None,
                version: None,
            })
            .unwrap(),
            json!({"installed": true, "authenticated": false, "model": null, "version": null})
        );
        assert_eq!(
            serde_json::to_value(CliGenerateResult {
                text: "hi".into(),
                model: Some("gpt-5-codex".into()),
            })
            .unwrap(),
            json!({"text": "hi", "model": "gpt-5-codex"})
        );

        // CliGenerateArgs deserializes the exact shape the TS `cliGenerate` sends.
        let args: CliGenerateArgs = serde_json::from_value(json!({
            "kind": "claude",
            "system": null,
            "prompt": "go",
            "schema": null,
        }))
        .unwrap();
        assert!(matches!(args.kind, CliKind::Claude));
        assert_eq!(args.prompt, "go");

        // CliKind accepts exactly the two lowercase tags the TS union allows.
        assert!(matches!(
            serde_json::from_value::<CliKind>(json!("codex")).unwrap(),
            CliKind::Codex
        ));
        assert!(serde_json::from_value::<CliKind>(json!("Codex")).is_err());
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
        // No space around `=` still parses.
        assert_eq!(
            parse_codex_model("model=\"gpt-5-codex\"\n").as_deref(),
            Some("gpt-5-codex")
        );
        assert_eq!(parse_codex_model("model_provider = \"openai\"\n"), None);
        assert_eq!(parse_codex_model("# nothing here\n"), None);
    }

    #[test]
    fn codex_model_strips_trailing_inline_comment() {
        assert_eq!(
            parse_codex_model("model = \"gpt-5-codex\" # default\n").as_deref(),
            Some("gpt-5-codex")
        );
        assert_eq!(
            parse_codex_model("model = gpt-5-codex # bare with comment\n").as_deref(),
            Some("gpt-5-codex")
        );
    }

    #[test]
    fn codex_model_ignores_section_scoped_keys() {
        // A model inside a profile/provider table is not the top-level default.
        assert_eq!(
            parse_codex_model("[profiles.foo]\nmodel = \"sneaky\"\n"),
            None
        );
        // The top-level key wins and scanning stops at the first section header.
        assert_eq!(
            parse_codex_model("model = \"gpt-5-codex\"\n[profiles.foo]\nmodel = \"sneaky\"\n")
                .as_deref(),
            Some("gpt-5-codex")
        );
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
    fn claude_model_from_envelope_reads_model_usage() {
        let v: serde_json::Value =
            serde_json::from_str(r#"{"modelUsage":{"claude-opus-4":{"tokens":1}}}"#).unwrap();
        assert_eq!(
            claude_model_from_envelope(&v).as_deref(),
            Some("claude-opus-4")
        );
        let none: serde_json::Value = serde_json::from_str(r#"{"result":"hi"}"#).unwrap();
        assert_eq!(claude_model_from_envelope(&none), None);
    }

    #[test]
    fn is_secret_env_key_matches_secrets_only() {
        for k in [
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "GITHUB_TOKEN",
            "AWS_SECRET_ACCESS_KEY",
            "FOO_KEY",
        ] {
            assert!(is_secret_env_key(k), "{k} should be treated as secret");
        }
        for k in ["PATH", "HOME", "TMPDIR", "USERPROFILE", "MODEL"] {
            assert!(!is_secret_env_key(k), "{k} should not be treated as secret");
        }
    }

    #[test]
    fn guard_ready_reports_missing_and_unauthed() {
        let missing = guard_ready(false, false, CliKind::Codex).unwrap_err();
        assert!(missing.contains("not found on PATH"));
        let unauthed = guard_ready(true, false, CliKind::Claude).unwrap_err();
        assert!(unauthed.contains("Not signed in"));
        assert!(guard_ready(true, true, CliKind::Codex).is_ok());
    }

    #[test]
    fn codex_args_omit_schema_when_none() {
        let a = codex_args("/tmp/w", "/tmp/w/out.txt", None, "do it");
        assert_eq!(a[0], "exec");
        assert!(a
            .windows(2)
            .any(|w| w[0] == "--sandbox" && w[1] == "read-only"));
        assert!(a
            .windows(2)
            .any(|w| w[0] == "-o" && w[1] == "/tmp/w/out.txt"));
        assert!(!a.iter().any(|s| s == "--output-schema"));
        assert!(a.iter().any(|s| s == "--skip-git-repo-check"));
        assert!(a.iter().any(|s| s == "--ephemeral"));
        assert_eq!(&a[a.len() - 2..], &["--".to_string(), "do it".to_string()]);
    }

    #[test]
    fn codex_args_include_schema_when_present() {
        let a = codex_args("/tmp/w", "/tmp/w/out.txt", Some("/tmp/w/schema.json"), "go");
        assert!(a
            .windows(2)
            .any(|w| w[0] == "--output-schema" && w[1] == "/tmp/w/schema.json"));
    }

    #[test]
    fn codex_args_terminate_options_before_prompt() {
        // A prompt that looks like a sandbox-bypass flag must remain the literal,
        // last positional after `--`, never parsed as an option.
        let evil = "--dangerously-bypass-approvals-and-sandbox";
        let a = codex_args("/tmp/w", "/tmp/w/out.txt", None, evil);
        assert_eq!(&a[a.len() - 2..], &["--".to_string(), evil.to_string()]);
    }

    #[test]
    fn claude_args_plain_text() {
        let a = claude_args(Some("be terse"), None, "hello");
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
        assert_eq!(&a[a.len() - 2..], &["--".to_string(), "hello".to_string()]);
    }

    #[test]
    fn claude_args_with_schema() {
        let a = claude_args(None, Some("{\"type\":\"object\"}"), "go");
        assert!(a
            .windows(2)
            .any(|w| w[0] == "--json-schema" && w[1] == "{\"type\":\"object\"}"));
    }

    #[test]
    fn claude_args_terminate_options_before_prompt() {
        let evil = "--dangerously-skip-permissions";
        let a = claude_args(None, None, evil);
        assert_eq!(&a[a.len() - 2..], &["--".to_string(), evil.to_string()]);
    }

    #[test]
    fn finalize_codex_output_rejects_empty_with_stderr() {
        let e = finalize_codex_output("   \n", false, "model declined").unwrap_err();
        assert!(e.contains("no output"));
        assert!(e.contains("model declined"));
        let e2 = finalize_codex_output("", false, "").unwrap_err();
        assert!(e2.contains("no output"));
    }

    #[test]
    fn finalize_codex_output_passes_trimmed_free_text() {
        assert_eq!(
            finalize_codex_output("  hello world \n", false, "").unwrap(),
            "hello world"
        );
    }

    #[test]
    fn finalize_codex_output_reserializes_schema_json() {
        assert_eq!(
            finalize_codex_output("{\"a\":1}", true, "").unwrap(),
            "{\"a\":1}"
        );
        let e = finalize_codex_output("not json at all", true, "").unwrap_err();
        assert!(e.contains("schema-conforming"));
    }

    #[test]
    fn parse_claude_plain_text() {
        let r = parse_claude_output(
            r#"{"is_error":false,"result":"hello","modelUsage":{"claude-x":{}}}"#,
            false,
        )
        .unwrap();
        assert_eq!(r.text, "hello");
        assert_eq!(r.model.as_deref(), Some("claude-x"));
    }

    #[test]
    fn parse_claude_structured_reserializes_object() {
        let r = parse_claude_output(
            r#"{"is_error":false,"structured_output":{"a":1},"modelUsage":{"claude-x":{}}}"#,
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

    #[test]
    fn parse_claude_non_bool_is_error_is_surfaced() {
        let e = parse_claude_output(r#"{"is_error":"yes","result":"x"}"#, false).unwrap_err();
        assert!(e.contains("non-boolean"));
    }

    #[test]
    fn parse_claude_missing_structured_output_errors() {
        let e = parse_claude_output(r#"{"is_error":false,"modelUsage":{"claude-x":{}}}"#, true)
            .unwrap_err();
        assert!(e.contains("structured_output"));
    }

    #[test]
    fn claude_failure_message_prefers_envelope_result() {
        let msg = claude_failure_message(r#"{"is_error":true,"result":"rate limited"}"#, "");
        assert_eq!(msg, "rate limited");
    }

    #[test]
    fn claude_failure_message_falls_back_to_stderr() {
        let msg = claude_failure_message("not an envelope", "auth failed");
        assert!(msg.contains("auth failed"));
        let msg2 = claude_failure_message("", "");
        assert!(msg2.contains("no stderr"));
    }
}
