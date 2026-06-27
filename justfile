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

# Cut a release from main: full gate, bump all version files, commit, tag, push (X.Y.Z, must increase).
version VERSION:
    #!/usr/bin/env bash
    set -euo pipefail
    ver="{{VERSION}}"
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
    # Full gate - the same checks ci.yml enforces - before anything is tagged.
    echo "==> typecheck"
    bun x tsc --noEmit
    echo "==> frontend tests"
    bun x vitest run
    echo "==> build frontend (required for cargo generate_context!)"
    bun run build
    echo "==> rust tests"
    ( cd src-tauri && cargo test )
    echo "==> clippy"
    ( cd src-tauri && cargo clippy --all-targets -- -D warnings )
    # Generate the user-facing changelog entry (claude -p), reviewed in $EDITOR.
    # Aborts the release if claude is missing/errors or returns an invalid entry.
    echo "==> changelog"
    bun run scripts/generate-changelog.ts "$ver" "$(date +%F)"
    # Bump all version files (set-version.ts rejects a non-increasing version).
    bun run scripts/set-version.ts "$ver"
    # Confirm before the irreversible push that triggers the release.
    echo
    echo "Release v$ver to origin/main:"
    echo "  commit the version bump, tag v$ver, push main + tag (triggers the release build)"
    reply=""
    read -r -p "Proceed? [y/N] " reply || true
    if [ "$reply" != "y" ] && [ "$reply" != "Y" ]; then
        echo "aborted - reverting version bump"
        git checkout -- package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/Cargo.lock changelog.json
        exit 1
    fi
    git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/Cargo.lock changelog.json
    git commit -m "release $ver"
    git tag "v$ver"
    git push origin main "v$ver"
    echo "released v$ver - watch the release workflow on GitHub"

# Type-check the frontend without emitting.
typecheck:
    bun x tsc --noEmit

# Run the unit tests (frontend Vitest + Rust).
test:
    bun x vitest run
    cd src-tauri && cargo test

# Format and lint the Rust side.
fmt:
    cd src-tauri && cargo fmt
    cd src-tauri && cargo clippy

# Remove build artifacts and dependencies.
clean:
    rm -rf dist node_modules
    cd src-tauri && cargo clean
