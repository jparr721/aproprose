//! git.rs — backup/sync engine. We shell out to the system `git` and `gh`
//! CLIs (mirroring compile.rs) rather than embedding a git library, so push
//! reuses the user's local credential helper and `gh` supplies the GitHub API
//! token with zero extra setup. All process spawning is native Rust, so no
//! Tauri capability/HTTP-allowlist grant is required.

use serde::Serialize;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

/// Network git ops (push/pull) can be slow; local ops are instant. One limit.
const TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolingStatus {
    pub git_installed: bool,
    pub git_version: Option<String>,
    pub gh_installed: bool,
    pub gh_authed: bool,
    pub login: Option<String>,
}

/// Parse `gh auth status` output into (authed, login). `gh auth status` prints
/// to stderr and exits 0 when logged in, non-zero otherwise.
fn parse_gh_auth(stdout: &str, stderr: &str, ok: bool) -> (bool, Option<String>) {
    let blob = format!("{stdout}\n{stderr}");
    // Example line: "  ✓ Logged in to github.com account octocat (keyring)"
    let login = blob
        .lines()
        .find(|l| l.contains("Logged in to") && l.contains("account"))
        .and_then(|l| l.split("account").nth(1))
        .map(|rest| rest.trim().split_whitespace().next().unwrap_or("").to_string())
        .filter(|s| !s.is_empty());
    (ok, login)
}

/// Result of running a git/gh subprocess.
pub struct GitOut {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Spawn `program` with `args` in `root`, capturing stdout/stderr, with the
/// shared timeout. Mirrors compile.rs::run_one.
pub async fn run(root: &Path, program: &str, args: &[&str]) -> GitOut {
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
        Err(e) => return GitOut { ok: false, stdout: String::new(), stderr: format!("failed to launch {program}: {e}") },
    };
    match tokio::time::timeout(TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(o)) => GitOut {
            ok: o.status.success(),
            stdout: String::from_utf8_lossy(&o.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&o.stderr).into_owned(),
        },
        Ok(Err(e)) => GitOut { ok: false, stdout: String::new(), stderr: format!("{program} error: {e}") },
        Err(_) => GitOut { ok: false, stdout: String::new(), stderr: format!("{program} timed out after {}s", TIMEOUT.as_secs()) },
    }
}

/// Probe for git/gh availability + gh auth. Run from the app config dir or any
/// valid cwd; here we use the current dir of the process.
pub async fn tooling_status() -> ToolingStatus {
    let cwd = std::env::current_dir().unwrap_or_else(|_| Path::new(".").to_path_buf());
    let gitv = run(&cwd, "git", &["--version"]).await;
    let ghv = run(&cwd, "gh", &["--version"]).await;
    let (gh_authed, login) = if ghv.ok {
        let auth = run(&cwd, "gh", &["auth", "status"]).await;
        parse_gh_auth(&auth.stdout, &auth.stderr, auth.ok)
    } else {
        (false, None)
    };
    ToolingStatus {
        git_installed: gitv.ok,
        git_version: gitv.ok.then(|| gitv.stdout.trim().to_string()),
        gh_installed: ghv.ok,
        gh_authed,
        login,
    }
}

#[tauri::command]
pub async fn git_tooling_status() -> Result<ToolingStatus, String> {
    Ok(tooling_status().await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gh_auth_logged_in_extracts_login() {
        let stderr = "github.com\n  ✓ Logged in to github.com account octocat (keyring)\n";
        let (authed, login) = parse_gh_auth("", stderr, true);
        assert!(authed);
        assert_eq!(login.as_deref(), Some("octocat"));
    }

    #[test]
    fn gh_auth_logged_out_has_no_login() {
        let (authed, login) = parse_gh_auth("", "You are not logged into any GitHub hosts.", false);
        assert!(!authed);
        assert_eq!(login, None);
    }
}
