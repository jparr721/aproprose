//! git.rs — backup/sync engine. We shell out to the system `git` and `gh`
//! CLIs (mirroring compile.rs) rather than embedding a git library, so push
//! reuses the user's local credential helper and `gh` supplies the GitHub API
//! token with zero extra setup. All process spawning is native Rust, so no
//! Tauri capability/HTTP-allowlist grant is required.

use crate::{durable_write, process};
use serde::Serialize;
use std::path::Path;
use std::time::Duration;

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
    pub stdout_bytes: Vec<u8>,
}

/// Spawn `program` with `args` in `root`, capturing stdout/stderr, with the
/// shared timeout. Mirrors compile.rs::run_one.
pub async fn run(root: &Path, program: &str, args: &[&str]) -> GitOut {
    match process::run(root, Path::new(program), args, TIMEOUT).await {
        Ok(output) => GitOut {
            ok: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            stdout_bytes: output.stdout,
        },
        Err(error) => GitOut {
            ok: false,
            stdout: String::new(),
            stderr: error.to_string(),
            stdout_bytes: Vec::new(),
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
    Error { message: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub outcome: SyncOutcome,
    pub changed_files: Option<Vec<String>>,
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

fn decode_git_path(bytes: &[u8]) -> Result<String, String> {
    String::from_utf8(bytes.to_vec()).map_err(|error| {
        format!("Git returned a non-UTF-8 path that cannot be represented by the app: {error}")
    })
}

fn parse_status_nul(bytes: &[u8]) -> Result<RepoStatus, String> {
    let mut records = bytes
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty());
    let mut status = parse_status("");
    while let Some(record) = records.next() {
        if record.starts_with(b"## ") {
            let header = std::str::from_utf8(record)
                .map_err(|error| format!("invalid Git branch record: {error}"))?;
            let branch = parse_status(header);
            status.branch = branch.branch;
            status.ahead = branch.ahead;
            status.behind = branch.behind;
            continue;
        }
        if record.len() < 4 || record[2] != b' ' {
            return Err(format!("invalid Git status record: {record:?}"));
        }
        let code = std::str::from_utf8(&record[..2]).map_err(|error| error.to_string())?;
        let path = decode_git_path(&record[3..])?;
        if code.contains('R') || code.contains('C') {
            let original = records
                .next()
                .ok_or_else(|| "Git rename record is missing its original path".to_string())?;
            decode_git_path(original)?;
        }
        let conflicted = code.contains('U') || code == "AA" || code == "DD";
        if conflicted {
            status.conflicted_files.push(path.clone());
        }
        status.changed_files.push(ChangedFile {
            path,
            status: code.to_string(),
            conflicted,
        });
    }
    status.dirty = !status.changed_files.is_empty();
    Ok(status)
}

async fn owns_repository(root: &Path) -> Result<bool, String> {
    let canonical = root
        .canonicalize()
        .map_err(|error| format!("invalid project root {}: {error}", root.display()))?;
    let output = run(&canonical, "git", &["rev-parse", "--show-toplevel"]).await;
    if !output.ok {
        if output.stderr.contains("not a git repository") {
            return Ok(false);
        }
        return Err(format!(
            "cannot resolve repository root {}: {}",
            canonical.display(),
            output.stderr
        ));
    }
    let text = std::str::from_utf8(&output.stdout_bytes)
        .map_err(|error| format!("Git repository root is not UTF-8: {error}"))?;
    let reported = text.strip_suffix('\n').unwrap_or(text);
    #[cfg(windows)]
    let reported = reported.strip_suffix('\r').unwrap_or(reported);
    let reported = Path::new(reported)
        .canonicalize()
        .map_err(|error| format!("cannot resolve Git root {reported:?}: {error}"))?;
    Ok(reported == canonical)
}

pub async fn is_repo(root: &Path) -> Result<bool, String> {
    owns_repository(root).await
}

/// The `origin` remote URL, if any.
pub async fn origin_url(root: &Path) -> Option<String> {
    let out = run(root, "git", &["remote", "get-url", "origin"]).await;
    (out.ok && !out.stdout.trim().is_empty()).then(|| out.stdout.trim().to_string())
}

pub async fn repo_status(root: &Path) -> Result<RepoStatus, String> {
    if !owns_repository(root).await? {
        return Ok(RepoStatus {
            is_repo: false,
            has_remote: false,
            remote_url: None,
            branch: None,
            ahead: 0,
            behind: 0,
            dirty: false,
            changed_files: Vec::new(),
            conflicted_files: Vec::new(),
        });
    }
    let output = run(root, "git", &["status", "--porcelain=v1", "--branch", "-z"]).await;
    if !output.ok {
        return Err(format!("cannot read Git status: {}", output.stderr));
    }
    let mut status = parse_status_nul(&output.stdout_bytes)?;
    let remote = origin_url(root).await;
    status.has_remote = remote.is_some();
    status.remote_url = remote;
    Ok(status)
}

#[tauri::command]
pub async fn git_repo_status(root: String) -> Result<RepoStatus, String> {
    repo_status(Path::new(&root)).await
}

/// Unified diff of uncommitted changes vs HEAD (optionally one path).
pub async fn diff(root: &Path, file: Option<&str>) -> Result<String, String> {
    if !owns_repository(root).await? {
        return Err("project directory does not own a Git repository".to_string());
    }
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

fn parse_path_list(bytes: &[u8]) -> Result<Vec<String>, String> {
    bytes
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .map(decode_git_path)
        .collect()
}

pub async fn unmerged_files(root: &Path) -> Result<Vec<String>, String> {
    let output = run(
        root,
        "git",
        &["diff", "--name-only", "--diff-filter=U", "-z"],
    )
    .await;
    if !output.ok {
        return Err(format!("cannot read unmerged Git paths: {}", output.stderr));
    }
    parse_path_list(&output.stdout_bytes)
}

async fn changed_since(root: &Path, revision: &str) -> Result<Vec<String>, String> {
    let output = run(
        root,
        "git",
        &["diff", "--name-only", "--no-renames", "-z", revision, "--"],
    )
    .await;
    if !output.ok {
        return Err(format!(
            "cannot determine files changed by pull: {}",
            output.stderr
        ));
    }
    parse_path_list(&output.stdout_bytes)
}

/// The backup sequence: stage → commit → pull/merge → push. Steps short-circuit
/// into a SyncOutcome (conflict / push-rejected / offline / auth-missing) that
/// leaves a recoverable partial state, surfaced to the UI — it is not atomic.
pub async fn sync_with_changes(root: &Path, message: &str) -> Result<SyncResult, String> {
    if !owns_repository(root).await? {
        return Ok(SyncResult {
            outcome: SyncOutcome::NeedsSetup {
                reason: "project directory does not own a git repository".into(),
            },
            changed_files: Some(vec![]),
        });
    }
    if origin_url(root).await.is_none() {
        return Ok(SyncResult {
            outcome: SyncOutcome::NeedsSetup {
                reason: "no 'origin' remote".into(),
            },
            changed_files: Some(vec![]),
        });
    }
    let pre = repo_status(root).await?;
    if !pre.conflicted_files.is_empty() {
        return Ok(SyncResult {
            outcome: SyncOutcome::Conflict {
                files: pre.conflicted_files.clone(),
            },
            changed_files: Some(pre.conflicted_files),
        });
    }
    if pre.dirty {
        let add = run(root, "git", &["add", "-A"]).await;
        if !add.ok {
            return Err(format!("cannot stage backup: {}", add.stderr));
        }
        let commit = run(root, "git", &["commit", "-m", message]).await;
        if !commit.ok
            && !commit.stdout.contains("nothing to commit")
            && !commit.stderr.contains("nothing to commit")
        {
            return Err(format!(
                "cannot commit backup: {}{}",
                commit.stdout, commit.stderr
            ));
        }
    }
    let before = run(root, "git", &["rev-parse", "HEAD"]).await;
    if !before.ok {
        return Err(format!(
            "cannot capture pre-pull revision: {}",
            before.stderr
        ));
    }
    let revision = before.stdout.trim();
    let pull = run(root, "git", &["pull", "--no-rebase", "--no-edit"]).await;
    let changed_files = match changed_since(root, revision).await {
        Ok(paths) => Some(paths),
        Err(message) => {
            return Ok(SyncResult {
                outcome: SyncOutcome::Error { message },
                changed_files: None,
            })
        }
    };
    if !pull.ok {
        let message = format!("{}{}", pull.stdout, pull.stderr);
        let outcome = if looks_like_conflict(&message) {
            match unmerged_files(root).await {
                Ok(files) => SyncOutcome::Conflict { files },
                Err(message) => SyncOutcome::Error { message },
            }
        } else {
            classify_transport_error(&message.to_lowercase()).unwrap_or_else(|| {
                SyncOutcome::Error {
                    message: message.trim().to_string(),
                }
            })
        };
        return Ok(SyncResult {
            outcome,
            changed_files,
        });
    }
    let push = run(root, "git", &["push"]).await;
    if !push.ok {
        let message = format!("{}{}", push.stdout, push.stderr);
        let outcome = classify_git_error(&message).unwrap_or_else(|| SyncOutcome::Error {
            message: message.trim().to_string(),
        });
        return Ok(SyncResult {
            outcome,
            changed_files,
        });
    }
    let pull_noop =
        pull.stdout.contains("Already up to date") || pull.stderr.contains("Already up to date");
    let push_noop = push.stderr.contains("Everything up-to-date")
        || push.stdout.contains("Everything up-to-date");
    let outcome = if !pre.dirty && pull_noop && push_noop && pre.ahead == 0 {
        SyncOutcome::Clean
    } else {
        SyncOutcome::Synced
    };
    Ok(SyncResult {
        outcome,
        changed_files,
    })
}

pub async fn sync(root: &Path, message: &str) -> Result<SyncOutcome, String> {
    Ok(sync_with_changes(root, message).await?.outcome)
}

#[tauri::command]
pub async fn sync_project(root: String, message: String) -> Result<SyncResult, String> {
    sync_with_changes(Path::new(&root), &message).await
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
    if !owns_repository(root).await? {
        let init = run(root, "git", &["init", "-b", "main"]).await;
        if !init.ok {
            return Err(init.stderr.trim().to_string());
        }
    }
    let gi_path = root.join(".gitignore");
    let existing = match std::fs::read_to_string(&gi_path) {
        Ok(existing) => existing,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("cannot read {}: {error}", gi_path.display())),
    };
    durable_write::write(&gi_path, gitignore_with_defaults(&existing).as_bytes())?;

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

    #[tokio::test]
    async fn nested_project_never_owns_or_stages_ancestor_repository() {
        let parent = temp_repo();
        std::fs::write(parent.join("private.txt"), "parent only").unwrap();
        let child = parent.join("novel");
        std::fs::create_dir(&child).unwrap();
        std::fs::write(child.join("main.tex"), "novel").unwrap();
        assert!(!is_repo(&child).await.unwrap());
        assert!(!repo_status(&child).await.unwrap().is_repo);
        assert!(matches!(
            sync(&child, "child").await.unwrap(),
            SyncOutcome::NeedsSetup { .. }
        ));
        init_local_repo(&child).await.unwrap();
        assert!(child.join(".git").exists());
        let tracked = run(&child, "git", &["ls-files", "-z"]).await;
        assert!(!tracked.stdout.contains("private.txt"));
        let staged = run(&parent, "git", &["diff", "--cached", "--name-only"]).await;
        assert!(staged.stdout.is_empty());
        std::fs::remove_dir_all(parent).unwrap();
    }

    #[tokio::test]
    async fn real_git_status_preserves_quoted_whitespace_and_rename_paths() {
        let dir = temp_repo();
        let names = if cfg!(windows) {
            vec!["space name.tex", "dash-name.tex"]
        } else {
            vec![
                "space name.tex",
                "quote\"name.tex",
                "tab\tname.tex",
                "line\nname.tex",
            ]
        };
        for name in &names {
            std::fs::write(dir.join(name), "one").unwrap();
        }
        let status = repo_status(&dir).await.unwrap();
        for name in &names {
            assert!(
                status.changed_files.iter().any(|file| file.path == *name),
                "{status:?}"
            );
        }
        assert!(run(&dir, "git", &["add", "-A"]).await.ok);
        assert!(run(&dir, "git", &["commit", "-m", "initial"]).await.ok);
        let destination = if cfg!(windows) {
            "renamed space.tex"
        } else {
            "renamed -> quote\"\t.tex"
        };
        assert!(run(&dir, "git", &["mv", names[0], destination]).await.ok);
        let status = repo_status(&dir).await.unwrap();
        assert_eq!(status.changed_files.len(), 1);
        assert_eq!(status.changed_files[0].path, destination);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn nul_protocol_handles_rename_and_conflict_paths_without_text_decoding_loss() {
        let status =
            parse_status_nul(b"## main\0R  new -> \"\t.tex\0old\n.tex\0UU conflict\"\t\n.tex\0")
                .unwrap();
        assert_eq!(status.changed_files[0].path, "new -> \"\t.tex");
        assert_eq!(status.conflicted_files, vec!["conflict\"\t\n.tex"]);
        assert_eq!(
            parse_path_list(b"space name.tex\0quote\"\t\n.tex\0").unwrap(),
            vec!["space name.tex", "quote\"\t\n.tex"]
        );
        assert!(parse_path_list(b"invalid\xff.tex\0").is_err());
    }

    #[tokio::test]
    async fn sync_envelope_reports_remote_changed_and_deleted_files() {
        let (origin, work) = repo_with_origin();
        let other = work.parent().unwrap().join("other");
        assert!(
            run(
                work.parent().unwrap(),
                "git",
                &["clone", origin.to_str().unwrap(), other.to_str().unwrap()]
            )
            .await
            .ok
        );
        assert!(
            run(&other, "git", &["config", "user.email", "t@t.t"])
                .await
                .ok
        );
        assert!(run(&other, "git", &["config", "user.name", "t"]).await.ok);
        std::fs::remove_file(other.join("a.tex")).unwrap();
        std::fs::write(other.join("metadata.tex"), "remote").unwrap();
        assert!(run(&other, "git", &["add", "-A"]).await.ok);
        assert!(run(&other, "git", &["commit", "-m", "remote"]).await.ok);
        assert!(run(&other, "git", &["push"]).await.ok);
        let result = sync_with_changes(&work, "sync").await.unwrap();
        let changed_files = result.changed_files.unwrap();
        assert!(changed_files.contains(&"a.tex".to_string()));
        assert!(changed_files.contains(&"metadata.tex".to_string()));
        std::fs::remove_dir_all(work.parent().unwrap()).unwrap();
    }

    #[tokio::test]
    async fn sync_reports_unknown_changes_when_enumeration_fails_after_pull_updates_files() {
        let (origin, work) = repo_with_origin();
        let other = work.parent().unwrap().join("other");
        assert!(
            run(
                work.parent().unwrap(),
                "git",
                &["clone", origin.to_str().unwrap(), other.to_str().unwrap()]
            )
            .await
            .ok
        );
        assert!(
            run(&other, "git", &["config", "user.email", "t@t.t"])
                .await
                .ok
        );
        assert!(run(&other, "git", &["config", "user.name", "t"]).await.ok);
        std::fs::write(other.join("a.tex"), "remote change").unwrap();
        assert!(run(&other, "git", &["commit", "-am", "remote"]).await.ok);
        assert!(run(&other, "git", &["push"]).await.ok);
        let remote_revision = run(&other, "git", &["rev-parse", "HEAD"]).await;
        assert!(remote_revision.ok);
        let before = run(&work, "git", &["rev-parse", "HEAD"]).await;
        assert!(before.ok);
        assert!(
            run(
                &work,
                "git",
                &["config", "diff.orderFile", ".git/missing-order-file"]
            )
            .await
            .ok
        );

        let result = sync_with_changes(&work, "sync").await.unwrap();

        let after = run(&work, "git", &["rev-parse", "HEAD"]).await;
        assert!(after.ok);
        assert_ne!(before.stdout, after.stdout);
        assert_eq!(after.stdout, remote_revision.stdout);
        assert_eq!(std::fs::read(work.join("a.tex")).unwrap(), b"remote change");
        assert!(matches!(
            &result.outcome,
            SyncOutcome::Error { message }
                if message.contains("cannot determine files changed by pull")
                    && message.contains("missing-order-file")
        ));
        assert_eq!(result.changed_files, None);
        assert_eq!(
            serde_json::to_value(&result).unwrap()["changedFiles"],
            serde_json::Value::Null
        );
        std::fs::remove_dir_all(work.parent().unwrap()).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn sync_preserves_pulled_paths_when_push_fails() {
        use std::os::unix::fs::PermissionsExt;
        let (origin, work) = repo_with_origin();
        let other = work.parent().unwrap().join("other");
        assert!(
            run(
                work.parent().unwrap(),
                "git",
                &["clone", origin.to_str().unwrap(), other.to_str().unwrap()]
            )
            .await
            .ok
        );
        assert!(
            run(&other, "git", &["config", "user.email", "t@t.t"])
                .await
                .ok
        );
        assert!(run(&other, "git", &["config", "user.name", "t"]).await.ok);
        std::fs::write(other.join("a.tex"), "remote change").unwrap();
        assert!(run(&other, "git", &["commit", "-am", "remote"]).await.ok);
        assert!(run(&other, "git", &["push"]).await.ok);
        let hook = origin.join("hooks/pre-receive");
        std::fs::write(&hook, "#!/bin/sh\necho rejected-by-fixture >&2\nexit 1\n").unwrap();
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(work.join("local.tex"), "local").unwrap();
        let result = sync_with_changes(&work, "local").await.unwrap();
        assert!(matches!(
            result.outcome,
            SyncOutcome::Error { .. } | SyncOutcome::PushRejected
        ));
        assert!(result.changed_files.unwrap().contains(&"a.tex".to_string()));
        assert_eq!(
            std::fs::read_to_string(work.join("a.tex")).unwrap(),
            "remote change"
        );
        std::fs::remove_dir_all(work.parent().unwrap()).unwrap();
    }

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
        let s = repo_status(&dir).await.unwrap();
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
        let result = sync_with_changes(&work, "noop").await.unwrap();
        assert!(matches!(result.outcome, SyncOutcome::Clean));
        assert_eq!(result.changed_files, Some(vec![]));
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
        let result = sync_with_changes(&work_a, "a-change").await.unwrap();
        assert!(result.changed_files.unwrap().contains(&"a.tex".to_string()));
        let out = result.outcome;
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
