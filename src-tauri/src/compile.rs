//! LaTeX compilation via `latexmk` (falling back to `pdflatex` run twice).
//!
//! The build runs as a child process off the UI thread with a hard timeout.
//! On success the produced PDF is base64-encoded into the result; either way
//! the combined stdout+stderr is returned as the log and scanned for errors so
//! the frontend can surface them inline. Shapes mirror `CompileResult` /
//! `CompileError` in `src/lib/types.ts`.

use crate::process::{self, find_program};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Serialize)]
pub struct CompileError {
    pub file: Option<String>,
    pub line: Option<u32>,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileResult {
    pub ok: bool,
    pub pdf_base64: Option<String>,
    pub log: String,
    pub errors: Vec<CompileError>,
    pub duration_ms: u64,
}

struct BuildTool {
    program: PathBuf,
    passes: usize,
    args: Vec<&'static str>,
}

pub async fn compile_project(root: &Path, main_file: &str) -> CompileResult {
    let paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default();
    let tool = discover_tool(&paths);
    compile_with_tool(root, main_file, tool, TIMEOUT).await
}

fn discover_tool(paths: &[PathBuf]) -> Option<BuildTool> {
    if let Some(program) = find_program("latexmk", paths) {
        return Some(BuildTool {
            program,
            passes: 1,
            args: vec![
                "-pdf",
                "-interaction=nonstopmode",
                "-synctex=1",
                "-halt-on-error",
                "-file-line-error",
            ],
        });
    }
    find_program("pdflatex", paths).map(|program| BuildTool {
        program,
        passes: 2,
        args: vec![
            "-interaction=nonstopmode",
            "-synctex=1",
            "-halt-on-error",
            "-file-line-error",
        ],
    })
}

async fn compile_with_tool(
    root: &Path,
    main_file: &str,
    tool: Option<BuildTool>,
    timeout: Duration,
) -> CompileResult {
    let start = Instant::now();
    let (status_ok, mut log) = run_build(root, main_file, tool, timeout).await;
    let pdf_base64 = if status_ok {
        match std::fs::read(pdf_output_path(root, main_file)) {
            Ok(bytes) if !bytes.is_empty() => Some(BASE64.encode(bytes)),
            Ok(_) => {
                log.push_str("\ncompiler produced an empty PDF");
                None
            }
            Err(error) => {
                log.push_str(&format!("\ncannot read compiled PDF: {error}"));
                None
            }
        }
    } else {
        None
    };
    let errors = parse_errors(&log);
    CompileResult {
        ok: status_ok && pdf_base64.is_some(),
        pdf_base64,
        log,
        errors,
        duration_ms: start.elapsed().as_millis() as u64,
    }
}

pub fn pdf_output_path(root: &Path, main_file: &str) -> PathBuf {
    let basename = Path::new(main_file).file_name().unwrap_or_default();
    root.join(basename).with_extension("pdf")
}

async fn run_build(
    root: &Path,
    main_file: &str,
    tool: Option<BuildTool>,
    timeout: Duration,
) -> (bool, String) {
    let Some(tool) = tool else {
        return (
            false,
            "no LaTeX toolchain found on PATH (need `latexmk` or `pdflatex`)".to_string(),
        );
    };
    let pdf = pdf_output_path(root, main_file);
    match std::fs::remove_file(&pdf) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return (
                false,
                format!(
                    "cannot remove stale compiled PDF {}: {error}",
                    pdf.display()
                ),
            )
        }
    }
    let start = Instant::now();
    let mut log = String::new();
    let mut args: Vec<&str> = Vec::with_capacity(tool.args.len() + 1);
    args.extend(tool.args);
    args.push(main_file);
    for pass in 0..tool.passes {
        if pass > 0 {
            log.push_str("\n--- pdflatex pass 2 ---\n");
        }
        let Some(remaining) = timeout.checked_sub(start.elapsed()) else {
            log.push_str(&format!(
                "compiler timed out after {}ms",
                timeout.as_millis()
            ));
            return (false, log);
        };
        let output = match process::run(root, &tool.program, &args, remaining).await {
            Ok(output) => output,
            Err(error) => {
                log.push_str(&error.to_string());
                return (false, log);
            }
        };
        log.push_str(&String::from_utf8_lossy(&output.stdout));
        if !output.stderr.is_empty() {
            log.push_str("\n--- stderr ---\n");
            log.push_str(&String::from_utf8_lossy(&output.stderr));
        }
        if !output.status.success() {
            return (false, log);
        }
    }
    (true, log)
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
/// not match a file path, line number, and message.
fn parse_file_line(line: &str) -> Option<CompileError> {
    // Need at least `a:1: x` and a leading non-space path token.
    if line.starts_with(char::is_whitespace) {
        return None;
    }
    for (separator, _) in line.match_indices(':') {
        let file = &line[..separator];
        let Some((number, message)) = line[separator + 1..].split_once(':') else {
            continue;
        };
        let Ok(line_no) = number.parse::<u32>() else {
            continue;
        };
        let message = message.trim();
        if file.is_empty() || message.is_empty() {
            continue;
        }
        return Some(CompileError {
            file: Some(file.to_string()),
            line: Some(line_no),
            message: message.to_string(),
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostics_include_tex_context_and_windows_or_space_paths() {
        let errors = parse_errors("! Undefined control sequence.\nl.17 broken\nC:\\novel\\part one.tex:23: Missing brace: extra detail\ncontent/part two.tex:9: Bad command\n");
        assert_eq!(errors.len(), 3);
        assert_eq!(errors[0].line, Some(17));
        assert_eq!(errors[1].file.as_deref(), Some(r"C:\novel\part one.tex"));
        assert_eq!(errors[1].line, Some(23));
        assert_eq!(errors[1].message, "Missing brace: extra detail");
        assert_eq!(errors[2].file.as_deref(), Some("content/part two.tex"));
    }

    #[test]
    fn output_path_uses_root_and_main_basename() {
        assert_eq!(
            pdf_output_path(Path::new("book"), "nested/title.tex"),
            Path::new("book/title.pdf")
        );
    }

    #[test]
    fn output_path_preserves_dotted_main_basename() {
        assert_eq!(
            pdf_output_path(Path::new("book"), "nested/book.v1.tex"),
            Path::new("book/book.v1.pdf")
        );
    }

    #[test]
    fn discovery_checks_platform_executables_in_supplied_paths() {
        let directory = tempfile::tempdir().unwrap();
        let name = if cfg!(windows) {
            "latexmk.exe"
        } else {
            "latexmk"
        };
        let path = directory.path().join(name);
        std::fs::write(&path, "fixture").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        assert_eq!(
            find_program("latexmk", &[directory.path().to_path_buf()]),
            Some(path)
        );
        assert_eq!(
            find_program("pdflatex", &[directory.path().to_path_buf()]),
            None
        );
    }

    #[cfg(unix)]
    fn controlled_tool(directory: &Path, script: &str, passes: usize) -> BuildTool {
        use std::os::unix::fs::PermissionsExt;
        let program = directory.join("controlled-tex");
        std::fs::write(&program, format!("#!/bin/sh\n{script}\n")).unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        BuildTool {
            program,
            passes,
            args: vec![],
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn controlled_compiler_runs_two_passes_and_returns_pdf() {
        let directory = tempfile::tempdir().unwrap();
        let tool = controlled_tool(
            directory.path(),
            "printf x >> passes; printf 'pdf bytes' > main.pdf",
            2,
        );
        let result = compile_with_tool(
            directory.path(),
            "main.tex",
            Some(tool),
            Duration::from_secs(2),
        )
        .await;
        assert!(result.ok, "{}", result.log);
        assert_eq!(
            std::fs::read(directory.path().join("passes")).unwrap(),
            b"xx"
        );
        assert_eq!(result.pdf_base64.as_deref(), Some("cGRmIGJ5dGVz"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn controlled_compiler_returns_dotted_output_and_preserves_unrelated_pdf() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("book.pdf"), "unrelated pdf").unwrap();
        std::fs::write(directory.path().join("book.v1.pdf"), "old pdf").unwrap();
        let tool = controlled_tool(
            directory.path(),
            "test \"$1\" = nested/book.v1.tex || exit 2; if [ -e book.v1.pdf ]; then echo 'stale dotted output remains' >&2; exit 3; fi; printf 'pdf bytes' > book.v1.pdf",
            1,
        );

        let result = compile_with_tool(
            directory.path(),
            "nested/book.v1.tex",
            Some(tool),
            Duration::from_secs(2),
        )
        .await;

        assert!(result.ok, "{}", result.log);
        assert_eq!(result.pdf_base64.as_deref(), Some("cGRmIGJ5dGVz"));
        assert_eq!(
            std::fs::read(directory.path().join("book.pdf")).unwrap(),
            b"unrelated pdf"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn controlled_compiler_stops_on_failed_first_pass_and_rejects_stale_pdf() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("main.pdf"), "old pdf").unwrap();
        let tool = controlled_tool(
            directory.path(),
            "printf x >> passes; echo '! Broken command'; exit 1",
            2,
        );
        let result = compile_with_tool(
            directory.path(),
            "main.tex",
            Some(tool),
            Duration::from_secs(2),
        )
        .await;
        assert!(!result.ok);
        assert_eq!(result.pdf_base64, None);
        assert_eq!(
            std::fs::read(directory.path().join("passes")).unwrap(),
            b"x"
        );
        assert_eq!(result.errors.len(), 1);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn controlled_compiler_reports_timeout_missing_tool_and_missing_or_empty_pdf() {
        let directory = tempfile::tempdir().unwrap();
        let missing =
            compile_with_tool(directory.path(), "main.tex", None, Duration::from_secs(2)).await;
        assert!(!missing.ok);
        assert!(missing.log.contains("no LaTeX toolchain"));
        for script in ["exit 0", ": > main.pdf"] {
            let tool = controlled_tool(directory.path(), script, 1);
            let result = compile_with_tool(
                directory.path(),
                "main.tex",
                Some(tool),
                Duration::from_secs(2),
            )
            .await;
            assert!(!result.ok);
            assert!(result.log.contains("PDF"), "{}", result.log);
        }
        let tool = controlled_tool(directory.path(), "exec sleep 10", 1);
        let result = compile_with_tool(
            directory.path(),
            "main.tex",
            Some(tool),
            Duration::from_millis(20),
        )
        .await;
        assert!(!result.ok);
        assert!(result.log.contains("timed out"), "{}", result.log);
    }
}
