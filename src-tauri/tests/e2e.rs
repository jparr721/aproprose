//! End-to-end integration test against the REAL manuscript at
//! `/home/jsp/Projects/prelude`.
//!
//! This exercises the genuine backend pipeline the desktop app drives:
//!   1. `project::open_project` — discover the main file, title/author, chapters.
//!   2. `compile::compile_project` — run the LaTeX toolchain and produce a PDF.
//!   3. the `.env` key-location logic behind the `get_ai_config` command.
//!
//! It is intentionally hard-wired to the on-disk manuscript so a regression in
//! parsing or compilation is caught before the user compiles this exact project.

use std::path::Path;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

const MANUSCRIPT: &str = "/home/jsp/Projects/prelude";

#[test]
fn open_project_parses_the_real_manuscript() {
    let info = aproprose_lib::project::open_project(Path::new(MANUSCRIPT))
        .expect("open_project should succeed on the real manuscript");

    println!(
        "open_project: chapters.len()={} title={:?} author={:?} mainFile={:?}",
        info.chapters.len(),
        info.title,
        info.author,
        info.main_file
    );

    assert_eq!(
        info.chapters.len(),
        17,
        "expected 17 chapters, got {}",
        info.chapters.len()
    );
    assert_eq!(
        info.title.as_deref(),
        Some("Prelude To Darkness"),
        "unexpected title: {:?}",
        info.title
    );
    assert_eq!(
        info.author.as_deref(),
        Some("Jarred Parr"),
        "unexpected author: {:?}",
        info.author
    );
    assert_eq!(
        info.main_file, "main.tex",
        "unexpected main file: {}",
        info.main_file
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn compile_project_produces_a_pdf() {
    let root = Path::new(MANUSCRIPT)
        .canonicalize()
        .expect("manuscript root must canonicalize");

    let result = aproprose_lib::compile::compile_project(&root, "main.tex").await;

    let pdf_len = result.pdf_base64.as_ref().map(|b64| {
        BASE64
            .decode(b64)
            .expect("pdf_base64 must be valid base64")
            .len()
    });

    println!(
        "compile_project: ok={} durationMs={} pdfBytes={:?} errors={}",
        result.ok,
        result.duration_ms,
        pdf_len,
        result.errors.len()
    );
    if !result.errors.is_empty() {
        for e in &result.errors {
            println!(
                "  error: file={:?} line={:?} msg={}",
                e.file, e.line, e.message
            );
        }
        // Show a tail of the log to aid debugging if the assertions below fail.
        let tail: String = result
            .log
            .lines()
            .rev()
            .take(40)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        println!("--- log tail ---\n{tail}\n--- end log tail ---");
    }

    assert!(result.ok, "compile result.ok must be true");

    let bytes = pdf_len.expect("pdf_base64 must be Some");
    assert!(
        bytes > 100_000,
        "decoded PDF must be > 100000 bytes, got {bytes}"
    );

    assert!(
        result.errors.is_empty(),
        "expected no compile errors, got {}",
        result.errors.len()
    );
}

#[test]
fn ai_config_finds_a_non_empty_key() {
    // Replicate get_ai_config's resolution: direct env wins, else the .env walk.
    let key = std::env::var("OPENAI_API_KEY")
        .ok()
        .filter(|k| !k.trim().is_empty())
        .or_else(|| aproprose_lib::load_env_key("OPENAI_API_KEY"));

    let key = key.expect("OPENAI_API_KEY must be found in env or a .env file");
    assert!(
        !key.trim().is_empty(),
        "resolved OPENAI_API_KEY must be non-empty"
    );

    // Print ONLY the length, NEVER the value.
    println!("get_ai_config: OPENAI_API_KEY length={}", key.len());
}
