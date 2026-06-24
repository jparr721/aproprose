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

/// Network git ops (push/pull) can be slow; local ops are instant. One limit for
/// all — local ops finish well under it, so the loose ceiling only bites a hung network op.
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
        .map(|rest| rest.split_whitespace().next().unwrap_or("").to_string())
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
        Err(e) => {
            return GitOut {
                ok: false,
                stdout: String::new(),
                stderr: format!("failed to launch {program}: {e}"),
            }
        }
    };
    match tokio::time::timeout(TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(o)) => GitOut {
            ok: o.status.success(),
            stdout: String::from_utf8_lossy(&o.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&o.stderr).into_owned(),
        },
        Ok(Err(e)) => GitOut {
            ok: false,
            stdout: String::new(),
            stderr: format!("{program} error: {e}"),
        },
        Err(_) => GitOut {
            ok: false,
            stdout: String::new(),
            stderr: format!("{program} timed out after {}s", TIMEOUT.as_secs()),
        },
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

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SyncOutcome {
    Clean,
    Synced,
    Conflict { files: Vec<String> },
    PushRejected,
    NeedsSetup { reason: String },
    AuthMissing,
    Offline,
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
            if !name.is_empty() && name != "HEAD" && !rest.starts_with("No commits yet on") {
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
        let path = raw_path
            .rsplit(" -> ")
            .next()
            .unwrap_or(raw_path)
            .to_string();
        let is_conflict = code.contains('U') || code == "AA" || code == "DD";
        if is_conflict {
            conflicted.push(path.clone());
        }
        changed.push(ChangedFile {
            path,
            status: code.to_string(),
            conflicted: is_conflict,
        });
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
            is_repo: false,
            has_remote: false,
            remote_url: None,
            branch: None,
            ahead: 0,
            behind: 0,
            dirty: false,
            changed_files: Vec::new(),
            conflicted_files: Vec::new(),
        };
    }
    let out = run(
        root,
        "git",
        &[
            "-c",
            "core.quotePath=false",
            "status",
            "--porcelain=v1",
            "--branch",
        ],
    )
    .await;
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

/// Unified diff of uncommitted changes vs HEAD (optionally one path).
pub async fn diff(root: &Path, file: Option<&str>) -> Result<String, String> {
    let mut args = vec!["diff", "HEAD"];
    if let Some(f) = file {
        args.push("--");
        args.push(f);
    }
    let out = run(root, "git", &args).await;
    if out.ok {
        Ok(out.stdout)
    } else {
        Err(out.stderr.trim().to_string())
    }
}

#[tauri::command]
pub async fn git_diff(root: String, file: Option<String>) -> Result<String, String> {
    diff(Path::new(&root), file.as_deref()).await
}

/// Auth/offline transport failures shared by pull and push. `t` must already be lowercased.
fn classify_transport_error(t: &str) -> Option<SyncOutcome> {
    if t.contains("authentication failed")
        || t.contains("could not read username")
        || t.contains("permission denied (publickey)")
        || t.contains("invalid username or password")
    {
        return Some(SyncOutcome::AuthMissing);
    }
    if t.contains("could not resolve host")
        || t.contains("connection timed out")
        || t.contains("network is unreachable")
        || t.contains("temporary failure in name resolution")
    {
        return Some(SyncOutcome::Offline);
    }
    None
}

/// Map a git stderr blob to a non-conflict failure outcome, if recognizable.
/// Includes the push-only `PushRejected`; pull failures use `classify_transport_error`.
pub fn classify_git_error(text: &str) -> Option<SyncOutcome> {
    let t = text.to_lowercase();
    classify_transport_error(&t).or_else(|| {
        (t.contains("[rejected]") || t.contains("non-fast-forward") || t.contains("fetch first"))
            .then_some(SyncOutcome::PushRejected)
    })
}

fn looks_like_conflict(text: &str) -> bool {
    let t = text.to_lowercase();
    t.contains("conflict") || t.contains("automatic merge failed")
}

pub async fn unmerged_files(root: &Path) -> Vec<String> {
    let out = run(
        root,
        "git",
        &[
            "-c",
            "core.quotePath=false",
            "diff",
            "--name-only",
            "--diff-filter=U",
        ],
    )
    .await;
    out.stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// The backup sequence: stage → commit → pull/merge → push. Steps short-circuit
/// into a SyncOutcome (conflict / push-rejected / offline / auth-missing) that
/// leaves a recoverable partial state, surfaced to the UI — it is not atomic.
pub async fn sync(root: &Path, message: &str) -> Result<SyncOutcome, String> {
    if !is_repo(root).await {
        return Ok(SyncOutcome::NeedsSetup {
            reason: "not a git repository".into(),
        });
    }
    if origin_url(root).await.is_none() {
        return Ok(SyncOutcome::NeedsSetup {
            reason: "no 'origin' remote".into(),
        });
    }

    let pre = repo_status(root).await;

    // Already conflicted (e.g. reopened mid-conflict): surface it directly
    // rather than transiting an error state on a refused commit.
    if !pre.conflicted_files.is_empty() {
        return Ok(SyncOutcome::Conflict {
            files: pre.conflicted_files,
        });
    }

    // Stage + commit anything local.
    if pre.dirty {
        let add = run(root, "git", &["add", "-A"]).await;
        if !add.ok {
            return Err(add.stderr.trim().to_string());
        }
        let commit = run(root, "git", &["commit", "-m", message]).await;
        // A racy "nothing to commit" is fine; a real failure is not.
        if !commit.ok
            && !commit.stdout.contains("nothing to commit")
            && !commit.stderr.contains("nothing to commit")
        {
            return Err(format!("{}{}", commit.stdout, commit.stderr)
                .trim()
                .to_string());
        }
    }

    // Pull (merge). Conflicts are surfaced, not aborted.
    let pull = run(root, "git", &["pull", "--no-rebase", "--no-edit"]).await;
    if !pull.ok {
        let blob = format!("{}{}", pull.stdout, pull.stderr);
        if looks_like_conflict(&blob) {
            return Ok(SyncOutcome::Conflict {
                files: unmerged_files(root).await,
            });
        }
        if let Some(o) = classify_transport_error(&blob.to_lowercase()) {
            return Ok(o);
        }
        return Err(blob.trim().to_string());
    }

    // Push.
    let push = run(root, "git", &["push"]).await;
    if !push.ok {
        let blob = format!("{}{}", push.stdout, push.stderr);
        if let Some(o) = classify_git_error(&blob) {
            return Ok(o);
        }
        return Err(blob.trim().to_string());
    }

    let nothing_local = !pre.dirty;
    let pull_noop =
        pull.stdout.contains("Already up to date") || pull.stderr.contains("Already up to date");
    let push_noop = push.stderr.contains("Everything up-to-date")
        || push.stdout.contains("Everything up-to-date");
    if nothing_local && pull_noop && push_noop && pre.ahead == 0 {
        Ok(SyncOutcome::Clean)
    } else {
        Ok(SyncOutcome::Synced)
    }
}

#[tauri::command]
pub async fn sync_project(root: String, message: String) -> Result<SyncOutcome, String> {
    sync(Path::new(&root), &message).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NameCheck {
    pub available: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoCreated {
    pub remote_url: String,
    pub owner: String,
}

const GITIGNORE_BLOCK: &[&str] = &[
    "# LaTeX build artifacts (aproprose)",
    "*.aux",
    "*.log",
    "*.out",
    "*.toc",
    "*.lof",
    "*.lot",
    "*.fls",
    "*.fdb_latexmk",
    "*.synctex.gz",
    "*.bbl",
    "*.blg",
    "*.run.xml",
    "*-blx.bib",
    "# Compiled output (regenerable from source)",
    "*.pdf",
];

/// Append our default ignore lines to `existing`, skipping any already present.
/// Idempotent; never reorders or removes the user's lines.
pub fn gitignore_with_defaults(existing: &str) -> String {
    let have: std::collections::HashSet<&str> = existing.lines().map(|l| l.trim()).collect();
    let mut out = existing.to_string();
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    let missing: Vec<&str> = GITIGNORE_BLOCK
        .iter()
        .copied()
        .filter(|l| !have.contains(l))
        .collect();
    for line in missing {
        out.push_str(line);
        out.push('\n');
    }
    out
}

/// Initialize `root` as a git repo (if needed), write/extend `.gitignore`, and
/// make an initial commit. Uses ephemeral identity flags so it works even when
/// the machine has no global git identity.
pub async fn init_local_repo(root: &Path) -> Result<(), String> {
    if !is_repo(root).await {
        let init = run(root, "git", &["init", "-b", "main"]).await;
        if !init.ok {
            return Err(init.stderr.trim().to_string());
        }
    }
    let gi_path = root.join(".gitignore");
    let existing = std::fs::read_to_string(&gi_path).unwrap_or_default();
    std::fs::write(&gi_path, gitignore_with_defaults(&existing))
        .map_err(|e| format!("cannot write .gitignore: {e}"))?;

    let add = run(root, "git", &["add", "-A"]).await;
    if !add.ok {
        return Err(add.stderr.trim().to_string());
    }
    let commit = run(
        root,
        "git",
        &[
            "-c",
            "user.email=backup@aproprose.local",
            "-c",
            "user.name=aproprose",
            "commit",
            "-m",
            "chore: initial backup",
        ],
    )
    .await;
    if !commit.ok
        && !commit.stdout.contains("nothing to commit")
        && !commit.stderr.contains("nothing to commit")
    {
        return Err(format!("{}{}", commit.stdout, commit.stderr)
            .trim()
            .to_string());
    }
    Ok(())
}

/// Validate a repo name against GitHub naming rules and check availability via
/// `gh api`. Requires `gh` to be installed + authed.
pub async fn check_repo_name(name: &str) -> Result<NameCheck, String> {
    let valid = !name.is_empty()
        && name.len() <= 100
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    if !valid {
        return Ok(NameCheck {
            available: false,
            reason: Some("Use letters, numbers, '-', '_', '.'".into()),
        });
    }
    let login = {
        let auth = run(
            &std::env::temp_dir(),
            "gh",
            &["api", "user", "--jq", ".login"],
        )
        .await;
        if !auth.ok {
            return Err("gh is not authenticated — run `gh auth login`".into());
        }
        auth.stdout.trim().to_string()
    };
    let probe = run(
        &std::env::temp_dir(),
        "gh",
        &["api", &format!("repos/{login}/{name}"), "--silent"],
    )
    .await;
    // Exit 0 → repo exists (taken); non-zero (404) → available.
    Ok(NameCheck {
        available: !probe.ok,
        reason: probe
            .ok
            .then(|| "A repo with that name already exists".to_string()),
    })
}

/// Create a GitHub repo and set it as `origin`, pushing the current branch.
pub async fn enable_backup(root: &Path, name: &str, private: bool) -> Result<RepoCreated, String> {
    init_local_repo(root).await?;
    let vis = if private { "--private" } else { "--public" };
    let out = run(
        root,
        "gh",
        &[
            "repo",
            "create",
            name,
            vis,
            "--source=.",
            "--remote=origin",
            "--push",
        ],
    )
    .await;
    if !out.ok {
        return Err(format!("{}{}", out.stdout, out.stderr).trim().to_string());
    }
    let login = run(
        &std::env::temp_dir(),
        "gh",
        &["api", "user", "--jq", ".login"],
    )
    .await;
    if !login.ok {
        return Err("could not resolve gh owner after repo creation".into());
    }
    let owner = login.stdout.trim().to_string();
    Ok(RepoCreated {
        remote_url: format!("https://github.com/{owner}/{name}"),
        owner,
    })
}

#[tauri::command]
pub async fn gh_check_repo_name(name: String) -> Result<NameCheck, String> {
    check_repo_name(&name).await
}

#[tauri::command]
pub async fn enable_backup_cmd(
    root: String,
    name: String,
    private: bool,
) -> Result<RepoCreated, String> {
    enable_backup(Path::new(&root), &name, private).await
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
            StdCommand::new("git")
                .args(args)
                .current_dir(&dir)
                .output()
                .unwrap();
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

    #[test]
    fn parse_status_no_commits_yet_has_no_branch() {
        let r = parse_status("## No commits yet on main\n");
        assert_eq!(r.branch, None);
        assert!(!r.dirty);
    }

    #[test]
    fn parse_status_rename_takes_new_path() {
        let r = parse_status("## main\nR  old.tex -> new.tex\n");
        assert_eq!(r.changed_files.len(), 1);
        assert_eq!(r.changed_files[0].path, "new.tex");
    }

    #[tokio::test]
    async fn diff_shows_modified_tracked_file() {
        let dir = temp_repo();
        std::fs::write(dir.join("a.tex"), "one\n").unwrap();
        StdCommand::new("git")
            .args(["add", "-A"])
            .current_dir(&dir)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-qm", "init"])
            .current_dir(&dir)
            .output()
            .unwrap();
        std::fs::write(dir.join("a.tex"), "two\n").unwrap();
        let d = diff(&dir, None).await.unwrap();
        assert!(d.contains("-one"));
        assert!(d.contains("+two"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn classify_transport_error_ignores_rejected() {
        assert!(classify_transport_error(" ! [rejected] main -> main (fetch first)").is_none());
        assert!(matches!(
            classify_transport_error("fatal: authentication failed"),
            Some(SyncOutcome::AuthMissing)
        ));
        assert!(matches!(
            classify_transport_error("could not resolve host: github.com"),
            Some(SyncOutcome::Offline)
        ));
    }

    #[test]
    fn classify_recognizes_auth_offline_rejected() {
        assert!(matches!(
            classify_git_error("fatal: Authentication failed for 'https://...'"),
            Some(SyncOutcome::AuthMissing)
        ));
        assert!(matches!(
            classify_git_error("Permission denied (publickey)."),
            Some(SyncOutcome::AuthMissing)
        ));
        assert!(matches!(
            classify_git_error("fatal: unable to access ... Could not resolve host: github.com"),
            Some(SyncOutcome::Offline)
        ));
        assert!(matches!(
            classify_git_error(" ! [rejected] main -> main (fetch first)"),
            Some(SyncOutcome::PushRejected)
        ));
        assert!(classify_git_error("some unrelated error").is_none());
    }

    /// Build a bare "origin" + a working clone wired to it.
    fn repo_with_origin() -> (std::path::PathBuf, std::path::PathBuf) {
        let base = unique("aproprose-sync");
        let _ = std::fs::remove_dir_all(&base);
        let origin = base.join("origin.git");
        let work = base.join("work");
        std::fs::create_dir_all(&origin).unwrap();
        std::fs::create_dir_all(&work).unwrap();
        StdCommand::new("git")
            .args(["init", "--bare", "-q", "-b", "main"])
            .current_dir(&origin)
            .output()
            .unwrap();
        let g = |args: &[&str]| {
            StdCommand::new("git")
                .args(args)
                .current_dir(&work)
                .output()
                .unwrap();
        };
        g(&["init", "-q", "-b", "main"]);
        g(&["config", "user.email", "t@t.t"]);
        g(&["config", "user.name", "t"]);
        std::fs::write(work.join("a.tex"), "one\n").unwrap();
        g(&["add", "-A"]);
        g(&["commit", "-qm", "init"]);
        g(&["remote", "add", "origin", origin.to_str().unwrap()]);
        g(&["push", "-q", "-u", "origin", "main"]);
        (origin, work)
    }

    #[tokio::test]
    async fn sync_no_remote_returns_needs_setup() {
        let dir = temp_repo();
        std::fs::write(dir.join("a.tex"), "x").unwrap();
        let out = sync(&dir, "msg").await.unwrap();
        assert!(matches!(out, SyncOutcome::NeedsSetup { .. }));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn sync_commits_and_pushes_changes() {
        let (origin, work) = repo_with_origin();
        std::fs::write(work.join("a.tex"), "two\n").unwrap();
        let out = sync(&work, "Backup test").await.unwrap();
        assert!(matches!(out, SyncOutcome::Synced));
        // The change reached origin:
        let log = StdCommand::new("git")
            .args(["log", "--oneline"])
            .current_dir(&origin)
            .output()
            .unwrap();
        let log = String::from_utf8_lossy(&log.stdout);
        assert!(log.contains("Backup test"));
        let _ = std::fs::remove_dir_all(work.parent().unwrap());
    }

    #[tokio::test]
    async fn sync_clean_repo_is_clean() {
        let (_origin, work) = repo_with_origin();
        let out = sync(&work, "noop").await.unwrap();
        assert!(matches!(out, SyncOutcome::Clean));
        let _ = std::fs::remove_dir_all(work.parent().unwrap());
    }

    #[test]
    fn gitignore_is_idempotent_and_preserves_existing() {
        let existing = "node_modules\n*.log\n";
        let first = gitignore_with_defaults(existing);
        assert!(first.contains("node_modules")); // preserved
        assert_eq!(first.matches("*.log").count(), 1); // not duplicated
        assert!(first.contains("*.fdb_latexmk"));
        assert!(first.contains("*.pdf"));
        // Running again changes nothing.
        assert_eq!(gitignore_with_defaults(&first), first);
    }

    #[test]
    fn gitignore_handles_empty_and_no_trailing_newline() {
        let from_empty = gitignore_with_defaults("");
        assert!(from_empty.starts_with("# LaTeX build artifacts"));
        assert!(from_empty.contains("*.pdf"));
        assert_eq!(gitignore_with_defaults(&from_empty), from_empty); // idempotent
        let from_no_nl = gitignore_with_defaults("foo");
        assert!(from_no_nl.starts_with("foo\n")); // separator inserted
        assert!(from_no_nl.contains("*.fdb_latexmk"));
    }

    #[tokio::test]
    #[ignore = "needs DNS to NXDOMAIN .invalid"]
    async fn sync_unreachable_remote_returns_offline() {
        let dir = temp_repo();
        std::fs::write(dir.join("a.tex"), "x\n").unwrap();
        StdCommand::new("git")
            .args(["add", "-A"])
            .current_dir(&dir)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-qm", "init"])
            .current_dir(&dir)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args([
                "remote",
                "add",
                "origin",
                "https://nonexistent.invalid/x.git",
            ])
            .current_dir(&dir)
            .output()
            .unwrap();
        std::fs::write(dir.join("a.tex"), "y\n").unwrap();
        let out = sync(&dir, "msg").await.unwrap();
        assert!(
            matches!(out, SyncOutcome::Offline),
            "expected Offline, got {out:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn init_local_repo_creates_repo_with_gitignore_and_commit() {
        let dir = unique("aproprose-init");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("main.tex"), "\\documentclass{book}").unwrap();
        // git needs an identity; set it locally after init via init_local_repo? We set here:
        init_local_repo(&dir).await.unwrap();
        assert!(dir.join(".git").exists());
        assert!(dir.join(".gitignore").exists());
        let log = StdCommand::new("git")
            .args(["log", "--oneline"])
            .current_dir(&dir)
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&log.stdout).contains("backup"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn sync_surfaces_merge_conflict() {
        let (origin, work_a) = repo_with_origin();
        // Second clone B advances origin on the same line.
        let work_b = work_a.parent().unwrap().join("work_b");
        StdCommand::new("git")
            .args([
                "clone",
                "-q",
                origin.to_str().unwrap(),
                work_b.to_str().unwrap(),
            ])
            .output()
            .unwrap();
        let gb = |args: &[&str]| {
            StdCommand::new("git")
                .args(args)
                .current_dir(&work_b)
                .output()
                .unwrap();
        };
        gb(&["config", "user.email", "b@b.b"]);
        gb(&["config", "user.name", "b"]);
        std::fs::write(work_b.join("a.tex"), "from-b\n").unwrap();
        gb(&["commit", "-aqm", "b-change"]);
        gb(&["push", "-q"]);
        // A changes the same line and syncs → conflict.
        std::fs::write(work_a.join("a.tex"), "from-a\n").unwrap();
        let out = sync(&work_a, "a-change").await.unwrap();
        assert!(
            matches!(out, SyncOutcome::Conflict { ref files } if files == &vec!["a.tex".to_string()])
        );
        let _ = std::fs::remove_dir_all(work_a.parent().unwrap());
    }

    #[tokio::test]
    async fn sync_on_already_conflicted_tree_returns_conflict() {
        let (origin, work_a) = repo_with_origin();
        let work_b = work_a.parent().unwrap().join("work_b");
        StdCommand::new("git")
            .args([
                "clone",
                "-q",
                origin.to_str().unwrap(),
                work_b.to_str().unwrap(),
            ])
            .output()
            .unwrap();
        let gb = |args: &[&str]| {
            StdCommand::new("git")
                .args(args)
                .current_dir(&work_b)
                .output()
                .unwrap();
        };
        gb(&["config", "user.email", "b@b.b"]);
        gb(&["config", "user.name", "b"]);
        std::fs::write(work_b.join("a.tex"), "from-b\n").unwrap();
        gb(&["commit", "-aqm", "b-change"]);
        gb(&["push", "-q"]);
        std::fs::write(work_a.join("a.tex"), "from-a\n").unwrap();
        let first = sync(&work_a, "a-change").await.unwrap();
        assert!(matches!(first, SyncOutcome::Conflict { .. }));
        // Tree is still conflicted; a second sync must early-return Conflict, not Err.
        let second = sync(&work_a, "retry").await.unwrap();
        assert!(
            matches!(second, SyncOutcome::Conflict { ref files } if files.contains(&"a.tex".to_string()))
        );
        let _ = std::fs::remove_dir_all(work_a.parent().unwrap());
    }
}
