//! Managed-novel scaffolding: the baked LaTeX template, the regeneration of the
//! two live files (`metadata.tex`, `chapters.tex`), project creation, chapter
//! deletion, and one-time migration of a legacy project to the managed layout.
//!
//! The app OWNS the skeleton: `metadata.tex` + `chapters.tex` are regenerated
//! from a model the frontend sends. `main.tex`, `frontmatter/*`, and
//! `misc/options.sty` are baked into the binary and written once at scaffold.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use crate::project::{self, NovelMetadata, ProjectInfo};

// ── Baked template files ──────────────────────────────────────────────────────

const MAIN_TEX: &str = include_str!("../templates/main.tex");
const TITLEPAGE: &str = include_str!("../templates/frontmatter/titlepage.tex");
const COPYRIGHTPAGE: &str = include_str!("../templates/frontmatter/copyrightpage.tex");
const PREFACE: &str = include_str!("../templates/frontmatter/preface.tex");
const TOCPAGE: &str = include_str!("../templates/frontmatter/tocpage.tex");
const OPTIONS_STY: &str = include_str!("../templates/misc/options.sty");

// ── Model (mirrors src/lib/types.ts) ──────────────────────────────────────────

/// One chapter in a skeleton-mutation request. `file: None` means "new chapter —
/// allocate a stable filename and create an empty body".
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkeletonChapter {
    pub title: String,
    pub file: Option<String>,
}

/// The full skeleton the frontend owns. `write_skeleton`/`delete_chapter`
/// regenerate `metadata.tex` + `chapters.tex` from this.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkeletonModel {
    pub metadata: NovelMetadata,
    pub chapters: Vec<SkeletonChapter>,
}

/// The result of opening a folder: either a ready managed project, or a signal
/// that the folder is a legacy (unmanaged) project needing conversion.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenOutcome {
    /// "managed" or "needsMigration".
    pub status: String,
    /// Present when status == "managed".
    pub project: Option<ProjectInfo>,
    /// Present when status == "needsMigration": the legacy main file.
    pub main_file: Option<String>,
    /// Present when status == "needsMigration": chapter count for the prompt.
    pub detected_chapters: Option<usize>,
}

// ── Template rendering ─────────────────────────────────────────────────────────

/// Render `metadata.tex` — the 6 `\newcommand` macros. `editionyear` is always
/// `\the\year{}` (current year at compile time).
pub fn render_metadata(m: &NovelMetadata) -> String {
    format!(
        "\\newcommand{{\\authorname}}{{{author}}}\n\
         \\newcommand{{\\booktitle}}{{{title}}}\n\
         \\newcommand{{\\subtitle}}{{{subtitle}}}\n\
         \\newcommand{{\\publisher}}{{{publisher}}}\n\
         \\newcommand{{\\editionyear}}{{\\the\\year{{}}}}\n\
         \\newcommand{{\\isbn}}{{{isbn}}}\n",
        author = m.author,
        title = m.title,
        subtitle = m.subtitle,
        publisher = m.publisher,
        isbn = m.isbn,
    )
}

/// Render `chapters.tex` — the ordered `\chapter{TITLE}` + `\input{FILE}` pairs.
/// An empty list yields a single explanatory comment.
pub fn render_chapters(chapters: &[(String, String)]) -> String {
    if chapters.is_empty() {
        return "% Chapters are managed by aproprose — add chapters from the app.\n".to_string();
    }
    let mut out = String::new();
    for (title, file) in chapters {
        out.push_str(&format!("\\chapter{{{title}}}\n\\input{{{file}}}\n"));
    }
    out
}

/// The largest leading-number found across `content/*.tex` filenames, or 0 if
/// none. Tolerant of prelude's irregular legacy names (e.g. `chapter7-interlude.tex`
/// → 7, `chapter13-interlude.tex` → 13, `chapter-001.tex` → 1). New chapters get
/// `content/chapter-{max+1:03}.tex`, so there is never a collision.
fn max_content_index(content_dir: &Path) -> usize {
    let Ok(entries) = fs::read_dir(content_dir) else {
        return 0;
    };
    let mut max = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("tex") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        // First contiguous run of digits in the stem.
        let digits: String = stem
            .chars()
            .skip_while(|c| !c.is_ascii_digit())
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if let Ok(n) = digits.parse::<usize>() {
            max = max.max(n);
        }
    }
    max
}

/// Build a `NovelMetadata` from a source containing the 6 `\newcommand` macros
/// (works for both `metadata.tex` and a legacy `main.tex` preamble).
fn read_metadata(source: &str) -> NovelMetadata {
    let get = |name: &str| {
        project::newcommand_value(source, name)
            .map(|v| v.trim().to_string())
            .unwrap_or_default()
    };
    NovelMetadata {
        title: get("booktitle"),
        subtitle: get("subtitle"),
        author: get("authorname"),
        publisher: get("publisher"),
        isbn: get("isbn"),
    }
}

/// Open a managed project: chapters from `chapters.tex`, metadata from `metadata.tex`.
pub fn open_managed(root: &Path) -> Result<ProjectInfo, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("cannot open project root {}: {e}", root.display()))?;

    let main_rel = project::find_main_tex(&root)?;

    let meta_src = fs::read_to_string(root.join("metadata.tex")).unwrap_or_default();
    let metadata = read_metadata(&meta_src);

    let chapters_src = fs::read_to_string(root.join("chapters.tex")).unwrap_or_default();
    let chapters = project::parse_chapters(&chapters_src, &root);

    let title = (!metadata.title.is_empty()).then(|| metadata.title.clone());
    let author = (!metadata.author.is_empty()).then(|| metadata.author.clone());
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
        metadata,
        chapters,
    })
}

/// Whether a project directory uses the managed layout.
fn is_managed(root: &Path) -> bool {
    root.join("chapters.tex").is_file() && root.join("metadata.tex").is_file()
}

/// Open entry point used by the `open_project` command. Managed → ready project;
/// otherwise → a `needsMigration` signal (requires a discoverable main `.tex`).
pub fn detect_and_open(root: &Path) -> Result<OpenOutcome, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("cannot open project root {}: {e}", root.display()))?;

    if is_managed(&root) {
        let project = open_managed(&root)?;
        return Ok(OpenOutcome {
            status: "managed".into(),
            project: Some(project),
            main_file: None,
            detected_chapters: None,
        });
    }

    // Unmanaged: there must be a legacy main file to migrate, or it isn't a project.
    let main_rel = project::find_main_tex(&root)?;
    let source = fs::read_to_string(root.join(&main_rel)).unwrap_or_default();
    let detected = project::parse_chapters(&source, &root).len();

    Ok(OpenOutcome {
        status: "needsMigration".into(),
        project: None,
        main_file: Some(main_rel),
        detected_chapters: Some(detected),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta() -> NovelMetadata {
        NovelMetadata {
            title: "Prelude To Darkness".into(),
            subtitle: String::new(),
            author: "Jarred Parr".into(),
            publisher: "Publisher".into(),
            isbn: "978-3-16-148410-0".into(),
        }
    }

    #[test]
    fn metadata_renders_all_six_macros() {
        let out = render_metadata(&meta());
        assert!(out.contains("\\newcommand{\\booktitle}{Prelude To Darkness}"));
        assert!(out.contains("\\newcommand{\\authorname}{Jarred Parr}"));
        assert!(out.contains("\\newcommand{\\subtitle}{}"));
        assert!(out.contains("\\newcommand{\\publisher}{Publisher}"));
        assert!(out.contains("\\newcommand{\\isbn}{978-3-16-148410-0}"));
        assert!(out.contains("\\newcommand{\\editionyear}{\\the\\year{}}"));
    }

    #[test]
    fn chapters_empty_renders_comment() {
        let out = render_chapters(&[]);
        assert!(out.starts_with("% Chapters are managed by aproprose"));
    }

    #[test]
    fn chapters_renders_ordered_pairs() {
        let out = render_chapters(&[
            ("Terry".into(), "content/chapter-001.tex".into()),
            ("Party".into(), "content/chapter-002.tex".into()),
        ]);
        assert_eq!(
            out,
            "\\chapter{Terry}\n\\input{content/chapter-001.tex}\n\
             \\chapter{Party}\n\\input{content/chapter-002.tex}\n"
        );
    }

    #[test]
    fn max_index_empty_dir_is_zero() {
        let dir = tempfile::tempdir().unwrap();
        let content = dir.path().join("content");
        fs::create_dir_all(&content).unwrap();
        assert_eq!(max_content_index(&content), 0);
    }

    #[test]
    fn max_index_handles_irregular_legacy_names() {
        let dir = tempfile::tempdir().unwrap();
        let content = dir.path().join("content");
        fs::create_dir_all(&content).unwrap();
        for name in ["chapter0.tex", "chapter12.tex", "chapter13-interlude.tex", "notes.txt"] {
            fs::write(content.join(name), "").unwrap();
        }
        assert_eq!(max_content_index(&content), 13);
    }

    /// Write a minimal managed project (main.tex/metadata.tex/chapters.tex/content/)
    /// into a fresh temp dir and return it.
    fn managed_fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("content")).unwrap();
        fs::write(root.join("main.tex"), MAIN_TEX).unwrap();
        fs::write(root.join("metadata.tex"), render_metadata(&meta())).unwrap();
        fs::write(
            root.join("chapters.tex"),
            render_chapters(&[("Terry".into(), "content/chapter-001.tex".into())]),
        )
        .unwrap();
        fs::write(root.join("content/chapter-001.tex"), "Hello world.\n").unwrap();
        dir
    }

    #[test]
    fn detect_managed_returns_project() {
        let dir = managed_fixture();
        let outcome = detect_and_open(dir.path()).unwrap();
        assert_eq!(outcome.status, "managed");
        let project = outcome.project.unwrap();
        assert_eq!(project.metadata.title, "Prelude To Darkness");
        assert_eq!(project.chapters.len(), 1);
        assert_eq!(project.chapters[0].title, "Terry");
        assert_eq!(project.chapters[0].file, "content/chapter-001.tex");
    }

    #[test]
    fn detect_unmanaged_signals_migration() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("content")).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{book}\n\\begin{document}\n\\mainmatter\n\
             \\chapter{One}\n\\input{content/chapter0.tex}\n\
             \\chapter{Two}\n\\input{content/chapter1.tex}\n\\end{document}\n",
        )
        .unwrap();
        fs::write(root.join("content/chapter0.tex"), "a").unwrap();
        fs::write(root.join("content/chapter1.tex"), "b").unwrap();
        let outcome = detect_and_open(root).unwrap();
        assert_eq!(outcome.status, "needsMigration");
        assert_eq!(outcome.detected_chapters, Some(2));
    }
}
