//! Recover the user's real `PATH` for GUI launches.
//!
//! On macOS and Linux a GUI launch (Finder, Dock, a `.desktop` entry) inherits
//! the minimal `PATH` that `launchd`/`systemd`/the display manager hands the app
//! (typically just `/usr/bin:/bin:/usr/sbin:/sbin`), not the user's interactive
//! shell `PATH`. User-installed tools then become invisible to every child
//! process we spawn: `latexmk`/`pdflatex` (`compile.rs`), the Codex/Claude CLIs
//! (`ai_cli.rs`), and `git`/`gh` (`git.rs`). Running the app from a terminal
//! hides this because the process inherits the terminal's full `PATH`.
//!
//! `repair_path` runs once at startup, before any child is spawned. Unless our
//! stdout is already a terminal (a strong signal we were started from a shell
//! that exported the full `PATH`), it replaces our `PATH` with the login shell's
//! (the same `PATH` a terminal sees), so wherever the user installed a tool, it
//! resolves. We deliberately do not hardcode install locations: the shell's own
//! `PATH` (built by the user's profile and, on macOS, `path_helper`) is the
//! single source of truth, so a tool that resolves in the user's terminal
//! resolves here too, no matter how arcane the install path. This is identical
//! on macOS and Linux; only Windows is exempt (GUI apps get the full `PATH`).

use std::ffi::{OsStr, OsString};
use std::io::IsTerminal;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::time::Duration;

/// Sentinel bracketing the `PATH` value in the shell's stdout, so we can extract
/// it cleanly even when an rc file prints a banner around it.
const PATH_MARK: &str = "__APROPROSE_PATH__";

/// Upper bound on how long we will wait for the login shell to report its
/// `PATH`. A login + interactive shell that sources heavy profiles (nvm, conda,
/// rbenv) can take a second or two; beyond this we assume a hanging rc file and
/// give up rather than block app launch forever.
const SHELL_QUERY_TIMEOUT: Duration = Duration::from_secs(5);

/// Recover the user's real `PATH` and apply it to this process so every later
/// child spawn inherits it.
///
/// No-op on Windows (GUI apps already receive the full system `PATH`) and when
/// our stdout is a terminal (we already hold the real `PATH`). When the login
/// shell cannot be queried we log why and leave the inherited `PATH` untouched
/// rather than guess install locations - so a genuinely missing tool still
/// surfaces, and a recovery failure leaves a breadcrumb instead of a silent
/// dead-end.
pub fn repair_path() {
    if cfg!(windows) || std::io::stdout().is_terminal() {
        return;
    }

    let shell_path = match login_shell_path() {
        Ok(path) => path,
        Err(reason) => {
            eprintln!(
                "aproprose: PATH recovery skipped - {reason}; installed tools \
                 (latexmk, gh, codex) may be invisible to the app"
            );
            return;
        }
    };

    // The login shell's PATH is the user's real PATH and already contains the
    // baseline system dirs (via path_helper/profile); union the inherited
    // entries underneath only so we can never drop one we started with.
    let inherited = std::env::var_os("PATH").unwrap_or_default();
    std::env::set_var("PATH", merge_path(&shell_path, &inherited));
}

/// Merge the login shell's `PATH` with the inherited `PATH`. Shell entries come
/// first (highest precedence, so the user's tool dirs win over the launchd/
/// systemd baseline); inherited entries are unioned underneath so we never drop
/// one. Pure - this is the load-bearing precedence decision, kept testable.
fn merge_path(shell_path: &OsStr, inherited: &OsStr) -> OsString {
    append_dirs(shell_path, std::env::split_paths(inherited))
}

/// Ask the user's login shell for its `PATH`. Runs the shell as a login +
/// interactive shell so it sources the user's profile, then prints `PATH` via
/// `printenv` (which yields the colon-joined value regardless of the shell's own
/// variable semantics - fish stores `PATH` as a list). Sentinels bracket the
/// value so it survives any banner an rc file prints.
///
/// Returns a specific `Err` for each distinct failure (shell unknown, shell
/// could not run, timed out, or produced no parseable `PATH`) so the caller can
/// say what went wrong. A non-zero exit is not treated as failure on its own:
/// an interactive shell driven from a non-tty often exits non-zero yet still
/// prints a usable `PATH`, so we trust a successful parse and only report the
/// exit status (and stderr) as context when the parse fails.
fn login_shell_path() -> Result<OsString, String> {
    let shell = std::env::var_os("SHELL").ok_or_else(|| "SHELL is unset".to_string())?;
    let output = run_login_shell(shell.clone())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    extract_between(&stdout, PATH_MARK)
        .map(OsString::from)
        .ok_or_else(|| {
            format!(
                "login shell {} produced no parseable PATH (exit {}); stderr: {}",
                shell.to_string_lossy(),
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            )
        })
}

/// Run the login + interactive shell to print its `PATH`, bounded by
/// `SHELL_QUERY_TIMEOUT` so a slow or hanging rc file cannot block app startup.
/// The shell runs on a worker thread; on timeout we give up and let that thread
/// (and its short-lived shell, which already has a closed stdin) wind down on
/// its own.
fn run_login_shell(shell: OsString) -> Result<Output, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let script = format!("printf '%s' {PATH_MARK}; printenv PATH; printf '%s' {PATH_MARK}");
        let result = Command::new(&shell)
            .args(["-i", "-l", "-c", &script])
            .output()
            .map_err(|e| format!("could not run login shell {}: {e}", shell.to_string_lossy()));
        let _ = tx.send(result);
    });
    match rx.recv_timeout(SHELL_QUERY_TIMEOUT) {
        Ok(result) => result,
        Err(_) => Err(format!(
            "login shell PATH query timed out after {}s",
            SHELL_QUERY_TIMEOUT.as_secs()
        )),
    }
}

/// Pull the text bracketed by the first two occurrences of `mark`, trimmed.
/// Returns `None` when both sentinels are not present or the bracketed value is
/// empty (or only whitespace). A third occurrence is ignored.
fn extract_between(haystack: &str, mark: &str) -> Option<String> {
    let start = haystack.find(mark)? + mark.len();
    let rest = &haystack[start..];
    let end = rest.find(mark)?;
    let inner = rest[..end].trim();
    (!inner.is_empty()).then(|| inner.to_string())
}

/// Append `extra` directories onto `base` (a `PATH`-format value), skipping any
/// that are empty or already present in `base`. `base` is passed through as-is
/// (it is the trusted login-shell `PATH`); appended dirs keep their order and
/// have lowest precedence. Pure.
fn append_dirs(base: &OsStr, extra: impl IntoIterator<Item = PathBuf>) -> OsString {
    let mut dirs: Vec<PathBuf> = std::env::split_paths(base).collect();
    for dir in extra {
        if !dir.as_os_str().is_empty() && !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    std::env::join_paths(&dirs).expect("PATH directories never contain the path separator")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn merge_path_gives_shell_precedence_over_inherited() {
        // GUI launch: `inherited` is the minimal launchd/systemd PATH, `shell`
        // is the user's real PATH. The user's tool dir must stay ahead of the
        // baseline, and the baseline-only `/sbin` must be preserved underneath.
        let shell = OsString::from("/opt/homebrew/bin:/usr/bin");
        let inherited = OsString::from("/usr/bin:/sbin");
        let out = merge_path(&shell, &inherited);
        assert_eq!(out, OsString::from("/opt/homebrew/bin:/usr/bin:/sbin"));
    }

    #[cfg(unix)]
    #[test]
    fn append_dirs_adds_absent_dir() {
        let base = OsString::from("/usr/bin:/bin");
        let out = append_dirs(&base, ["/Library/TeX/texbin"].map(PathBuf::from));
        assert_eq!(out, OsString::from("/usr/bin:/bin:/Library/TeX/texbin"));
    }

    #[cfg(unix)]
    #[test]
    fn append_dirs_skips_present_dir() {
        let base = OsString::from("/usr/bin:/opt/homebrew/bin:/bin");
        let out = append_dirs(&base, ["/opt/homebrew/bin"].map(PathBuf::from));
        assert_eq!(out, base);
    }

    #[cfg(unix)]
    #[test]
    fn append_dirs_skips_empty_and_preserves_order() {
        let base = OsString::from("/usr/bin");
        let out = append_dirs(
            &base,
            ["", "/opt/homebrew/bin", "/usr/bin"].map(PathBuf::from),
        );
        // Empty dropped, already-present `/usr/bin` not duplicated.
        assert_eq!(out, OsString::from("/usr/bin:/opt/homebrew/bin"));
    }

    #[cfg(unix)]
    #[test]
    fn append_dirs_leaves_base_internal_dupes_untouched() {
        // Dedup applies only to `extra` vs `base`; we trust `base` (the login
        // shell PATH) and never rewrite it.
        let base = OsString::from("/usr/bin:/usr/bin");
        let out = append_dirs(&base, ["/usr/bin"].map(PathBuf::from));
        assert_eq!(out, base);
    }

    #[test]
    fn extract_between_pulls_trimmed_value() {
        let s = "rc banner\n__M__/a:/b\n__M__trailing noise";
        assert_eq!(extract_between(s, "__M__"), Some("/a:/b".to_string()));
    }

    #[test]
    fn extract_between_uses_first_pair_only() {
        // A third sentinel (e.g. an rc banner echoing the marker) is ignored.
        assert_eq!(
            extract_between("__M__/a__M__/b__M__", "__M__"),
            Some("/a".to_string())
        );
    }

    #[test]
    fn extract_between_requires_both_sentinels() {
        assert_eq!(extract_between("__M__/a:/b only one", "__M__"), None);
        assert_eq!(extract_between("no marks here", "__M__"), None);
    }

    #[test]
    fn extract_between_rejects_empty_value() {
        assert_eq!(extract_between("__M____M__", "__M__"), None);
    }

    #[test]
    fn extract_between_rejects_whitespace_only_value() {
        // A shell with PATH unset prints nothing between the sentinels but for
        // surrounding newlines; trim collapses it to empty -> None.
        assert_eq!(extract_between("__M__\n  \n__M__", "__M__"), None);
    }
}
