use std::fmt;
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::time::Duration;
use tokio::process::Command;

#[derive(Debug)]
pub struct ProcessOutput {
    pub status: ExitStatus,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

#[derive(Debug)]
pub enum ProcessError {
    Launch {
        context: String,
        source: std::io::Error,
    },
    Wait {
        context: String,
        source: std::io::Error,
    },
    Timeout {
        context: String,
        timeout: Duration,
    },
}

impl fmt::Display for ProcessError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Launch { context, source } => {
                write!(formatter, "failed to launch {context}: {source}")
            }
            Self::Wait { context, source } => {
                write!(formatter, "process failed {context}: {source}")
            }
            Self::Timeout { context, timeout } => write!(
                formatter,
                "{context} timed out after {}ms",
                timeout.as_millis()
            ),
        }
    }
}

impl std::error::Error for ProcessError {}

pub async fn run(
    root: &Path,
    program: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<ProcessOutput, ProcessError> {
    let context = format!(
        "program={} args={args:?} cwd={}",
        program.display(),
        root.display()
    );
    let child = Command::new(program)
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|source| ProcessError::Launch {
            context: context.clone(),
            source,
        })?;
    let output = tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .map_err(|_| ProcessError::Timeout {
            context: context.clone(),
            timeout,
        })?
        .map_err(|source| ProcessError::Wait { context, source })?;
    Ok(ProcessOutput {
        status: output.status,
        stdout: output.stdout,
        stderr: output.stderr,
    })
}

pub fn find_program(program: &str, paths: &[PathBuf]) -> Option<PathBuf> {
    for directory in paths {
        let names: Vec<String> = if cfg!(windows) {
            vec![
                format!("{program}.exe"),
                format!("{program}.cmd"),
                format!("{program}.bat"),
                program.to_string(),
            ]
        } else {
            vec![program.to_string()]
        };
        for name in names {
            let candidate = directory.join(name);
            let Ok(metadata) = candidate.metadata() else {
                continue;
            };
            if !metadata.is_file() {
                continue;
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if metadata.permissions().mode() & 0o111 == 0 {
                    continue;
                }
            }
            return Some(candidate);
        }
    }
    None
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[tokio::test]
    async fn runner_retains_raw_output_exit_status_and_launch_errors() {
        let directory = tempfile::tempdir().unwrap();
        let output = run(
            directory.path(),
            Path::new("sh"),
            &["-c", "printf '\\377'; printf problem >&2; exit 7"],
            Duration::from_secs(2),
        )
        .await
        .unwrap();
        assert_eq!(output.stdout, vec![255]);
        assert_eq!(output.stderr, b"problem");
        assert_eq!(output.status.code(), Some(7));
        let error = run(
            directory.path(),
            &directory.path().join("missing-program"),
            &[],
            Duration::from_secs(2),
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("missing-program"));
    }

    #[tokio::test]
    async fn runner_enforces_explicit_timeout() {
        let directory = tempfile::tempdir().unwrap();
        let error = run(
            directory.path(),
            Path::new("sh"),
            &["-c", "exec sleep 10"],
            Duration::from_millis(20),
        )
        .await
        .unwrap_err();
        assert!(matches!(error, ProcessError::Timeout { .. }));
    }
}
