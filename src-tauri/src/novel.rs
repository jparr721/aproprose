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

/// Regenerate `metadata.tex` + `chapters.tex` from `model`. For each chapter with
/// `file: None`, allocate a stable name and create an empty stub (NEVER clobbering
/// an existing body). Returns the resolved (title, file) pairs.
fn regenerate(root: &Path, model: &SkeletonModel) -> Result<(), String> {
    let content_dir = root.join("content");
    fs::create_dir_all(&content_dir)
        .map_err(|e| format!("cannot create {}: {e}", content_dir.display()))?;

    let mut next = max_content_index(&content_dir);
    let mut resolved: Vec<(String, String)> = Vec::with_capacity(model.chapters.len());

    for ch in &model.chapters {
        let file = match &ch.file {
            Some(f) => f.clone(),
            None => {
                next += 1;
                let rel = format!("content/chapter-{next:03}.tex");
                let abs = root.join(&rel);
                // create_new so we never overwrite an existing chapter body.
                match fs::OpenOptions::new().write(true).create_new(true).open(&abs) {
                    Ok(_) => {}
                    Err(e) if e.kind() == ErrorKind::AlreadyExists => {
                        return Err(format!("chapter file {rel} already exists"));
                    }
                    Err(e) => return Err(format!("cannot create {}: {e}", abs.display())),
                }
                rel
            }
        };
        resolved.push((ch.title.clone(), file));
    }

    fs::write(root.join("metadata.tex"), render_metadata(&model.metadata))
        .map_err(|e| format!("cannot write metadata.tex: {e}"))?;
    fs::write(root.join("chapters.tex"), render_chapters(&resolved))
        .map_err(|e| format!("cannot write chapters.tex: {e}"))?;
    Ok(())
}

/// Regenerate the skeleton from `model` and return the re-derived project.
/// Handles add (file: None) / rename / reorder / metadata edits. Never deletes.
pub fn write_skeleton(root: &Path, model: &SkeletonModel) -> Result<ProjectInfo, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("invalid project root {}: {e}", root.display()))?;
    regenerate(&root, model)?;
    open_managed(&root)
}

/// Regenerate from `model` (which already excludes the chapter) AND remove the
/// chapter's body file. The one destructive path.
pub fn delete_chapter(root: &Path, model: &SkeletonModel, file: &str) -> Result<ProjectInfo, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("invalid project root {}: {e}", root.display()))?;
    regenerate(&root, model)?;
    let abs = root.join(file);
    match fs::remove_file(&abs) {
        Ok(()) => {}
        Err(e) if e.kind() == ErrorKind::NotFound => {}
        Err(e) => return Err(format!("cannot delete {}: {e}", abs.display())),
    }
    open_managed(&root)
}

/// A filesystem-safe folder name from a display name (lowercase, runs of
/// non-alphanumerics collapse to a single dash).
fn folder_slug(name: &str) -> String {
    let mut s = String::with_capacity(name.len());
    let mut prev_dash = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            s.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            s.push('-');
            prev_dash = true;
        }
    }
    let s = s.trim_matches('-').to_string();
    if s.is_empty() { "untitled-novel".to_string() } else { s }
}

/// Write the baked static files into `root`, skipping any that already exist
/// (so a migration never clobbers a customized frontmatter/options file).
fn scaffold_missing(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root.join("frontmatter")).map_err(|e| e.to_string())?;
    fs::create_dir_all(root.join("misc")).map_err(|e| e.to_string())?;
    fs::create_dir_all(root.join("content")).map_err(|e| e.to_string())?;
    let files = [
        ("frontmatter/titlepage.tex", TITLEPAGE),
        ("frontmatter/copyrightpage.tex", COPYRIGHTPAGE),
        ("frontmatter/preface.tex", PREFACE),
        ("frontmatter/tocpage.tex", TOCPAGE),
        ("misc/options.sty", OPTIONS_STY),
    ];
    for (rel, body) in files {
        let abs = root.join(rel);
        if !abs.exists() {
            fs::write(&abs, body).map_err(|e| format!("cannot write {}: {e}", abs.display()))?;
        }
    }
    Ok(())
}

/// Create a new managed novel under `parent` and return the opened project.
pub fn create_project(parent: &Path, name: &str, metadata: &NovelMetadata) -> Result<ProjectInfo, String> {
    let parent = parent
        .canonicalize()
        .map_err(|e| format!("invalid location {}: {e}", parent.display()))?;
    let root = parent.join(folder_slug(name));
    if root.exists() {
        return Err(format!("{} already exists", root.display()));
    }
    fs::create_dir(&root).map_err(|e| format!("cannot create {}: {e}", root.display()))?;

    fs::write(root.join("main.tex"), MAIN_TEX).map_err(|e| e.to_string())?;
    scaffold_missing(&root)?;
    fs::write(root.join("metadata.tex"), render_metadata(metadata)).map_err(|e| e.to_string())?;
    fs::write(root.join("chapters.tex"), render_chapters(&[])).map_err(|e| e.to_string())?;

    open_managed(&root)
}

/// Migrate a legacy project (inline metadata macros + mainmatter chapter pairs in
/// `main.tex`) to the managed layout. Backs up `main.tex` → `main.tex.bak`,
/// extracts metadata + chapters, writes `metadata.tex`/`chapters.tex` (preserving
/// existing chapter filenames), fills any missing baked files, then overwrites
/// `main.tex` with the managed template.
pub fn migrate_to_managed(root: &Path) -> Result<ProjectInfo, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("invalid project root {}: {e}", root.display()))?;

    let main_rel = project::find_main_tex(&root)?;
    let main_abs = root.join(&main_rel);
    let source = fs::read_to_string(&main_abs)
        .map_err(|e| format!("cannot read {}: {e}", main_abs.display()))?;

    let metadata = read_metadata(&source);
    let chapters: Vec<(String, String)> = project::parse_chapters(&source, &root)
        .into_iter()
        .map(|c| (c.title, c.file))
        .collect();

    // Back up the original before we overwrite it.
    fs::copy(&main_abs, root.join("main.tex.bak"))
        .map_err(|e| format!("cannot back up main.tex: {e}"))?;

    fs::write(root.join("metadata.tex"), render_metadata(&metadata)).map_err(|e| e.to_string())?;
    fs::write(root.join("chapters.tex"), render_chapters(&chapters)).map_err(|e| e.to_string())?;
    scaffold_missing(&root)?;
    fs::write(&main_abs, MAIN_TEX).map_err(|e| format!("cannot write {}: {e}", main_abs.display()))?;

    open_managed(&root)
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

    #[test]
    fn write_skeleton_allocates_new_chapter_and_preserves_bodies() {
        let dir = managed_fixture();
        let root = dir.path();
        // Model = existing chapter (with file) + one new chapter (file: None).
        let model = SkeletonModel {
            metadata: meta(),
            chapters: vec![
                SkeletonChapter { title: "Terry".into(), file: Some("content/chapter-001.tex".into()) },
                SkeletonChapter { title: "Party".into(), file: None },
            ],
        };
        let project = write_skeleton(root, &model).unwrap();
        assert_eq!(project.chapters.len(), 2);
        // The new file is chapter-002 (max index 1 + 1) and exists, empty.
        assert_eq!(project.chapters[1].file, "content/chapter-002.tex");
        assert!(root.join("content/chapter-002.tex").is_file());
        // The existing body is untouched.
        assert_eq!(
            fs::read_to_string(root.join("content/chapter-001.tex")).unwrap(),
            "Hello world.\n"
        );
        // chapters.tex lists both, in order.
        let ch = fs::read_to_string(root.join("chapters.tex")).unwrap();
        assert!(ch.contains("\\chapter{Terry}\n\\input{content/chapter-001.tex}"));
        assert!(ch.contains("\\chapter{Party}\n\\input{content/chapter-002.tex}"));
    }

    #[test]
    fn delete_chapter_removes_file_and_line() {
        let dir = managed_fixture();
        let root = dir.path();
        // Model with the only chapter removed.
        let model = SkeletonModel { metadata: meta(), chapters: vec![] };
        let project = delete_chapter(root, &model, "content/chapter-001.tex").unwrap();
        assert_eq!(project.chapters.len(), 0);
        assert!(!root.join("content/chapter-001.tex").exists());
    }

    #[test]
    fn create_project_scaffolds_and_opens() {
        let dir = tempfile::tempdir().unwrap();
        let project = create_project(dir.path(), "My New Book", &meta()).unwrap();
        let root = std::path::Path::new(&project.root);
        assert!(root.join("main.tex").is_file());
        assert!(root.join("metadata.tex").is_file());
        assert!(root.join("chapters.tex").is_file());
        assert!(root.join("frontmatter/titlepage.tex").is_file());
        assert!(root.join("misc/options.sty").is_file());
        assert!(root.join("content").is_dir());
        assert_eq!(project.chapters.len(), 0);
        // Folder is slugged.
        assert!(project.root.ends_with("my-new-book"));
    }

    #[test]
    fn migrate_extracts_metadata_and_chapters() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("content")).unwrap();
        fs::create_dir_all(root.join("frontmatter")).unwrap();
        fs::create_dir_all(root.join("misc")).unwrap();
        fs::write(root.join("misc/options.sty"), "% custom options\n").unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{book}\n\
             \\newcommand{\\authorname}{Jarred Parr}\n\
             \\newcommand{\\booktitle}{Prelude}\n\
             \\newcommand{\\subtitle}{}\n\
             \\newcommand{\\publisher}{Pub}\n\
             \\newcommand{\\isbn}{123}\n\
             \\begin{document}\n\\mainmatter\n\
             \\chapter{One}\n\\input{content/chapter0.tex}\n\
             \\chapter{Two}\n\\input{content/chapter1.tex}\n\\end{document}\n",
        )
        .unwrap();
        fs::write(root.join("content/chapter0.tex"), "a").unwrap();
        fs::write(root.join("content/chapter1.tex"), "b").unwrap();

        let project = migrate_to_managed(root).unwrap();

        assert!(root.join("main.tex.bak").is_file());
        assert_eq!(project.metadata.title, "Prelude");
        assert_eq!(project.metadata.author, "Jarred Parr");
        assert_eq!(project.chapters.len(), 2);
        // Existing filenames preserved (not renamed).
        assert_eq!(project.chapters[0].file, "content/chapter0.tex");
        // metadata.tex/chapters.tex now exist; main.tex is the managed template.
        assert!(root.join("metadata.tex").is_file());
        assert!(fs::read_to_string(root.join("main.tex")).unwrap().contains("\\input{chapters}"));
        // A customized options.sty is NOT clobbered.
        assert_eq!(fs::read_to_string(root.join("misc/options.sty")).unwrap(), "% custom options\n");
    }
}
