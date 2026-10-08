# aproprose workspace operations.
# Run `just` (or `just --list`) to see all recipes.

set shell := ["bash", "-cu"]

# List available recipes.
default:
    @just --list

# Install JS deps and prefetch the Rust crate graph.
setup:
    bun install
    cd src-tauri && cargo fetch

# Start the Vite dev server only (browser, no native shell).
dev:
    bun run dev

# Run the full Tauri desktop app in dev mode (Vite + native window, hot reload).
run:
    bun run tauri dev

# Type-check and build the web bundle (no native packaging).
build:
    bun run build

# Build the production desktop bundle for the current platform.
bundle:
    bun run tauri build

# Build an Arch Linux package from the production binary.
# `tauri build` (not bare `cargo build --release`) is required: tauri's build script
# sets dev = !custom-protocol, so a plain cargo build embeds no frontend and the app
# tries to load devUrl at runtime. --no-bundle skips the deb/appimage we don't need here.
arch-package:
    bun run tauri build --no-bundle
    ./scripts/create-arch-package.sh

# Open a release PR from main: full gate, bump versions, review the changelog, confirm, push the release branch.
version VERSION:
    @just _release "{{VERSION}}" interactive

# Open a release PR non-interactively: auto-accept the AI changelog and skip the confirm prompt.
version-auto VERSION:
    @just _release "{{VERSION}}" auto

# Shared release pipeline behind `version` (MODE=interactive) and `version-auto` (MODE=auto). Not run directly.
_release VERSION MODE:
    #!/usr/bin/env bash
    set -euo pipefail
    ver="{{VERSION}}"
    mode="{{MODE}}"
    # Releases are cut only from a clean, up-to-date main.
    if [ -n "$(git status --porcelain)" ]; then
        echo "error: working tree is not clean - commit or stash first" >&2
        exit 1
    fi
    branch="$(git rev-parse --abbrev-ref HEAD)"
    if [ "$branch" != "main" ]; then
        echo "error: releases are cut from main, but you are on '$branch' - switch to main first" >&2
        exit 1
    fi
    git fetch origin
    if ! git merge --ff-only origin/main; then
        echo "error: local main has diverged from origin/main - reconcile before releasing" >&2
        exit 1
    fi
    if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
        echo "error: local main must match origin/main before preparing a release PR" >&2
        exit 1
    fi
    if ! command -v gh >/dev/null; then
        echo "error: GitHub CLI (gh) is required to open the release PR" >&2
        exit 1
    fi
    gh auth status
    # Full gate - the same checks ci.yml enforces - before release preparation.
    echo "==> typecheck"
    bun x tsc --noEmit
    echo "==> frontend tests"
    bun x vitest run
    echo "==> browser tests"
    just test-browser
    echo "==> build frontend (required for cargo generate_context!)"
    bun run build
    echo "==> rust tests"
    ( cd src-tauri && cargo test )
    echo "==> clippy"
    ( cd src-tauri && cargo clippy --all-targets -- -D warnings )
    release_branch="codex/release-$ver"
    git switch -c "$release_branch"
    # Revert every file this recipe mutates if anything below fails or is interrupted, so an
    # aborted release never leaves a dirty tree (a git checkout of unchanged files is a no-op).
    revert() {
        git checkout -- package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/Cargo.lock changelog.json 2>/dev/null || true
        git switch main
        git branch -d "$release_branch"
    }
    trap revert ERR INT
    # Bump all version files first - set-version.ts rejects a non-increasing version, so this
    # cheap, deterministic check fails before the expensive AI changelog step writes anything.
    echo "==> version"
    bun run scripts/set-version.ts "$ver"
    # Generate the user-facing changelog entry with Pi. Interactive mode reviews it in
    # $EDITOR; auto mode (--yes) accepts the AI draft verbatim. Aborts if Pi is missing,
    # fails, or the entry is invalid.
    echo "==> changelog"
    if [ "$mode" = "auto" ]; then
        bun run scripts/generate-changelog.ts "$ver" "$(date +%F)" --yes
    else
        bun run scripts/generate-changelog.ts "$ver" "$(date +%F)"
    fi
    echo "==> version and changelog gate"
    bun run scripts/check-release.ts origin/main
    # Confirm before pushing the branch and opening its PR (skipped in auto mode).
    if [ "$mode" != "auto" ]; then
        echo
        echo "Open a release PR for v$ver:"
        echo "  commit the version bump and changelog, push $release_branch, and open a PR to main"
        echo "  merging after required CI passes triggers the signed release builds"
        reply=""
        read -r -p "Proceed? [y/N] " reply || true
        if [ "$reply" != "y" ] && [ "$reply" != "Y" ]; then
            echo "aborted - reverting version bump"
            revert
            exit 1
        fi
    fi
    trap - ERR INT
    git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/Cargo.lock changelog.json
    git commit -m "release $ver"
    git push -u origin "$release_branch"
    body_file="$(mktemp)"
    trap 'rm -f "$body_file"' EXIT
    {
        bun run scripts/release-body.ts "$ver"
        printf '\n\nValidation: typecheck, frontend and browser tests, frontend build, Rust tests, Clippy, and version/changelog gate passed locally.\n'
        printf '\nMerge after required GitHub checks pass. The main push builds and publishes the signed desktop release.\n'
    } > "$body_file"
    gh pr create --base main --head "$release_branch" --title "Release v$ver" --body-file "$body_file"
    echo "opened release PR for v$ver - merge after required CI passes"

# Type-check the frontend without emitting.
typecheck:
    bun x tsc --noEmit

# Run the unit tests (frontend Vitest + Rust).
test:
    bun x vitest run
    cd src-tauri && cargo test

# Run layout regressions in Chromium and WebKit (install with `bun x playwright install chromium webkit`).
test-browser:
    bun x playwright test

# Format and lint the Rust side.
fmt:
    cd src-tauri && cargo fmt
    cd src-tauri && cargo clippy

# Remove build artifacts and dependencies.
clean:
    rm -rf dist node_modules
    cd src-tauri && cargo clean
