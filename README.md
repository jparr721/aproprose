# Aproprose

An AI-native, block-based **LaTeX novel editor** — a calm writing room that reads
your manuscript, helps you draft the next beat, and compiles the real PDF beside
you. A play on *apropos*.

Built as a [Tauri 2](https://tauri.app) desktop app: React 19 + Vite 7 + Tailwind 4
frontend (shadcn-style UI, serif-forward typography) over a Rust backend.

## What it does

- **Block-based authoring.** A chapter is an ordered stream of blocks —
  *narration*, *dialogue* (with a speaker), *scene heading*, *lore note*,
  *scratchpad*, and a *raw LaTeX* escape hatch. You think in beats; the AI knows
  what each section *is*.
- **Your `.tex` files are the source of truth.** Aproprose parses a chapter into
  blocks for guided editing and writes plain LaTeX back. The parser is
  **round-trip safe**: every block remembers its exact source span, so unedited
  content is preserved byte-for-byte and only blocks you actually touch are
  re-serialized. Lore and scratchpad blocks are stored as LaTeX comments, so they
  travel with the file but never render.
- **A real AI assistant** (right panel, powered by the OpenAI model you pick in
  Settings, via the Vercel AI SDK): **Suggest** the next block, **Critique**
  tone/pacing/voice,
  **Brainstorm** in a streaming chat, run **Continuity** checks, and track the
  **Cast** in the scene — all grounded on the prose up to your cursor. The mic
  dictates into a block; "Clean up with AI" fixes transcription errors in context.
- **Real PDF preview.** Compile with `latexmk` and view the actual typeset output
  rendered with pdf.js — page navigation, zoom, recompile.
- **Multi-project.** *File → Open* points Aproprose at any folder with a
  `main.tex`; opening a project wipes all state and loads the new one. Recent
  projects are remembered. Nothing is copied into your repository — the app reads
  and compiles in place, and keeps its own metadata (cast, statuses) in the app
  config dir.
- **Light · Sepia · Dark**, 2-/3-pane and Focus layouts, typographic or card
  blocks, adjustable prose size.

## Install

Download the latest installer from the [Releases page](https://github.com/jparr721/aproprose/releases).

### macOS (Apple Silicon)

The `.dmg` is not notarized (no Apple Developer account yet), so Gatekeeper blocks it
on first launch. Open it once with either method:

- Right-click `aproprose.app` in Applications and choose **Open**, then confirm; or
- Clear the download quarantine from a terminal:

  ```bash
  xattr -dr com.apple.quarantine /Applications/aproprose.app
  ```

After the first open it launches normally. Intel Macs are not supported yet.

### Linux

- **AppImage** (any distro): `chmod +x aproprose_*.AppImage` then run it.
- **Debian / Ubuntu** (`.deb`): `sudo apt install ./aproprose_*.deb`.

## Architecture notes

- **Privileged work lives in Rust** (`src-tauri/src`): project discovery + LaTeX
  preamble/chapter parsing, file IO (path-traversal guarded), `latexmk`
  compilation with log/error parsing, and resolving the OpenAI key (entered in
  Settings, stored in the OS app-config dir). The narrow command surface is
  mirrored, typed, in `src/lib/tauri.ts`.
- **AI** uses the Vercel AI SDK in the frontend, but the API key — entered in
  Settings and stored in the app-config dir — is read in Rust (never bundled into
  JS) and HTTP egress is routed through Tauri's `http` plugin so it isn't subject
  to webview CORS. The model is the one you select in Settings
  (`settings-store.aiModel`), read by `getModel()` in `src/lib/ai/model.ts`.
- **State** is [zustand](https://github.com/pmndrs/zustand): `project-store`
  (open project, blocks, save, compile), `settings-store` (persisted appearance),
  `view-store` (panels + the unsaved-edits guard).
- **The LaTeX engine** is `src/lib/latex` — `parseChapter` / `serializeChapter`
  with reversible inline mapping (`\emph{}` ↔ `_…_`, `` ``…'' `` ↔ `"…"`, dashes).

## Prerequisites

- [bun](https://bun.sh), Rust + Cargo, and [`just`](https://github.com/casey/just).
- A TeX distribution with `latexmk` and the usual book packages. On Arch:
  `sudo pacman -S --needed texlive-binextra texlive-latexextra texlive-fontsrecommended texlive-fontsextra`.
- An OpenAI API key. Set it in the app — **Settings (gear) → OpenAI key** — where
  it is saved to your OS app-config dir, never to this repo.

## Commands

```bash
just run        # full desktop app in dev mode (Vite + native window, hot reload)
just build      # tsc + vite build (web bundle)
just bundle     # production desktop bundle
just typecheck  # tsc --noEmit
just fmt        # cargo fmt + clippy
```

See `CLAUDE.md` for the full project guide and conventions.

## Releasing

A release is one command, cut from `main`:

```bash
just version 0.2.0
```

`just version` will only run from a **clean, up-to-date `main`** (it aborts otherwise
and fast-forwards to `origin/main`). It then runs the full gate (typecheck, frontend
tests, `cargo test`, `clippy -D warnings`), bumps the version across `package.json`,
`src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.lock` (a
non-increasing version is rejected), and - after a `y/N` confirmation - commits, tags
`v0.2.0`, and pushes `main` + the tag. Declining the prompt reverts the bump and
changes nothing.

Pushing the tag triggers `.github/workflows/release.yml`: a guard re-verifies the tag
matches `tauri.conf.json`, is newly created (not an overwrite), and is the newest
version, then macOS and Linux installers build and attach to a **draft** GitHub
Release. Review the draft and publish it.
