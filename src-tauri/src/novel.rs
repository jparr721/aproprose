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
}
