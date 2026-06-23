# aproprose - Project Guide for Claude

A Tauri 2 desktop app with a React 19 + Vite 7 + Tailwind 4 frontend and a Rust backend. shadcn-style UI, serif-forward typography.

## Layout

- `src/` - React frontend (Vite). Entry `src/main.tsx` -> `src/App.tsx`.
  - `src/components/ui/` - shadcn-style primitives (`button`, `input`, `card`, `sidebar`, `typography`, …).
  - `src/components/app/` - app components. Shell: `app-sidebar` (left nav + project switcher), `top-bar` (doubles as the custom titlebar), `window-controls`. `src/lib/platform.ts` exposes `IS_MAC`.
  - `src/lib/utils.ts` - `cn()` (clsx + tailwind-merge). The only class-merging helper.
  - `src/index.css` - Tailwind entry, theme tokens (colors, radius, fonts), base layer.
- `src-tauri/` - Rust backend. `src/lib.rs` registers commands + plugins; `src/main.rs` is the thin binary entry.
  - `tauri.conf.json` - app config (window, bundle, `devUrl: http://localhost:1420`, `beforeDevCommand: bun run dev`).
  - `capabilities/default.json` - permission grants for the webview.
- `index.html` - Vite HTML shell.

Bun is the runtime and package manager. The frontend talks to Rust over Tauri's `invoke` bridge (`@tauri-apps/api/core`); there is no separate HTTP server.

## Commands

**The `justfile` at the repo root is the single source of truth for running the app - prefer `just <recipe>` over raw `bun`/`cargo` commands for anything it covers.** Run `just` with no args to list recipes. (Requires [`just`](https://github.com/casey/just); install with `cargo install just` or your package manager.)

```bash
just              # list recipes
just setup        # bun install + cargo fetch
just dev          # Vite dev server only (browser preview, no native window)
just run          # full Tauri desktop app in dev mode (Vite + native window, hot reload)
just build        # tsc + vite build (web bundle only, no packaging)
just bundle       # production desktop bundle for the current platform
just typecheck    # tsc --noEmit
just fmt          # cargo fmt + cargo clippy (Rust side)
just clean        # remove dist, node_modules, and Rust target
```

For day-to-day work use `just run` - it boots Vite and the native shell together with hot reload. Use `just dev` only when you want to iterate on pure-frontend changes in a browser without the native window.

## Frontend Conventions

### Typography components

Use the typography components in `@/components/ui/typography`. **Never use raw `<h1>`-`<h4>`, `<p>`, `<small>`, `<code>` with ad-hoc text classes** - the components own the type scale and font assignments so headings stay consistent.

| Component | Use For |
|-----------|---------|
| `TypographyH1` | Page titles |
| `TypographyH2` | Section headers |
| `TypographyH3` | Subsection headers |
| `TypographyH4` | Small headers |
| `TypographyP` | Paragraphs |
| `TypographyLead` | Lead/intro text |
| `TypographyLarge` | Large emphasized text |
| `TypographySmall` | Small labels |
| `TypographyMuted` | Muted/secondary text |
| `TypographyMutedSpan` / `TypographyForeground` | Inline muted / foreground spans |
| `TypographyEyebrow` | Uppercase kicker labels above headings |
| `TypographyBlockquote` | Pull quotes |
| `TypographyInlineCode` | Inline code |
| `TypographyStat` | Numeric stats (tabular figures) |

All accept `className` for additional styling (merged via `cn`).

**Fonts** are defined as theme tokens in `src/index.css` and referenced only through Tailwind utilities - never hard-code a `font-family`:

- `font-heading` -> Lora (display/headings). Used by `TypographyH1`-`H4` and `TypographyStat`.
- `font-serif` -> Noto Serif (body). Applied to `html` in the base layer, so paragraphs inherit it.
- `font-mono` -> system monospace (Tailwind default). Used by `TypographyEyebrow` and `TypographyInlineCode`.
- `font-sans` -> system UI sans. Dense chrome (top bar, sidebar, panels, dialogs) opts into it; body text stays serif. (Renamed from the former `font-ui`.)

To adjust the type system, edit the token in the `@theme inline` block of `src/index.css` and/or the shared classes in `typography.tsx` - not call sites.

### Theming & tokens

All color flows through shadcn **semantic tokens** - `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-card`, `bg-sidebar`, and the status trio `bg-success` / `bg-warning` / `bg-destructive` (each with a `-foreground`). Never hard-code a color or use an ad-hoc `text-[Npx]` in a component; use a token + the type scale.

The palette is a **named warm-paper ramp** (`--paper-*`, `--ink-*`, `--line-*`, `--clay-*`) in `src/index.css`. The semantic mapping (`--background: var(--paper-100)`, …) is declared **once** in `:root`; each theme block (`[data-theme="sepia"]`, `.dark`) overrides only the ramp values. To retune a theme, edit its ramp - not the call sites, not the mapping.

A few **app tokens are retained** because shadcn has no equivalent - keep using them, don't reinvent: `--faint` (tertiary text), `--accent-ink` (clay emphasis ink), the block-type tints `--ai-*` / `--lore-*` / `--scratch-*`, the PDF `--sheet` / `--sheet-ink`, and `--prose-size`. Everything else folds onto shadcn semantics.

### Text truncation

Never truncate text in JS. Use Tailwind utilities so truncation adapts to container width and font.

| Class | Use For |
|-------|---------|
| `truncate` | Single-line, block elements |
| `line-clamp-1` | Single-line, inline content |
| `line-clamp-2`, `line-clamp-3` | Multi-line with ellipsis |

Constrain width on the element or its parent (`min-w-0` on flex children) so truncation actually triggers.

### Loading & async state

**Never use an ellipsis (`…` or `...`) to signal a loading / in-progress ("loadable") state** — no "Opening…", "Compiling…", "Saving…". Use the `Spinner` component (`@/components/ui/spinner`): drop the trailing ellipsis and render `<Spinner />` (optionally beside a plain-text label like "Opening"). Async toasts use `toast.loading("Cleaning up with AI")` — the loading toast already shows a spinner, so no ellipsis there either. **Don't hand-roll a spinner** with `IconLoader`/`IconLoader2` + `animate-spin`; reach for `Spinner`.

Ellipses remain correct for **non-loading** affordances: a menu item that opens a dialog (`Open project…`), input placeholders, and text truncation.

### Component primitives

- Prefer stock shadcn/ui primitives composed with Tailwind over bespoke components. Add new ones with `bunx shadcn@latest add <component>` (config in `components.json`: style `radix-mira`, base color `olive`, icons `tabler`).
- **No inline `style={{...}}`.** Style with Tailwind utility classes; reach for theme tokens (`bg-background`, `text-muted-foreground`, etc.) rather than literal colors. Dynamic one-off values that genuinely can't be a class go through a CSS variable, not an inline style object.
- Merge conditional classes with `cn` from `@/lib/utils` - never string-concatenate `className`.
- Reuse before you write: if a primitive almost fits, extend it via `className`/variants (`class-variance-authority`) rather than forking a near-duplicate.
- Icons come from `@tabler/icons-react`.
- Use `AlertDialog` for user confirmations - never `window.confirm()`. Apply `variant="destructive"` to the action for destructive ops.

### Required data handling

Trust the type system. Don't mask bugs with defaults.

- Don't use optional chaining (`?.`) on fields the types declare required. Let it crash so the bug surfaces.
- Don't provide fallback defaults (`name ?? "Unknown"`) for required display data - they hide data-integrity bugs.

### State management

- Component-local state: `useState` / `useReducer`.
- For state shared across unrelated components or persisted across reloads, add **`zustand`** (one store per concern, `<concern>-store.ts`, a single exported hook). Don't build a Context + `useState` provider tree for read-and-write app state, and don't reach for Redux/Jotai.
- React Context is only for static or rarely-changing scope (theme, identity). The moment two unrelated components must read **and** write the same value, it's a store.
- Not for a store: form input state (`useState`/form lib) and server/cache data.

### Keyboard shortcuts

Shortcuts go through the **keybinding registry**, not ad-hoc `window` keydown listeners. Every shortcut is one typed entry in `src/lib/keybindings.ts` (`KEYBINDINGS`), and the component that owns the action binds it with `useKeybinding(KEYBINDING_IDS.X, cb)` (or `useKeybindingWithOptions` for a per-binding `ignoreEventWhen` guard) from `@/hooks/use-keybinding` - **co-located** with the action, not centralized. `modifiers.ctrl` means the platform command key (Cmd on macOS, Ctrl elsewhere). Render an on-screen hint with `formatKeybinding(KEYBINDINGS.X, IS_MAC)` inside a `Kbd`. Focus policy lives in the hook (chords fire through form inputs; `[data-capture-keyboard]` / `isInAuxSurface` opt subtrees out) - don't reimplement it at call sites. The built-in sidebar ⌘B is the one exception (owned by `SidebarProvider`).

## Tauri (Rust) Conventions

- **Frontend <-> Rust goes through commands.** Define `#[tauri::command]` functions in `src-tauri/src/lib.rs`, register them in the `invoke_handler![...]` list, and call them from the frontend via `invoke("command_name", { args })` from `@tauri-apps/api/core`. Keep `main.rs` a thin entry that calls `run()`.
- **Permissions are explicit.** Any capability the webview needs (fs, shell, opener, etc.) must be granted in `src-tauri/capabilities/default.json`. If a plugin call fails silently in the webview, check the capability grant first.
- Keep heavy/privileged work (filesystem, network to third-party APIs, secrets) on the Rust side and expose a narrow command surface. The webview is untrusted UI.
- Secrets (the `OPENAI_API_KEY`) must not be bundled into the frontend. The key is entered in the in-app Settings and stored in the OS app-config dir on the Rust side (`set_openai_key`; resolved by `get_ai_config` with optional `OPENAI_API_KEY` env / `.env` dev fallbacks). It is read in Rust and exposed only as the resolved value through a command - never inlined into `src/` code shipped to the webview, and never committed (`.env` is gitignored).

## Window shell & custom titlebar

- The app shell is `SidebarProvider` -> `AppSidebar` (left, `collapsible="offcanvas"`) + `SidebarInset` (top bar + editor/PDF/AI). The sidebar toggles via its `SidebarTrigger` or ⌘B (built into `SidebarProvider`) and is **independent of focus mode**. Project switching lives in the **sidebar header** - click the project name.
- The window is **frameless** (`decorations: false`); the `top-bar` `<header>` is the titlebar via `data-tauri-drag-region` (on the header and the flex spacer). Windows/Linux render custom min/max/close from `window-controls` (`getCurrentWindow()`); macOS keeps native traffic lights via `titleBarStyle: "Overlay"` in `tauri.macos.conf.json` plus a `pl-20` inset. Branch on `IS_MAC` from `@/lib/platform`.
- Window grants in `capabilities/default.json`: `os:default` and the `core:window:allow-*` set (start-dragging, minimize, maximize, unmaximize, toggle-maximize, internal-toggle-maximize, is-maximized, close). Platform config merges via JSON Merge Patch (arrays replace wholesale), so `tauri.macos.conf.json` repeats the full window object.

## Library use

**Defer to the dependencies already in `package.json`. Don't hand-roll what a library does, and justify any new dependency** (gap, why existing deps don't fit, maintenance/security profile).

| Domain | Library |
|--------|---------|
| Class merging | `cn` (clsx + tailwind-merge) from `@/lib/utils`. Never concatenate classes by hand. |
| Component variants | `class-variance-authority`. |
| UI primitives | `radix-ui` via shadcn-style wrappers in `src/components/ui/`. |
| Icons | `@tabler/icons-react`. |
| Styling | Tailwind 4 utilities + theme tokens in `src/index.css`. No inline styles, no separate CSS modules. |
| Native bridge | `@tauri-apps/api` (commands, events) + Tauri plugins (`@tauri-apps/plugin-opener`). |
| Keyboard shortcuts | `react-hotkeys-hook` via the registry in `src/lib/keybindings.ts` + `useKeybinding`. No raw `window` keydown listeners. |

AI inference goes through the Vercel AI SDK (`ai` + `@ai-sdk/openai`), not hand-rolled `fetch`. The `OPENAI_API_KEY` is entered in Settings and resolved on the Rust side (`get_ai_config`) per the Tauri secrets rule above; HTTP egress is routed through the Tauri `http` plugin to dodge webview CORS.

## Quality bar

- TypeScript is `strict` with `noUnusedLocals` / `noUnusedParameters` - keep `just typecheck` green.
- Prefer small, reusable components over large monolithic ones; lift shared markup into `src/components/`.
- Match the surrounding code's style (imports via the `@/` alias, named exports for primitives, function components).
