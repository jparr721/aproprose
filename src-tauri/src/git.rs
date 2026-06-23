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

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub status: String,
    pub conflicted: bool,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub is_repo: bool,
    pub has_remote: bool,
    pub remote_url: Option<String>,
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub dirty: bool,
    pub changed_files: Vec<ChangedFile>,
    pub conflicted_files: Vec<String>,
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

/// Parse `git status --porcelain=v1 --branch` into a RepoStatus. The caller
/// fills is_repo/has_remote/remote_url; this fills branch/ahead/behind/dirty/
/// changed_files/conflicted_files.
pub fn parse_status(porcelain_branch: &str) -> RepoStatus {
    let mut branch = None;
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let mut changed = Vec::new();
    let mut conflicted = Vec::new();

    for line in porcelain_branch.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            // "main...origin/main [ahead 2, behind 1]" | "main" | "HEAD (no branch)"
            let name_part = rest.split("...").next().unwrap_or(rest);
            let name = name_part.split_whitespace().next().unwrap_or("");
            if !name.is_empty() && name != "HEAD" {
                branch = Some(name.to_string());
            }
            if let (Some(b), Some(e)) = (rest.find('['), rest.find(']')) {
                let inner = &rest[b + 1..e];
                for token in inner.split(',') {
                    let t = token.trim();
                    if let Some(n) = t.strip_prefix("ahead ") {
                        ahead = n.trim().parse().unwrap_or(0);
                    } else if let Some(n) = t.strip_prefix("behind ") {
                        behind = n.trim().parse().unwrap_or(0);
                    }
                }
            }
            continue;
        }
        if line.len() < 3 {
            continue;
        }
        let code = &line[0..2];
        // Path begins at column 3; handle rename "R  old -> new" by taking new.
        let raw_path = line[3..].trim();
        let path = raw_path.rsplit(" -> ").next().unwrap_or(raw_path).to_string();
        let is_conflict = code.contains('U') || code == "AA" || code == "DD";
        if is_conflict {
            conflicted.push(path.clone());
        }
        changed.push(ChangedFile { path, status: code.to_string(), conflicted: is_conflict });
    }

    RepoStatus {
        is_repo: true,
        has_remote: false,
        remote_url: None,
        branch,
        ahead,
        behind,
        dirty: !changed.is_empty(),
        changed_files: changed,
        conflicted_files: conflicted,
    }
}

/// Is `root` inside a git work tree?
pub async fn is_repo(root: &Path) -> bool {
    let out = run(root, "git", &["rev-parse", "--is-inside-work-tree"]).await;
    out.ok && out.stdout.trim() == "true"
}

/// The `origin` remote URL, if any.
pub async fn origin_url(root: &Path) -> Option<String> {
    let out = run(root, "git", &["remote", "get-url", "origin"]).await;
    (out.ok && !out.stdout.trim().is_empty()).then(|| out.stdout.trim().to_string())
}

pub async fn repo_status(root: &Path) -> RepoStatus {
    if !is_repo(root).await {
        return RepoStatus {
            is_repo: false, has_remote: false, remote_url: None, branch: None,
            ahead: 0, behind: 0, dirty: false, changed_files: Vec::new(), conflicted_files: Vec::new(),
        };
    }
    let out = run(root, "git", &["status", "--porcelain=v1", "--branch"]).await;
    let mut status = parse_status(&out.stdout);
    let remote = origin_url(root).await;
    status.has_remote = remote.is_some();
    status.remote_url = remote;
    status
}

#[tauri::command]
pub async fn git_repo_status(root: String) -> Result<RepoStatus, String> {
    Ok(repo_status(Path::new(&root)).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as StdCommand;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// Monotonic counter so parallel cargo tests never share a temp dir
    /// (the process id alone is identical across the test threads).
    static SEQ: AtomicU32 = AtomicU32::new(0);

    fn unique(prefix: &str) -> std::path::PathBuf {
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("{prefix}-{}-{}", std::process::id(), n))
    }

    /// Make a throwaway repo under the OS temp dir; returns its path.
    fn temp_repo() -> std::path::PathBuf {
        let dir = unique("aproprose-git");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let git = |args: &[&str]| {
            StdCommand::new("git").args(args).current_dir(&dir).output().unwrap();
        };
        git(&["init", "-q"]);
        git(&["config", "user.email", "t@t.t"]);
        git(&["config", "user.name", "t"]);
        dir
    }

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

    #[test]
    fn parse_status_clean_tracked_branch() {
        let s = "## main...origin/main\n";
        let r = parse_status(s);
        assert_eq!(r.branch.as_deref(), Some("main"));
        assert_eq!(r.ahead, 0);
        assert_eq!(r.behind, 0);
        assert!(!r.dirty);
        assert!(r.changed_files.is_empty());
    }

    #[test]
    fn parse_status_ahead_behind_and_changes() {
        let s = "## main...origin/main [ahead 2, behind 1]\n M src/a.tex\n?? new.tex\n";
        let r = parse_status(s);
        assert_eq!(r.ahead, 2);
        assert_eq!(r.behind, 1);
        assert!(r.dirty);
        assert_eq!(r.changed_files.len(), 2);
        assert_eq!(r.changed_files[0].path, "src/a.tex");
        assert_eq!(r.changed_files[1].path, "new.tex");
        assert_eq!(r.changed_files[1].status, "??");
        assert!(r.conflicted_files.is_empty());
    }

    #[test]
    fn parse_status_detects_conflicts() {
        let s = "## main\nUU content/ch1.tex\n";
        let r = parse_status(s);
        assert!(r.dirty);
        assert_eq!(r.conflicted_files, vec!["content/ch1.tex".to_string()]);
        assert!(r.changed_files[0].conflicted);
    }

    #[test]
    fn parse_status_no_upstream() {
        let s = "## main\n";
        let r = parse_status(s);
        assert_eq!(r.branch.as_deref(), Some("main"));
        assert_eq!(r.ahead, 0);
        assert_eq!(r.behind, 0);
    }

    #[tokio::test]
    async fn repo_status_reports_dirty_untracked() {
        let dir = temp_repo();
        std::fs::write(dir.join("a.tex"), "hello").unwrap();
        let s = repo_status(&dir).await;
        assert!(s.is_repo);
        assert!(!s.has_remote);
        assert!(s.dirty);
        assert_eq!(s.changed_files[0].path, "a.tex");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
