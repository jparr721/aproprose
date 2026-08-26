# Single-instance Aproprose

## Goal

Prevent duplicate Aproprose processes. A second launch must surface the running main window rather than create an indistinguishable second window.

## Scope

- Add Tauri’s official `tauri-plugin-single-instance` dependency.
- Register the plugin in `src-tauri/src/lib.rs` before normal application setup.
- When another launch is received, resolve the existing `main` webview window, restore it if minimized, show it, and focus it.
- Apply the policy to packaged, terminal, development, and Omarchy-launcher invocations through the shared Rust entrypoint.

## Non-goals

- No Hyprland binding changes.
- No forced termination of existing windows.
- No changes to the unsaved-chapter close guard.
- No argument-forwarding behavior beyond focusing the existing window.

## Error handling

The second-launch callback treats a missing main window or an individual restore/focus failure as non-fatal. The callback must not panic or prevent the original process from continuing.

## Validation

- A desktop smoke test will launch Aproprose twice, verify there is one client window, verify the original window receives focus, then close it with the standard Hyprland dispatcher.
- Build/type checks will confirm the plugin integration.
