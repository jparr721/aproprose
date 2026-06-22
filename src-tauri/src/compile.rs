//! LaTeX compilation via `latexmk` (falling back to `pdflatex` run twice).
//!
//! The build runs as a child process off the UI thread with a hard timeout.
//! On success the produced PDF is base64-encoded into the result; either way
//! the combined stdout+stderr is returned as the log and scanned for errors so
//! the frontend can surface them inline. Shapes mirror `CompileResult` /
//! `CompileError` in `src/lib/types.ts`.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::process::Command;

/// Hard wall-clock limit for a single compile. Generous: a full book with
/// microtype + multiple passes can take a while on a cold run.
const TIMEOUT: Duration = Duration::from_secs(180);

/// A single parsed build diagnostic. Mirrors `CompileError` in types.ts.
#[derive(Debug, Serialize)]
pub struct CompileError {
    pub file: Option<String>,
    pub line: Option<u32>,
    pub message: String,
}

/// The outcome of a compile. Mirrors `CompileResult` in types.ts.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileResult {
    pub ok: bool,
    pub pdf_base64: Option<String>,
    pub log: String,
    pub errors: Vec<CompileError>,
    pub duration_ms: u64,
}

/// Compile `main_file` (relative to `root`) into a PDF.
pub async fn compile_project(root: &Path, main_file: &str) -> CompileResult {
    let start = Instant::now();

    let (status_ok, log) = run_build(root, main_file).await;

    // The PDF lands next to the main file as `<basename>.pdf`. latexmk writes
    // it into the cwd (the project root) by default.
    let pdf_path = pdf_output_path(root, main_file);
    let pdf_base64 = match std::fs::read(&pdf_path) {
        Ok(bytes) if !bytes.is_empty() => Some(BASE64.encode(bytes)),
        _ => None,
    };

    let errors = parse_errors(&log);

    // "ok" means the toolchain exited cleanly AND we have a PDF to show.
    let ok = status_ok && pdf_base64.is_some();

    CompileResult {
        ok,
        pdf_base64,
        log,
        errors,
        duration_ms: start.elapsed().as_millis() as u64,
    }
}

/// The expected PDF output path for a given main file.
fn pdf_output_path(root: &Path, main_file: &str) -> PathBuf {
    let stem = Path::new(main_file)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "main".to_string());
    root.join(format!("{stem}.pdf"))
}

/// Run the LaTeX toolchain. Returns `(exit_was_success, combined_log)`.
///
/// Prefers `latexmk`; if it isn't installed, falls back to running `pdflatex`
/// twice (so cross-references / the TOC resolve).
async fn run_build(root: &Path, main_file: &str) -> (bool, String) {
    if which("latexmk") {
        let args = [
            "-pdf",
            "-interaction=nonstopmode",
            "-synctex=1",
            "-halt-on-error",
            main_file,
        ];
        return run_one(root, "latexmk", &args).await;
    }

    if which("pdflatex") {
        let args = [
            "-interaction=nonstopmode",
            "-synctex=1",
            "-halt-on-error",
            main_file,
        ];
        // Two passes so references/TOC stabilize. Concatenate both logs; the
        // build is "ok" only if the final pass succeeded.
        let (_ok1, log1) = run_one(root, "pdflatex", &args).await;
        let (ok2, log2) = run_one(root, "pdflatex", &args).await;
        let combined = format!("{log1}\n--- pdflatex pass 2 ---\n{log2}");
        return (ok2, combined);
    }

    (
        false,
        "no LaTeX toolchain found on PATH (need `latexmk` or `pdflatex`)".to_string(),
    )
}

/// Spawn a single process with the timeout, capturing combined stdout+stderr.
async fn run_one(root: &Path, program: &str, args: &[&str]) -> (bool, String) {
    let spawn = Command::new(program)
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn();

    let child = match spawn {
        Ok(c) => c,
        Err(e) => return (false, format!("failed to launch {program}: {e}")),
    };

    let fut = child.wait_with_output();
    match tokio::time::timeout(TIMEOUT, fut).await {
        Ok(Ok(output)) => {
            let mut log = String::new();
            log.push_str(&String::from_utf8_lossy(&output.stdout));
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stderr.trim().is_empty() {
                log.push_str("\n--- stderr ---\n");
                log.push_str(&stderr);
            }
            (output.status.success(), log)
        }
        Ok(Err(e)) => (false, format!("{program} process error: {e}")),
        Err(_) => (
            false,
            format!("{program} timed out after {}s", TIMEOUT.as_secs()),
        ),
    }
}

/// Whether `program` resolves on `PATH`.
fn which(program: &str) -> bool {
    let Some(paths) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&paths).any(|dir| {
        let candidate = dir.join(program);
        candidate.is_file()
            || candidate.with_extension("exe").is_file()
            || candidate.with_extension("bat").is_file()
    })
}

/// Parse TeX/latexmk diagnostics out of the build log.
///
/// Recognizes three common shapes:
///   - TeX errors: a line starting with `! `, optionally with a following
///     `l.<n> <context>` line giving the line number.
///   - GCC-style `<file>:<line>: <message>` (e.g. from `-file-line-error`).
///   - `LaTeX Error:` / `Package … Error:` notices.
fn parse_errors(log: &str) -> Vec<CompileError> {
    let lines: Vec<&str> = log.lines().collect();
    let mut errors: Vec<CompileError> = Vec::new();

    for (i, raw) in lines.iter().enumerate() {
        let line = raw.trim_end();

        // <file>:<line>: message  (file-line-error mode)
        if let Some(err) = parse_file_line(line) {
            errors.push(err);
            continue;
        }

        // TeX error line: `! <message>`
        if let Some(msg) = line.strip_prefix("! ") {
            // Look ahead a few lines for an `l.<n> <context>` marker.
            let mut found_line: Option<u32> = None;
            for next in lines.iter().skip(i + 1).take(12) {
                let nt = next.trim_start();
                if let Some(rest) = nt.strip_prefix("l.") {
                    let num: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                    if let Ok(n) = num.parse::<u32>() {
                        found_line = Some(n);
                        break;
                    }
                }
            }
            errors.push(CompileError {
                file: None,
                line: found_line,
                message: msg.trim().to_string(),
            });
        }
    }

    errors
}

/// Parse a `path:line: message` diagnostic. Returns `None` when the line does
/// not match (e.g. it's a Windows drive path or a timestamp).
fn parse_file_line(line: &str) -> Option<CompileError> {
    // Need at least `a:1: x` and a leading non-space path token.
    if line.starts_with(char::is_whitespace) {
        return None;
    }
    let first = line.find(':')?;
    // Avoid matching `l.12` style or pure log noise; the path must look pathy.
    let file = &line[..first];
    if file.is_empty() || file.contains(' ') {
        return None;
    }
    let rest = &line[first + 1..];
    let second = rest.find(':')?;
    let num_str = &rest[..second];
    let line_no: u32 = num_str.trim().parse().ok()?;
    let message = rest[second + 1..].trim().to_string();
    if message.is_empty() {
        return None;
    }
    Some(CompileError {
        file: Some(file.to_string()),
        line: Some(line_no),
        message,
    })
}
