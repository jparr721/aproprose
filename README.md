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
- **A real AI assistant** (right panel, powered by the OpenAI or OpenRouter model
  you pick in Settings, via the Vercel AI SDK): **Suggest** the next block, **Critique**
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

- Install with the shell helper, which copies the app to `/Applications` and clears
  the download quarantine:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/jparr721/aproprose/main/install-macos.sh | sh
  ```

- Right-click `aproprose.app` in Applications and choose **Open**, then confirm; or
- Clear the download quarantine from a terminal:

  ```bash
  xattr -dr com.apple.quarantine /Applications/aproprose.app
  ```

After the first open it launches normally. A drag-copy `.dmg` cannot reliably clear
quarantine for itself; the real fix is Developer ID signing and notarization. The
shell helper works around it by doing the copy and `xattr` cleanup after download.
Intel Macs are not supported yet.

### Windows

Download the Windows `setup.exe` from the Releases page and run it. The installer is
not Authenticode-signed yet, so Microsoft Defender SmartScreen may show **Windows
protected your PC** for early releases. Choose **More info** → **Run anyway** only if
you downloaded it from `github.com/jparr721/aproprose`. Some managed/enterprise
Windows machines block unsigned or unknown-reputation apps entirely; fixing that
requires Windows code signing or Microsoft Store distribution.

### Linux

- **AppImage** (any distro): `chmod +x aproprose_*.AppImage` then run it.
- **Debian / Ubuntu** (`.deb`): `sudo apt install ./aproprose_*.deb`.
- **Arch Linux** (`.pkg.tar.zst`): download the Arch package from the release and run
  `sudo pacman -U ./aproprose-*.pkg.tar.zst`. This installs Aproprose into your app
  launcher with its icon; remove it later with `sudo pacman -Rns aproprose`.

## Architecture notes

- **Privileged work lives in Rust** (`src-tauri/src`): project discovery + LaTeX
  preamble/chapter parsing, file IO (path-traversal guarded), `latexmk`
  compilation with log/error parsing, and resolving provider API keys (entered
  in Settings, stored in the OS app-config dir). The narrow command surface is
  mirrored, typed, in `src/lib/tauri.ts`.
- **AI** uses the Vercel AI SDK in the frontend, but each provider API key entered
  in Settings and stored in the app-config dir is read in Rust (never bundled into
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
- An OpenAI or OpenRouter API key. Select the provider and set its key under
  **Settings (gear) -> AI**. It is saved to your OS app-config dir, never to this
  repo.

## Commands

```bash
just run        # full desktop app in dev mode (Vite + native window, hot reload)
just build      # tsc + vite build (web bundle)
just bundle     # production desktop bundle
just arch-package # build a native Arch Linux package
just typecheck  # tsc --noEmit
just fmt        # cargo fmt + clippy
```

See `CLAUDE.md` for the full project guide and conventions.

## Releasing

Every PR must increase the version and add a new first entry to `changelog.json`,
including documentation and CI changes. Keep `package.json`, `src-tauri/Cargo.toml`,
`src-tauri/tauri.conf.json`, and the `aproprose` package in `src-tauri/Cargo.lock`
synchronized. The changelog entry requires a valid `YYYY-MM-DD` date, a nonempty
summary, and nonempty highlights. Prepare these on your work branch with
`bun run scripts/set-version.ts X.Y.Z`, then add the changelog entry.

The `version + changelog` CI check compares against the current target branch.
PR branches must be up to date and pass that check, `typecheck + tests`, and
`cargo test + clippy` before merging. Each passing push to `main` builds a release
from that exact commit, creates its version tag, and uses its changelog as release
notes. Pushing a tag alone does not start a release.

To prepare a separate release PR from `main`:

```bash
just version 0.18.1
```

`just version` will only run from a **clean, up-to-date `main`** (it aborts otherwise
and fast-forwards to `origin/main`). It runs the full gate, creates
`codex/release-0.18.1`, bumps all four versions, generates a changelog for review,
and validates the release policy. After confirmation it commits, pushes the work
branch, and opens a PR through the GitHub CLI. Declining restores `main` and the
original files. `just version-auto` accepts the changelog draft and opens the PR
without the interactive prompts. Both require authenticated `gh` and the changelog
generator's AI CLI.

After successful main CI, `.github/workflows/release.yml` builds signed macOS,
Linux, and Windows installers plus the Arch Linux package into a **draft** GitHub
Release. Platform uploads run serially to preserve the shared updater manifest.
The workflow verifies all signed updater platforms, version-pinned URLs, and exact
changelog notes before publishing. An interrupted draft can resume only for the
same version and commit; published releases cannot be overwritten.
