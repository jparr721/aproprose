# Design: shadcn Sidebar + maximal theme/component consolidation

Date: 2026-06-22
Status: Approved pending user review

## Context

The left navigation is a hand-rolled `Rail` (`src/components/app/rail.tsx`): a custom
`<aside>` with a hardcoded `w-56` wrapper in `App.tsx`, raw `<button>` chapter rows,
and bespoke utility classes (`bg-sidebar`, `border-line-soft`, `text-mid`, `text-faint`,
`bg-sunk`, arbitrary `text-[12.5px]`/`text-[13px]`). It cannot collapse.

More broadly, the app runs **two parallel styling systems**: shadcn's semantic tokens
*and* a custom set (`--rail`, `--sunk`, `--mid`, `--faint`, `--line-soft/strong`,
`--accent-ink`, `--paper`, `--ok/--warn/--flag`) plus widespread ad-hoc classes
(`text-[Npx]`, inline `oklch()`, `font-ui` on ~50 call sites, raw `<button>`/`<input>`).
This duplication makes the UI hard to retune and inconsistent.

The user has since installed the **full shadcn component set**, so `ui/sidebar.tsx`
(706 lines) is already present — Phase 1 is *wiring it up*, not installing it.

## Goals

1. Replace the custom `Rail` with the shadcn `Sidebar` (offcanvas-collapsible).
2. Maximally consolidate the custom token/styling system onto shadcn's canonical one,
   so visual elements use components and theming flows through semantic tokens — making
   the UI consistent and maintainable.
3. Remove the native OS titlebar and promote the app's own top bar into the titlebar
   (frameless window), platform-adaptive so each OS feels native.

## Non-goals

- Converting the AI panel or PDF pane to sidebars — they remain `react-resizable-panels`
  content surfaces. (Scope: **left nav only**.)
- Changing the serif-forward aesthetic. aproprose stays serif (Lora/Noto Serif); we do
  **not** adopt warlock's sans fonts.
- Touching stock `src/components/ui/*` primitives — they are already canonical shadcn.
- A visual redesign. The palette stays warm paper; we restructure *how* it's expressed,
  preserving the look where it reads as intentional.

## Decisions (locked with the user)

| Decision | Choice |
|---|---|
| Token strategy | **Maximal** — collapse custom tokens onto shadcn's; keep only the irreducible |
| Sidebar collapse | **Offcanvas** (slides fully away), ⌘B toggle |
| Scope | **Left nav only**; AI/PDF stay resizable panels; focus mode preserved |
| Palette form | **Named warm-paper ramp** mapped onto semantic tokens (warlock-style) |
| Phase 3 execution | **Parallel Workflow sweep** (one agent per app component) |
| Typography | Already aligned with warlock's `packages/ui` — **no copy needed**; keep `font-heading` (serif) |
| Titlebar | **Custom, platform-adaptive** — top bar becomes the titlebar |
| Window controls | macOS: native traffic lights via `titleBarStyle: Overlay` + inset. Windows/Linux: `decorations:false` + custom min/max/close buttons |

## Reference model: warlock `packages/ui/globals.css`

The canonical *shape* we converge on (not its fonts/hues):

- A **named color ramp** (warlock: `--bone-*`/`--taupe-*`/`--char-*`) declared once, with
  semantic tokens (`--background`, `--card`, `--muted`, ...) mapped onto ramp steps.
- A **status token family**: `--success / --warning / --destructive / --info / --pending`,
  each with a `-foreground` pair.
- `--shadow-*` and `--tracking-*` scales; the `SidebarProvider` / `SidebarInset` layout.

aproprose's `typography.tsx` already matches warlock's `packages/ui` typography component
verbatim except the heading font token (`font-heading` vs `font-display`). Nothing to port.

## Architecture

### Shell layout (after Phase 1)

```
<SidebarProvider>           // owns open state + ⌘B
  <AppSidebar/>             // left, collapsible="offcanvas"
  <SidebarInset>            // editor / PDF / AI region (existing resizable split)
    <TopBar/> with <SidebarTrigger/>
    <Workspace/>
  </SidebarInset>
</SidebarProvider>
```

Focus mode collapses the sidebar via `setOpen(false)` rather than conditionally
unmounting the tree.

### `AppSidebar` composition (replaces `rail.tsx`)

- `SidebarHeader` → project name.
- `SidebarContent` → three `SidebarGroup`s:
  - **Chapters**: `SidebarMenu` of `SidebarMenuButton isActive={…}` rows; each shows the
    chapter label (italic), title (truncated), and a status dot (status token color).
  - **Characters**: `SidebarGroupLabel` "Characters" + `SidebarGroupAction` (+) opening the
    existing `AddCharacterDialog`; `SidebarMenu` of members with `ColorDot`.
  - **Lore**: same pattern with `AddLoreDialog`.
- Add dialogs are reused unchanged (only their trigger moves to `SidebarGroupAction`).
- All color comes from `--sidebar-*` tokens — no hand-styled `bg-sidebar`/`text-mid`.

### Custom titlebar (platform-adaptive)

Config is split with platform-specific files (Tauri merges them via JSON Merge Patch /
RFC 7396 — note **arrays are replaced wholesale**, so each platform file repeats the full
window object):

- `tauri.conf.json` (base, used by Windows/Linux): window `"decorations": false`.
- `tauri.macos.conf.json`: repeats the window object with `"decorations": true`,
  `"titleBarStyle": "Overlay"`, `"hiddenTitle": true`, and `trafficLightPosition` to
  vertically center the lights in the ~44px bar.

`top-bar.tsx` (`<header>`) gets `data-tauri-drag-region` so the whole bar drags the window
and double-click maximizes. Interactive children (brand menu, toggles, Compile) keep
working because drag only fires from the attributed element's empty areas.

A new `src/components/app/window-controls.tsx` renders custom min/max/close buttons
(`@tabler/icons-react`: `IconMinus`, `IconSquare`/`IconCopy` for restore, `IconX`) driven
by `getCurrentWindow()` from `@tauri-apps/api/window` (`minimize()` / `toggleMaximize()` /
`close()`, tracking `isMaximized()`). It renders **only on Windows/Linux**
(`import { platform } from "@tauri-apps/plugin-os"` or a build-time check), since macOS uses
native traffic lights. On macOS the top bar gets a left inset (`pl-20`) so its content
clears the traffic lights.

Capabilities (`capabilities/default.json`) add the window permissions:
`core:window:allow-start-dragging`, `allow-minimize`, `allow-maximize`, `allow-unmaximize`,
`allow-toggle-maximize`, `allow-internal-toggle-maximize` (drag-region double-click),
`allow-is-maximized`, `allow-close`.

## Phases

### Phase 1 — Sidebar swap (self-contained, ships alone)

1. Create `src/components/app/app-sidebar.tsx` from `ui/sidebar` primitives (above).
2. Wrap shell in `App.tsx` with `SidebarProvider` + `SidebarInset`; delete `w-56` wrapper.
3. Add `SidebarTrigger` to `top-bar.tsx`; rely on the provider's built-in ⌘B.
4. Focus mode → `setOpen(false)` integration.
5. Delete `rail.tsx`.
6. Verify: `just typecheck` green; `just run` visual check (open/collapse, chapter select,
   add character/lore, focus mode).

### Phase 2 — Custom titlebar (frameless window)

1. `src-tauri/tauri.conf.json`: set window `"decorations": false`.
2. `src-tauri/tauri.macos.conf.json` (new): repeat the full window object with
   `"decorations": true`, `"titleBarStyle": "Overlay"`, `"hiddenTitle": true`, and
   `trafficLightPosition`.
3. `src-tauri/capabilities/default.json`: add the `core:window:*` permissions listed above.
4. `src/components/app/top-bar.tsx`: add `data-tauri-drag-region` to the `<header>`; on
   macOS add a left inset for the traffic lights.
5. `src/components/app/window-controls.tsx` (new): custom min/max/close buttons via
   `getCurrentWindow()`, rendered only on Windows/Linux; mount at the right end of the top bar.
6. Verify: `just run`; drag the bar, double-click to maximize, click each control; confirm
   on Linux the buttons work and on macOS (if available) traffic lights show and content
   clears them. `just typecheck` green.

### Phase 3 — Theme consolidation (`src/index.css`) — before Phase 4

Introduce a named warm-paper ramp and map semantic tokens onto it, deleting the parallel
custom tokens.

Folding map:

| Custom token | Folds into |
|---|---|
| `--rail` | `--sidebar` |
| `--sunk` | `--muted` (surfaces) / `--accent` (hover) |
| `--mid` | `--muted-foreground` |
| `--faint` | `--muted-foreground` at reduced opacity |
| `--line-soft` / `--line-strong` | `--border` |
| `--accent-ink` | `--primary` (accent text/ring) |
| `--paper` | `--card` (editor surface) |
| `--ok` / `--warn` / `--flag` | `--success` / `--warning` / `--destructive` (the three states actually used; `--info`/`--pending` deferred per YAGNI) |

Ramp sketch (light; sepia + dark mirror it):

```css
:root {
  --paper-50:  oklch(.985 .004 80);  --paper-100: oklch(.965 .006 80);
  --paper-200: oklch(.935 .008 78);  --line-200:  oklch(.90 .006 60);
  --ink-500:   oklch(.62 .01 60);    --ink-700: oklch(.45 .012 60);
  --ink-900:   oklch(.26 .015 60);   --clay-500: oklch(.56 .10 45);

  --background: var(--paper-100);  --card: var(--paper-50);
  --muted: var(--paper-200);       --muted-foreground: var(--ink-700);
  --primary: var(--ink-900);       --border: var(--line-200);
  --ring: var(--clay-500);         /* sidebar/status tokens likewise mapped */
}
```

Also add `--shadow-*` / `--tracking-*` scales (warlock-style) and rename `--font-ui` →
`--font-sans` for canonicality (keep `--font-heading`/`--font-serif`/`--font-mono`).
Remove dead `@theme inline` entries for deleted tokens.

**Kept (irreducible) — with an explanatory comment each:**
- Block-type tints: `--ai-{tint,edge,ink}`, `--lore-*`, `--scratch-*` (distinct editor block types).
- PDF sheet: `--sheet`, `--sheet-ink` (a literal paper sheet that does not follow surface theming).
- `--prose-size` (editor reader control).

### Phase 4 — Component sweep (`src/components/app/*`) via parallel Workflow

One agent per app component: audit → rewrite to tokens/components → `just typecheck`.
Targets (offenders first): `ai-panel` (22 ad-hoc classes, raw button, font-ui×23),
`block` (13, raw input), `top-bar`, `window-controls`, `app-sidebar`, `welcome` (raw button),
`pdf-pane`, `editor`, `inline`, `auto-textarea`, `settings-sheet`, `color-dot`.

Rewrite rules:
- Raw `<button>` → `Button`; raw `<input>` → `Input` (or `InputGroup` for icon inputs).
- `BuildBadge` → `Badge` with a status variant; top-bar panel toggles → `Toggle`.
- `text-mid/faint`, `border-line-soft`, `bg-sunk`, `text-[Npx]` → semantic tokens + type scale.
- Consolidate `font-ui` to container roots, not per-element.

**Left intact:** `color-dot`'s `--dot` inline CSS var (sanctioned dynamic value),
`CHARACTER_COLORS` (user-pickable data, not theme), and all `ui/*` primitives.

### Phase 5 — `CLAUDE.md`

Document the consolidated system: the status token family, the
`SidebarProvider`/`SidebarInset` layout rule, `InputGroup` for icon inputs, the custom
titlebar pattern (drag region + platform-adaptive controls), and an explicit "these custom
tokens remain and why" note to prevent re-sprawl.

## Verification

- `just typecheck` green after every phase (TS is strict with `noUnusedLocals`).
- `just run` visual smoke after Phases 1, 2, and 4: sidebar open/collapse + ⌘B, chapter
  switching with unsaved-guard, add character/lore, focus mode, all three themes
  (light/sepia/dark), build badge states, AI/PDF panels, window drag + min/max/close.
- Grep gate after Phase 4: no remaining `text-mid|text-faint|border-line-soft|bg-sunk|
  --rail|--sunk|--mid|--faint|--line-` usages in `src/components/app/*`.

## Risks / mitigations

- **Theme regressions across light/sepia/dark** — the ramp must be defined for all three
  themes. Mitigation: define ramp + mappings per theme block; visual check all three.
- **Sidebar focus-mode interaction** — collapsing vs unmounting changes keyboard/layout
  behavior. Mitigation: route focus mode through `setOpen(false)`; verify editor width reclaim.
- **Parallel sweep conflicts** — agents editing `src/index.css` simultaneously. Mitigation:
  Phase 3 (shared CSS) completes before Phase 4; Phase 4 agents touch only their own
  component file.
- **Undecorated window on Linux** — some compositors drop edge-resize affordances when
  `decorations:false`. Mitigation: `minWidth`/`minHeight` stay set; the window remains
  resizable in most WMs; if a target compositor loses resize, add `startResizeDragging`
  grips later (out of scope unless it actually breaks on the dev machine).
- **macOS traffic-light overlap** — overlay lights sit over top-bar content. Mitigation:
  left inset (`pl-20`) on macOS + `trafficLightPosition` to center them; verify nothing is
  obscured (only verifiable on a Mac — flagged as a follow-up if no Mac is available).

## Sequencing

1 → 2 → 3 → 4 → 5, each independently reviewable. Phases 1 and 2 each deliver a visible win
and can ship before the theming sweep.
