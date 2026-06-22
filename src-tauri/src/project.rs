//! Project discovery + LaTeX preamble/chapter parsing.
//!
//! `open_project` locates the main `.tex` file, reads title/author from the
//! preamble (resolving the `\booktitle` / `\authorname` indirection the real
//! manuscripts use), and enumerates the `\chapter{…}` / `\input{…}` pairs in
//! reading order. The shapes here mirror `src/lib/types.ts` exactly; serde
//! renames every field to camelCase so the JSON the webview receives matches
//! the `ProjectInfo` / `ChapterRef` interfaces byte-for-byte.

use serde::Serialize;
use std::path::Path;

/// A chapter as discovered in the project's main `.tex` file.
/// Mirrors `ChapterRef` in `src/lib/types.ts`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterRef {
    /// Stable slug derived from the input file path.
    pub id: String,
    /// Display label — the Roman numeral of the 1-based chapter index
    /// (the documents render chapters via `\Roman{chapter}`).
    pub label: String,
    /// Title from the `\chapter{…}` command.
    pub title: String,
    /// Project-relative path of the `\input{…}` file.
    pub file: String,
    /// Whitespace-token word count of the chapter body (best-effort).
    pub word_count: usize,
}

/// The shape returned by the `open_project` command.
/// Mirrors `ProjectInfo` in `src/lib/types.ts`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub root: String,
    pub name: String,
    pub main_file: String,
    pub title: Option<String>,
    pub author: Option<String>,
    pub chapters: Vec<ChapterRef>,
}

/// Parse a project directory into a [`ProjectInfo`].
pub fn open_project(root: &Path) -> Result<ProjectInfo, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("cannot open project root {}: {e}", root.display()))?;

    let main_rel = find_main_tex(&root)?;
    let main_abs = root.join(&main_rel);
    let source = std::fs::read_to_string(&main_abs)
        .map_err(|e| format!("cannot read {}: {e}", main_abs.display()))?;

    // Title / author, resolving \booktitle{} / \authorname{} indirection.
    let title = resolve_meta(&source, "title", "booktitle");
    let author = resolve_meta(&source, "author", "authorname");

    let chapters = parse_chapters(&source, &root);

    // Display name: the book title if we have one, else the directory name.
    let name = title.clone().unwrap_or_else(|| {
        root.file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.display().to_string())
    });

    Ok(ProjectInfo {
        root: root.display().to_string(),
        name,
        main_file: main_rel,
        title,
        author,
        chapters,
    })
}

/// Locate the main `.tex` file relative to `root`.
///
/// Prefers `main.tex`; otherwise the first `*.tex` (sorted, top level first)
/// that contains both `\documentclass` and `\begin{document}`.
fn find_main_tex(root: &Path) -> Result<String, String> {
    let main = root.join("main.tex");
    if main.is_file() {
        return Ok("main.tex".to_string());
    }

    // Collect candidate .tex files: top level first, then one level deep, so a
    // root-level document wins over one buried in a subdirectory.
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    collect_tex(root, 0, 2, &mut candidates);
    candidates.sort();

    for abs in candidates {
        if let Ok(text) = std::fs::read_to_string(&abs) {
            if text.contains("\\documentclass") && text.contains("\\begin{document}") {
                let rel = abs
                    .strip_prefix(root)
                    .unwrap_or(&abs)
                    .to_string_lossy()
                    .replace('\\', "/");
                return Ok(rel);
            }
        }
    }

    Err(format!(
        "no main .tex file found in {} (looked for main.tex or a *.tex with \\documentclass + \\begin{{document}})",
        root.display()
    ))
}

/// Recursively gather `*.tex` files up to `max_depth` levels below `dir`.
fn collect_tex(dir: &Path, depth: usize, max_depth: usize, out: &mut Vec<std::path::PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // Skip common build/output dirs to keep discovery cheap.
            let skip = matches!(
                path.file_name().and_then(|s| s.to_str()),
                Some(".git" | "node_modules" | "target" | "_minted")
            );
            if !skip && depth < max_depth {
                collect_tex(&path, depth + 1, max_depth, out);
            }
        } else if path.extension().and_then(|s| s.to_str()) == Some("tex") {
            out.push(path);
        }
    }
}

/// Resolve a metadata field that may be defined directly (`\title{X}`) or via a
/// `\newcommand` alias (`\title{\booktitle}` + `\newcommand{\booktitle}{X}`).
///
/// `cmd` is the LaTeX command (e.g. `title`), `alias` the conventional macro
/// name the manuscripts use (e.g. `booktitle`). Returns `None` when neither is
/// present or the value resolves to empty.
fn resolve_meta(source: &str, cmd: &str, alias: &str) -> Option<String> {
    // Prefer the explicit alias \newcommand (it holds the literal value), then
    // fall back to whatever \title{…}/\author{…} contains.
    if let Some(val) = newcommand_value(source, alias) {
        let trimmed = strip_inline(&val);
        if !trimmed.is_empty() {
            return Some(trimmed);
        }
    }

    let raw = command_arg(source, cmd)?;
    let raw = raw.trim();

    // If the field just points at the alias macro (e.g. \title{\booktitle}),
    // resolve through the \newcommand definition.
    let macro_ref = raw.trim_start_matches('\\');
    if raw.starts_with('\\') {
        if let Some(val) = newcommand_value(source, macro_ref) {
            let trimmed = strip_inline(&val);
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }

    let trimmed = strip_inline(raw);
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

/// Extract the brace-balanced argument of `\<cmd>{…}` (the first occurrence
/// that is not inside a `\newcommand` definition of that same command).
fn command_arg(source: &str, cmd: &str) -> Option<String> {
    let needle = format!("\\{cmd}");
    let bytes = source.as_bytes();
    let mut search_from = 0;

    while let Some(rel) = source[search_from..].find(&needle) {
        let at = search_from + rel;
        // Ensure the match is the whole command token, not a prefix of a longer
        // command (e.g. \titlepage when looking for \title).
        let after = at + needle.len();
        let next = bytes.get(after).copied();
        let is_boundary = next.map(|c| !c.is_ascii_alphabetic()).unwrap_or(true);

        // Skip `\newcommand{\title}` style definitions of the command itself.
        let is_def = source[..at].trim_end().ends_with('{')
            && source[..at]
                .trim_end()
                .trim_end_matches('{')
                .trim_end()
                .ends_with("\\newcommand");

        if is_boundary && !is_def {
            // Find the opening brace following the command name.
            if let Some(open_rel) = source[after..].find('{') {
                let open = after + open_rel;
                if source[after..open].trim().is_empty() {
                    if let Some(arg) = balanced_braces(source, open) {
                        return Some(arg);
                    }
                }
            }
        }
        search_from = after;
    }
    None
}

/// Extract the value `\newcommand{\<name>}{VALUE}` (also accepts the
/// `\newcommand\name{VALUE}` form and an optional `[n]` arity argument).
fn newcommand_value(source: &str, name: &str) -> Option<String> {
    let name = name.trim_start_matches('\\');
    for kw in ["\\newcommand", "\\renewcommand", "\\providecommand"] {
        let mut search_from = 0;
        while let Some(rel) = source[search_from..].find(kw) {
            let at = search_from + rel;
            let mut cur = at + kw.len();
            let rest = &source[cur..];

            // The command being defined: either `{\name}` or `\name`.
            let defined = if rest.trim_start().starts_with('{') {
                // `{\name}`
                let open = cur + (rest.len() - rest.trim_start().len());
                let inner = balanced_braces(source, open)?;
                cur = open
                    + match_brace_end(source, open)
                        .map(|e| e - open + 1)
                        .unwrap_or(0);
                inner.trim().trim_start_matches('\\').to_string()
            } else if let Some(stripped) = rest.trim_start().strip_prefix('\\') {
                // `\name`
                let nm: String = stripped
                    .chars()
                    .take_while(|c| c.is_ascii_alphabetic())
                    .collect();
                cur += rest.len() - rest.trim_start().len() + 1 + nm.len();
                nm
            } else {
                search_from = at + kw.len();
                continue;
            };

            if defined == name {
                // Skip an optional [arity] spec, then read the body `{…}`.
                let tail = &source[cur..];
                let tail_trim = tail.trim_start();
                let mut body_start = cur + (tail.len() - tail_trim.len());
                if tail_trim.starts_with('[') {
                    if let Some(close) = tail_trim.find(']') {
                        body_start += close + 1;
                    }
                }
                let body_trim = source[body_start..].trim_start();
                let open = body_start + (source[body_start..].len() - body_trim.len());
                if source.as_bytes().get(open) == Some(&b'{') {
                    return balanced_braces(source, open);
                }
            }
            search_from = at + kw.len();
        }
    }
    None
}

/// Given the index of an opening `{`, return the brace-balanced contents
/// (excluding the outer braces), or `None` if unbalanced.
fn balanced_braces(source: &str, open: usize) -> Option<String> {
    let end = match_brace_end(source, open)?;
    Some(source[open + 1..end].to_string())
}

/// Given the index of an opening `{`, return the index of its matching `}`.
fn match_brace_end(source: &str, open: usize) -> Option<usize> {
    let bytes = source.as_bytes();
    if bytes.get(open) != Some(&b'{') {
        return None;
    }
    let mut depth = 0i32;
    for (i, &b) in bytes.iter().enumerate().skip(open) {
        match b {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

/// Scan the main file for `\chapter{TITLE}` commands, each optionally followed
/// (next non-empty, non-comment line) by `\input{FILE}`.
fn parse_chapters(source: &str, root: &Path) -> Vec<ChapterRef> {
    // Restrict to the document body so preamble \chapter redefinitions (rare)
    // and example code don't pollute the list.
    let body = source
        .find("\\begin{document}")
        .map(|i| &source[i..])
        .unwrap_or(source);

    let lines: Vec<&str> = body.lines().collect();
    let mut chapters: Vec<ChapterRef> = Vec::new();

    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('%') {
            continue;
        }
        let Some(title) = inline_command_arg(trimmed, "chapter") else {
            continue;
        };

        // Look ahead for the next meaningful line; if it is \input{…}, that's
        // the chapter's body file.
        let mut file: Option<String> = None;
        for next in lines.iter().skip(idx + 1) {
            let nt = next.trim();
            if nt.is_empty() || nt.starts_with('%') {
                continue;
            }
            if let Some(arg) = inline_command_arg(nt, "input") {
                file = Some(arg);
            }
            break;
        }

        let chapter_number = chapters.len() + 1;
        let label = to_roman(chapter_number);

        // Normalize the \input path: append .tex if it lacks an extension.
        let file = file.unwrap_or_default();
        let file = if file.is_empty() || Path::new(&file).extension().is_some() {
            file
        } else {
            format!("{file}.tex")
        };

        let id = slug(&file, chapter_number);
        let word_count = if file.is_empty() {
            0
        } else {
            count_words(&root.join(&file))
        };

        chapters.push(ChapterRef {
            id,
            label,
            title: strip_inline(&title),
            file,
            word_count,
        });
    }

    chapters
}

/// Extract `\<cmd>{ARG}` from a single line, returning the brace contents.
fn inline_command_arg(line: &str, cmd: &str) -> Option<String> {
    let needle = format!("\\{cmd}");
    let at = line.find(&needle)?;
    let after = at + needle.len();
    // Reject prefix matches (\chapterfoo) by requiring a non-letter next.
    if let Some(c) = line[after..].chars().next() {
        if c.is_ascii_alphabetic() {
            return None;
        }
    }
    let rest = &line[after..];
    let rest_trim = rest.trim_start();
    if !rest_trim.starts_with('{') {
        return None;
    }
    let open = after + (rest.len() - rest_trim.len());
    balanced_braces(line, open)
}

/// Convert a 1-based number to an uppercase Roman numeral (matching the
/// document's `\Roman{chapter}` rendering). Falls back to the decimal string
/// for non-positive numbers.
fn to_roman(mut n: usize) -> String {
    if n == 0 {
        return "0".to_string();
    }
    const TABLE: &[(usize, &str)] = &[
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];
    let mut out = String::new();
    for &(value, sym) in TABLE {
        while n >= value {
            out.push_str(sym);
            n -= value;
        }
    }
    out
}

/// Build a stable slug id from a file path, e.g.
/// "content/chapter7-interlude.tex" -> "content-chapter7-interlude".
fn slug(file: &str, fallback_n: usize) -> String {
    let stem = Path::new(file)
        .with_extension("")
        .to_string_lossy()
        .into_owned();
    let mut s = String::with_capacity(stem.len());
    let mut prev_dash = false;
    for ch in stem.chars() {
        if ch.is_ascii_alphanumeric() {
            s.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            s.push('-');
            prev_dash = true;
        }
    }
    let s = s.trim_matches('-').to_string();
    if s.is_empty() {
        format!("chapter-{fallback_n}")
    } else {
        s
    }
}

/// Best-effort word count of a chapter body: strip LaTeX comments and commands,
/// then count whitespace-separated tokens.
fn count_words(path: &Path) -> usize {
    let Ok(text) = std::fs::read_to_string(path) else {
        return 0;
    };
    let cleaned = strip_latex(&text);
    cleaned.split_whitespace().count()
}

/// Strip LaTeX comments, commands, and braces from a block of body text so it
/// can be word-counted. This is deliberately approximate — it favours not
/// over-counting markup over perfect fidelity.
fn strip_latex(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for line in text.lines() {
        // Drop comments: everything after an unescaped `%`.
        let mut code = String::with_capacity(line.len());
        let mut chars = line.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '\\' {
                // Keep the escaped char's following token as text-ish.
                code.push(c);
                if let Some(&n) = chars.peek() {
                    code.push(n);
                    chars.next();
                }
            } else if c == '%' {
                break;
            } else {
                code.push(c);
            }
        }
        out.push_str(&code);
        out.push('\n');
    }

    // Remove control sequences (\foo, \foo*) and bare braces, leaving the prose.
    let mut result = String::with_capacity(out.len());
    let mut chars = out.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                // Consume a command name (letters) or a single escaped symbol.
                if let Some(&n) = chars.peek() {
                    if n.is_ascii_alphabetic() {
                        while let Some(&n) = chars.peek() {
                            if n.is_ascii_alphabetic() {
                                chars.next();
                            } else {
                                break;
                            }
                        }
                        // Skip a trailing star and a single optional [..]/{..} run
                        // is left for the brace-stripping below.
                    } else {
                        // Escaped punctuation (\& \% \_): keep the symbol.
                        result.push(n);
                        chars.next();
                    }
                }
                result.push(' ');
            }
            '{' | '}' => result.push(' '),
            _ => result.push(c),
        }
    }
    result
}

/// Turn a raw LaTeX argument into a plain inline string: unwrap simple markup
/// commands and collapse whitespace. Used for titles/author display.
fn strip_inline(s: &str) -> String {
    let cleaned = strip_latex(s);
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}
