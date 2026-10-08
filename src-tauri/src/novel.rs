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
use crate::{durable_write, tex_text};

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
pub fn render_metadata(metadata: &NovelMetadata) -> String {
    render_metadata_preserving(metadata, "")
}

fn render_metadata_preserving(metadata: &NovelMetadata, source: &str) -> String {
    let mut output = String::from(tex_text::DEFINITION);
    for (name, value) in [
        ("authorname", &metadata.author),
        ("booktitle", &metadata.title),
        ("subtitle", &metadata.subtitle),
        ("publisher", &metadata.publisher),
        ("isbn", &metadata.isbn),
    ] {
        let existing = project::newcommand_value(source, name);
        let rendered = match existing {
            Some(raw) if metadata_value(&raw) == *value => raw,
            _ => tex_text::encode(value),
        };
        output.push_str(&format!("\\newcommand{{\\{name}}}{{{rendered}}}\n"));
    }
    output.push_str("\\newcommand{\\editionyear}{\\the\\year{}}\n");
    output
}

pub fn render_chapters(chapters: &[(String, String)]) -> String {
    let rendered: Vec<(String, String)> = chapters
        .iter()
        .map(|(title, file)| (tex_text::encode(title), file.clone()))
        .collect();
    render_chapter_sources(&rendered)
}

fn render_chapter_sources(chapters: &[(String, String)]) -> String {
    if chapters.is_empty() {
        return "% Chapters are managed by aproprose - add chapters from the app.\n".to_string();
    }
    let mut output = String::from(tex_text::DEFINITION);
    for (title, file) in chapters {
        output.push_str(&format!("\\chapter{{{title}}}\n\\input{{{file}}}\n"));
    }
    output
}

/// The largest leading-number found across `content/*.tex` filenames, or 0 if
/// none. Tolerant of prelude's irregular legacy names (e.g. `chapter7-interlude.tex`
/// → 7, `chapter13-interlude.tex` → 13, `chapter-001.tex` → 1). New chapters get
/// `content/chapter-{max+1:03}.tex`, so there is never a collision.
fn max_content_index(content_dir: &Path) -> Result<usize, String> {
    let entries = fs::read_dir(content_dir).map_err(|error| {
        format!(
            "cannot read content directory {}: {error}",
            content_dir.display()
        )
    })?;
    let mut max = 0usize;
    for entry in entries {
        let entry = entry
            .map_err(|error| format!("cannot read entry in {}: {error}", content_dir.display()))?;
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
    Ok(max)
}

/// Build a `NovelMetadata` from a source containing the `\newcommand` macros
/// (works for both `metadata.tex` and a legacy `main.tex` preamble).
///
/// Migration limitation: this reads only the `\newcommand{\booktitle}{…}` style
/// macros that this app's template (and prelude) use. A hand-built legacy project
/// that puts its title/author in bare `\title{…}` / `\author{…}` commands will
/// migrate with empty metadata — the author can re-enter it in Project settings,
/// and the original is preserved in `main.tex.bak`.
fn metadata_value(raw: &str) -> String {
    tex_text::decode(raw).unwrap_or_else(|| raw.trim().to_string())
}

fn read_metadata(source: &str) -> NovelMetadata {
    let get = |name: &str| {
        project::newcommand_value(source, name)
            .map(|value| metadata_value(&value))
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

fn read_managed_metadata(source: &str) -> Result<NovelMetadata, String> {
    for name in ["booktitle", "subtitle", "authorname", "publisher", "isbn"] {
        let raw = project::newcommand_value(source, name).ok_or_else(|| {
            format!("invalid required metadata.tex: missing or malformed \\{name} definition")
        })?;
        if raw.starts_with("\\aproproseplain{") && tex_text::decode(&raw).is_none() {
            return Err(format!(
                "invalid required metadata.tex: malformed plain-text value for \\{name}"
            ));
        }
    }
    Ok(read_metadata(source))
}

/// Open a managed project: chapters from `chapters.tex`, metadata from `metadata.tex`.
pub fn open_managed(root: &Path) -> Result<ProjectInfo, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("cannot open project root {}: {e}", root.display()))?;

    let main_rel = project::find_main_tex(&root)?;

    read_required(&root, &main_rel)?;
    let meta_src = read_required(&root, "metadata.tex")?;
    let metadata = read_managed_metadata(&meta_src)?;
    let chapters_src = read_required(&root, "chapters.tex")?;
    project::validate_managed_chapters(&chapters_src)?;
    let chapters = project::parse_chapters(&chapters_src, &root)?;

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
fn read_required(root: &Path, file: &str) -> Result<String, String> {
    fs::read_to_string(root.join(file)).map_err(|error| {
        format!(
            "cannot read required project file {}: {error}",
            root.join(file).display()
        )
    })
}

fn is_managed(root: &Path) -> bool {
    root.join("chapters.tex").exists() || root.join("metadata.tex").exists()
}

/// Open entry point used by the `open_project` command. Managed → ready project;
/// otherwise → a `needsMigration` signal (requires a discoverable main `.tex`).
pub fn detect_and_open(root: &Path) -> Result<OpenOutcome, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("cannot open project root {}: {e}", root.display()))?;

    let main_rel = project::find_main_tex(&root)?;
    let source = read_required(&root, &main_rel)?;
    if is_managed(&root)
        || source.contains("\\input{metadata}")
        || source.contains("\\input{chapters}")
    {
        let project = open_managed(&root)?;
        return Ok(OpenOutcome {
            status: "managed".into(),
            project: Some(project),
            main_file: None,
            detected_chapters: None,
        });
    }

    // Unmanaged: there must be a legacy main file to migrate, or it isn't a project.
    let detected = project::parse_chapters(&source, &root)?.len();

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
fn regenerate(root: &Path, model: &SkeletonModel) -> Result<Vec<String>, String> {
    let old_metadata = read_required(root, "metadata.tex")?;
    read_managed_metadata(&old_metadata)?;
    let old_chapters = read_required(root, "chapters.tex")?;
    project::validate_managed_chapters(&old_chapters)?;
    let old_pairs = project::chapter_pairs(&old_chapters);
    let content_dir = root.join("content");
    fs::create_dir_all(&content_dir)
        .map_err(|error| format!("cannot create {}: {error}", content_dir.display()))?;
    let mut next = max_content_index(&content_dir)?;
    let mut resolved = Vec::with_capacity(model.chapters.len());
    let mut staged_new = Vec::new();
    for chapter in &model.chapters {
        let file = match &chapter.file {
            Some(file) => {
                let root_name = root
                    .to_str()
                    .ok_or_else(|| "project root is not UTF-8".to_string())?;
                let path = crate::resolve_within_root(root_name, file)?;
                fs::read_to_string(&path).map_err(|error| {
                    format!("cannot read required chapter {}: {error}", path.display())
                })?;
                file.clone()
            }
            None => {
                next += 1;
                let file = format!("content/chapter-{next:03}.tex");
                let path = root.join(&file);
                if path.exists() {
                    return Err(format!("chapter file {file} already exists"));
                }
                staged_new.push(durable_write::stage(&path, b"")?);
                file
            }
        };
        let title = old_pairs
            .iter()
            .find(|(_, old_file)| old_file == &file)
            .filter(|(raw, _)| project::chapter_display_title(raw) == chapter.title)
            .map(|(raw, _)| raw.clone())
            .unwrap_or_else(|| tex_text::encode(&chapter.title));
        resolved.push((title, file));
    }
    let metadata = render_metadata_preserving(&model.metadata, &old_metadata);
    let chapters = render_chapter_sources(&resolved);
    let staged_metadata = durable_write::stage(&root.join("metadata.tex"), metadata.as_bytes())?;
    let staged_chapters = durable_write::stage(&root.join("chapters.tex"), chapters.as_bytes())?;
    let mut committed = Vec::new();
    for staged in staged_new {
        let path = staged
            .path()
            .strip_prefix(root)
            .map_err(|error| error.to_string())?
            .display()
            .to_string();
        if let Err(error) = staged.commit_new() {
            if error.replaced() {
                committed.push(path.clone());
            }
            return Err(skeleton_failure(&committed, &path, &error.to_string()));
        }
        committed.push(path);
    }
    commit_replacements_with(
        root,
        vec![staged_metadata, staged_chapters],
        committed,
        durable_write::StagedWrite::commit,
    )
}

fn commit_replacements_with(
    root: &Path,
    writes: Vec<durable_write::StagedWrite>,
    mut committed: Vec<String>,
    mut replace: impl FnMut(durable_write::StagedWrite) -> Result<(), durable_write::WriteFailure>,
) -> Result<Vec<String>, String> {
    for write in writes {
        let path = write
            .path()
            .strip_prefix(root)
            .map_err(|error| error.to_string())?
            .display()
            .to_string();
        if let Err(error) = replace(write) {
            if error.replaced() {
                committed.push(path.clone());
            }
            return Err(skeleton_failure(&committed, &path, &error.to_string()));
        }
        committed.push(path);
    }
    Ok(committed)
}

fn skeleton_failure(committed: &[String], failed_path: &str, error: &str) -> String {
    format!("skeleton operation incomplete: committed={committed:?}; failedPath={failed_path:?}; {error}")
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
pub fn delete_chapter(
    root: &Path,
    model: &SkeletonModel,
    file: &str,
) -> Result<ProjectInfo, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("invalid project root {}: {e}", root.display()))?;
    let committed = regenerate(&root, model)?;
    let abs = crate::resolve_within_root(&root.display().to_string(), file)?;
    match fs::remove_file(&abs) {
        Ok(()) => {}
        Err(e) if e.kind() == ErrorKind::NotFound => {}
        Err(e) => {
            return Err(skeleton_failure(
                &committed,
                file,
                &format!(
                    "cannot delete {}: {e}; original body preserved",
                    abs.display()
                ),
            ))
        }
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
    if s.is_empty() {
        "untitled-novel".to_string()
    } else {
        s
    }
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
            durable_write::stage(&abs, body.as_bytes())?.commit_new()?;
        }
    }
    Ok(())
}

/// Create a new managed novel under `parent` and return the opened project.
pub fn create_project(
    parent: &Path,
    name: &str,
    metadata: &NovelMetadata,
) -> Result<ProjectInfo, String> {
    let parent = parent
        .canonicalize()
        .map_err(|e| format!("invalid location {}: {e}", parent.display()))?;
    let root = parent.join(folder_slug(name));
    if root.exists() {
        return Err(format!("{} already exists", root.display()));
    }
    fs::create_dir(&root).map_err(|e| format!("cannot create {}: {e}", root.display()))?;

    durable_write::write(&root.join("main.tex"), MAIN_TEX.as_bytes())?;
    scaffold_missing(&root)?;
    durable_write::write(
        &root.join("metadata.tex"),
        render_metadata(metadata).as_bytes(),
    )?;
    durable_write::write(&root.join("chapters.tex"), render_chapters(&[]).as_bytes())?;

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
    project::parse_chapters(&source, &root)?;
    let chapters = project::chapter_pairs(&source);
    let backup = root.join("main.tex.bak");
    match fs::read(&backup) {
        Ok(bytes) if bytes == source.as_bytes() => {}
        Ok(_) => {
            return Err(format!(
                "cannot migrate: backup {} differs from current main file {}; preserve both files before retrying",
                backup.display(),
                main_abs.display()
            ));
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {
            durable_write::stage(&backup, source.as_bytes())?.commit_new()?;
        }
        Err(error) => {
            return Err(format!(
                "cannot read migration backup {}: {error}",
                backup.display()
            ));
        }
    }
    let metadata_text = render_metadata_preserving(&metadata, &source);
    let chapter_text = render_chapter_sources(&chapters);
    let staged = scaffold_missing(&root)
        .and_then(|()| {
            Ok(vec![
                durable_write::stage(&root.join("metadata.tex"), metadata_text.as_bytes())?,
                durable_write::stage(&root.join("chapters.tex"), chapter_text.as_bytes())?,
                durable_write::stage(&main_abs, MAIN_TEX.as_bytes())?,
            ])
        })
        .map_err(|error| {
            format!(
                "cannot prepare migration; backup {} preserved: {error}",
                backup.display()
            )
        })?;
    commit_replacements_with(
        &root,
        staged,
        vec!["main.tex.bak".to_string()],
        durable_write::StagedWrite::commit,
    )?;

    open_managed(&root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires an installed LaTeX toolchain"]
    async fn real_latex_compiles_reserved_metadata_and_chapter_titles() {
        let directory = tempfile::tempdir().unwrap();
        let value = "A {brace} & 50% #1 $2 _x ^y ~z \\emph{literal} \\\ntwo lines";
        let metadata = NovelMetadata {
            title: value.into(),
            subtitle: value.into(),
            author: value.into(),
            publisher: value.into(),
            isbn: value.into(),
        };
        let created = create_project(directory.path(), "Metadata smoke", &metadata).unwrap();
        let root = Path::new(&created.root);
        let model = SkeletonModel {
            metadata,
            chapters: vec![SkeletonChapter {
                title: value.into(),
                file: None,
            }],
        };
        let opened = write_skeleton(root, &model).unwrap();
        assert_eq!(opened.metadata.title, value);
        assert_eq!(opened.chapters[0].title, value);
        fs::write(root.join(&opened.chapters[0].file), "A complete chapter.\n").unwrap();
        let result = crate::compile::compile_project(root, &opened.main_file).await;
        assert!(result.ok, "{}", result.log);
        let pdf = fs::read(crate::compile::pdf_output_path(root, &opened.main_file)).unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
    }

    #[test]
    fn plain_metadata_and_titles_round_trip_reserved_characters_repeatedly() {
        let dir = managed_fixture();
        let value = "A {brace} & 50% #1 $2 _x ^y ~z \\emph{literal} \\\ntwo lines";
        let metadata = NovelMetadata {
            title: value.into(),
            subtitle: value.into(),
            author: value.into(),
            publisher: value.into(),
            isbn: value.into(),
        };
        for _ in 0..3 {
            let model = SkeletonModel {
                metadata: metadata.clone(),
                chapters: vec![SkeletonChapter {
                    title: value.into(),
                    file: Some("content/chapter-001.tex".into()),
                }],
            };
            let opened = write_skeleton(dir.path(), &model).unwrap();
            assert_eq!(opened.metadata.title, value);
            assert_eq!(opened.metadata.subtitle, value);
            assert_eq!(opened.metadata.author, value);
            assert_eq!(opened.metadata.publisher, value);
            assert_eq!(opened.metadata.isbn, value);
            assert_eq!(opened.chapters[0].title, value);
        }
    }

    #[test]
    fn required_managed_files_and_chapter_bodies_do_not_become_empty() {
        for file in ["metadata.tex", "chapters.tex", "content/chapter-001.tex"] {
            let dir = managed_fixture();
            fs::write(dir.path().join(file), [0xff]).unwrap();
            let error = open_managed(dir.path()).unwrap_err();
            assert!(
                error.contains(&file.replace('/', std::path::MAIN_SEPARATOR_STR)),
                "{error}"
            );
            assert_eq!(fs::read(dir.path().join(file)).unwrap(), [0xff]);
        }
        let dir = managed_fixture();
        fs::remove_file(dir.path().join("metadata.tex")).unwrap();
        assert!(detect_and_open(dir.path()).is_err());
    }

    #[test]
    fn malformed_managed_chapters_are_reported_without_replacing_source() {
        for source in [
            "broken data",
            "\\chapter{Unclosed\n\\input{content/chapter-001.tex}\n",
            "\\chapter{Missing input}\n",
        ] {
            let dir = managed_fixture();
            fs::write(dir.path().join("chapters.tex"), source).unwrap();
            assert!(open_managed(dir.path())
                .unwrap_err()
                .contains("chapters.tex"));
            assert_eq!(
                fs::read_to_string(dir.path().join("chapters.tex")).unwrap(),
                source
            );
        }
    }

    #[test]
    fn mixed_valid_and_malformed_chapters_preserve_required_source() {
        for invalid in [
            "\\chapter\t{Unclosed\n\\input{content/chapter-001.tex}\n",
            "\\chapter\t{Missing input}\n",
            "\\chapter*{Unsupported}\n\\input{content/chapter-001.tex}\n",
            "\\chapter[Short]{Unsupported}\n\\input{content/chapter-001.tex}\n",
            "\\chapter\n\\input{content/chapter-001.tex}\n",
            "\\chapterfoo{Unsupported}\n\\input{content/chapter-001.tex}\n",
            "\\chapter{Extra} discarded text\n\\input{content/chapter-001.tex}\n",
            "\\chapter{Extra}\n\\input{content/chapter-001.tex} discarded text\n",
            "\\input{content/chapter-001.tex}\n",
        ] {
            let dir = managed_fixture();
            let source =
                format!("\\chapter{{Valid}}\n\\input{{content/chapter-001.tex}}\n{invalid}");
            fs::write(dir.path().join("chapters.tex"), &source).unwrap();
            let error = open_managed(dir.path()).unwrap_err();
            assert!(error.contains("chapters.tex"), "{error}");
            assert_eq!(
                fs::read_to_string(dir.path().join("chapters.tex")).unwrap(),
                source
            );
        }
    }

    #[test]
    fn managed_chapter_whitespace_and_comments_match_the_parser() {
        let dir = managed_fixture();
        let source = "% heading\n\\providecommand{\\aproproseplain}[1]{#1}\n\n\\chapter\t{Valid} % title\n% body\n\\input\t{content/chapter-001.tex} % file\n";
        fs::write(dir.path().join("chapters.tex"), source).unwrap();
        let project = open_managed(dir.path()).unwrap();
        assert_eq!(project.chapters.len(), 1);
        assert_eq!(project.chapters[0].title, "Valid");
        assert_eq!(project.chapters[0].file, "content/chapter-001.tex");
    }

    #[test]
    fn staging_failure_preserves_all_existing_skeleton_bytes() {
        let dir = managed_fixture();
        let old_metadata = fs::read(dir.path().join("metadata.tex")).unwrap();
        fs::remove_file(dir.path().join("chapters.tex")).unwrap();
        fs::create_dir(dir.path().join("chapters.tex")).unwrap();
        let model = SkeletonModel {
            metadata: meta(),
            chapters: vec![],
        };
        let error = write_skeleton(dir.path(), &model).unwrap_err();
        assert!(error.contains("chapters.tex"), "{error}");
        assert_eq!(
            fs::read(dir.path().join("metadata.tex")).unwrap(),
            old_metadata
        );
    }

    #[test]
    fn malformed_plain_text_markers_fail_instead_of_becoming_legacy_text() {
        let dir = managed_fixture();
        let source = render_metadata(&meta()).replace("Prelude To Darkness", r"broken\unknown{}");
        fs::write(dir.path().join("metadata.tex"), &source).unwrap();
        assert!(open_managed(dir.path())
            .unwrap_err()
            .contains("metadata.tex"));
        assert_eq!(
            fs::read_to_string(dir.path().join("metadata.tex")).unwrap(),
            source
        );
    }

    #[test]
    fn skeleton_partial_commit_identifies_changed_paths_and_preserves_failed_original() {
        let dir = managed_fixture();
        let old_chapters = fs::read(dir.path().join("chapters.tex")).unwrap();
        let writes = vec![
            durable_write::stage(&dir.path().join("metadata.tex"), b"new metadata").unwrap(),
            durable_write::stage(&dir.path().join("chapters.tex"), b"new chapters").unwrap(),
        ];
        let error = commit_replacements_with(dir.path(), writes, vec![], |write| {
            if write.path().ends_with("chapters.tex") {
                return Err(durable_write::WriteFailure::BeforeReplacement {
                    path: write.path().to_path_buf(),
                    source: std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        "injected replacement failure",
                    ),
                });
            }
            write.commit()
        })
        .unwrap_err();
        assert!(error.contains("committed=[\"metadata.tex\"]"), "{error}");
        assert!(error.contains("failedPath=\"chapters.tex\""), "{error}");
        assert_eq!(
            fs::read(dir.path().join("metadata.tex")).unwrap(),
            b"new metadata"
        );
        assert_eq!(
            fs::read(dir.path().join("chapters.tex")).unwrap(),
            old_chapters
        );
    }

    #[test]
    fn migration_and_unchanged_rewrites_preserve_legacy_tex_semantics() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("content")).unwrap();
        fs::write(dir.path().join("content/old.tex"), "body").unwrap();
        let source = "\\documentclass{book}\n\\newcommand{\\booktitle}{A \\emph{legacy} \\& title}\n\\begin{document}\n\\mainmatter\n\\chapter{\\emph{Legacy} \\{chapter\\}}\n\\input{content/old.tex}\n\\end{document}\n";
        fs::write(dir.path().join("main.tex"), source).unwrap();
        let opened = migrate_to_managed(dir.path()).unwrap();
        let model = SkeletonModel {
            metadata: opened.metadata,
            chapters: vec![SkeletonChapter {
                title: opened.chapters[0].title.clone(),
                file: Some("content/old.tex".into()),
            }],
        };
        write_skeleton(dir.path(), &model).unwrap();
        let metadata = fs::read_to_string(dir.path().join("metadata.tex")).unwrap();
        let chapters = fs::read_to_string(dir.path().join("chapters.tex")).unwrap();
        assert!(
            metadata.contains(r"{A \emph{legacy} \& title}"),
            "{metadata}"
        );
        assert!(
            chapters.contains(r"\chapter{\emph{Legacy} \{chapter\}}"),
            "{chapters}"
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("main.tex.bak")).unwrap(),
            source
        );
    }

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
        assert!(out.contains("\\newcommand{\\booktitle}{\\aproproseplain{Prelude To Darkness}}"));
        assert!(out.contains("\\newcommand{\\authorname}{\\aproproseplain{Jarred Parr}}"));
        assert!(out.contains("\\newcommand{\\subtitle}{\\aproproseplain{}}"));
        assert!(out.contains("\\newcommand{\\publisher}{\\aproproseplain{Publisher}}"));
        assert!(out.contains("\\newcommand{\\isbn}{\\aproproseplain{978-3-16-148410-0}}"));
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
            format!("{}\\chapter{{\\aproproseplain{{Terry}}}}\n\\input{{content/chapter-001.tex}}\n\\chapter{{\\aproproseplain{{Party}}}}\n\\input{{content/chapter-002.tex}}\n", tex_text::DEFINITION)
        );
    }

    #[test]
    fn max_index_empty_dir_is_zero() {
        let dir = tempfile::tempdir().unwrap();
        let content = dir.path().join("content");
        fs::create_dir_all(&content).unwrap();
        assert_eq!(max_content_index(&content).unwrap(), 0);
    }

    #[test]
    fn max_index_handles_irregular_legacy_names() {
        let dir = tempfile::tempdir().unwrap();
        let content = dir.path().join("content");
        fs::create_dir_all(&content).unwrap();
        for name in [
            "chapter0.tex",
            "chapter12.tex",
            "chapter13-interlude.tex",
            "notes.txt",
        ] {
            fs::write(content.join(name), "").unwrap();
        }
        assert_eq!(max_content_index(&content).unwrap(), 13);
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

    fn legacy_migration_fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("content")).unwrap();
        fs::write(dir.path().join("content/old.tex"), "Original chapter body.").unwrap();
        fs::write(
            dir.path().join("main.tex"),
            "\\documentclass{book}\n\\newcommand{\\booktitle}{Legacy book}\n\\begin{document}\n\\mainmatter\n\\chapter{One}\n\\input{content/old.tex}\n\\end{document}\n",
        )
        .unwrap();
        dir
    }

    #[test]
    fn migration_retries_after_scaffold_failure_without_replacing_backup() {
        let dir = legacy_migration_fixture();
        let root = dir.path();
        let source = fs::read(root.join("main.tex")).unwrap();
        fs::write(root.join("frontmatter"), "Obstruction").unwrap();
        let error = migrate_to_managed(root).unwrap_err();
        assert_eq!(fs::read(root.join("main.tex")).unwrap(), source);
        assert_eq!(fs::read(root.join("main.tex.bak")).unwrap(), source);
        fs::remove_file(root.join("frontmatter")).unwrap();
        assert_eq!(detect_and_open(root).unwrap().status, "needsMigration");

        let opened = migrate_to_managed(root).unwrap();
        assert!(error.contains("main.tex.bak"), "{error}");
        assert_eq!(opened.chapters[0].file, "content/old.tex");
        assert_eq!(fs::read(root.join("main.tex.bak")).unwrap(), source);
        assert_eq!(
            fs::read(root.join("content/old.tex")).unwrap(),
            b"Original chapter body."
        );
    }

    #[test]
    fn migration_retries_after_staging_failure_with_original_backup() {
        let dir = legacy_migration_fixture();
        let root = dir.path();
        let source = fs::read(root.join("main.tex")).unwrap();
        fs::create_dir(root.join("metadata.tex")).unwrap();
        let error = migrate_to_managed(root).unwrap_err();
        assert!(error.contains("metadata.tex"), "{error}");
        assert_eq!(fs::read(root.join("main.tex")).unwrap(), source);
        assert_eq!(fs::read(root.join("main.tex.bak")).unwrap(), source);
        fs::remove_dir(root.join("metadata.tex")).unwrap();

        let opened = migrate_to_managed(root).unwrap();
        assert!(error.contains("main.tex.bak"), "{error}");
        assert_eq!(opened.metadata.title, "Legacy book");
        assert_eq!(fs::read(root.join("main.tex.bak")).unwrap(), source);
    }

    #[test]
    fn migration_reuses_identical_backup_without_replacing_its_identity() {
        let dir = legacy_migration_fixture();
        let root = dir.path();
        let source = fs::read(root.join("main.tex")).unwrap();
        fs::write(root.join("main.tex.bak"), &source).unwrap();
        fs::hard_link(root.join("main.tex.bak"), root.join("backup-witness")).unwrap();

        migrate_to_managed(root).unwrap();

        assert_eq!(fs::read(root.join("main.tex.bak")).unwrap(), source);
        fs::write(root.join("backup-witness"), "Identity witness").unwrap();
        assert_eq!(
            fs::read(root.join("main.tex.bak")).unwrap(),
            b"Identity witness"
        );
    }

    #[test]
    fn migration_refuses_differing_backup_without_mutating_legacy_files() {
        let dir = legacy_migration_fixture();
        let root = dir.path();
        let source = fs::read(root.join("main.tex")).unwrap();
        fs::write(root.join("main.tex.bak"), "Unrelated backup").unwrap();

        let error = migrate_to_managed(root).unwrap_err();

        assert!(error.contains("main.tex.bak"), "{error}");
        assert_eq!(fs::read(root.join("main.tex")).unwrap(), source);
        assert_eq!(
            fs::read(root.join("main.tex.bak")).unwrap(),
            b"Unrelated backup"
        );
        assert!(!root.join("metadata.tex").exists());
        assert!(!root.join("frontmatter").exists());
    }

    #[test]
    fn migration_reports_unreadable_backup_without_mutating_legacy_files() {
        let dir = legacy_migration_fixture();
        let root = dir.path();
        let source = fs::read(root.join("main.tex")).unwrap();
        fs::create_dir(root.join("main.tex.bak")).unwrap();

        let error = migrate_to_managed(root).unwrap_err();

        assert!(error.contains("cannot read migration backup"), "{error}");
        assert_eq!(fs::read(root.join("main.tex")).unwrap(), source);
        assert!(root.join("main.tex.bak").is_dir());
        assert!(!root.join("metadata.tex").exists());
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
                SkeletonChapter {
                    title: "Terry".into(),
                    file: Some("content/chapter-001.tex".into()),
                },
                SkeletonChapter {
                    title: "Party".into(),
                    file: None,
                },
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
        assert!(ch.contains("\\chapter{\\aproproseplain{Terry}}\n\\input{content/chapter-001.tex}"));
        assert!(ch.contains("\\chapter{\\aproproseplain{Party}}\n\\input{content/chapter-002.tex}"));
    }

    #[test]
    fn delete_chapter_removes_file_and_line() {
        let dir = managed_fixture();
        let root = dir.path();
        // Model with the only chapter removed.
        let model = SkeletonModel {
            metadata: meta(),
            chapters: vec![],
        };
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
    fn migrate_excludes_inline_frontmatter_chapter() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("content")).unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{book}\n\
             \\newcommand{\\booktitle}{Bk}\n\
             \\begin{document}\n\\frontmatter\n\
             \\chapter{Preface}\n\
             \\mainmatter\n\
             \\chapter{One}\n\\input{content/chapter0.tex}\n\\end{document}\n",
        )
        .unwrap();
        fs::write(root.join("content/chapter0.tex"), "a").unwrap();
        let project = migrate_to_managed(root).unwrap();
        // The inline frontmatter \chapter{Preface} (before \mainmatter) is excluded.
        assert_eq!(project.chapters.len(), 1);
        assert_eq!(project.chapters[0].title, "One");
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
        assert!(fs::read_to_string(root.join("main.tex"))
            .unwrap()
            .contains("\\input{chapters}"));
        // A customized options.sty is NOT clobbered.
        assert_eq!(
            fs::read_to_string(root.join("misc/options.sty")).unwrap(),
            "% custom options\n"
        );
    }
}
