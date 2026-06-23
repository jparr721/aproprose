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

# Type-check the frontend without emitting.
typecheck:
    bun x tsc --noEmit

# Run the frontend unit tests (Bun's built-in runner).
test:
    bun test

# Format and lint the Rust side.
fmt:
    cd src-tauri && cargo fmt
    cd src-tauri && cargo clippy

# Remove build artifacts and dependencies.
clean:
    rm -rf dist node_modules
    cd src-tauri && cargo clean
