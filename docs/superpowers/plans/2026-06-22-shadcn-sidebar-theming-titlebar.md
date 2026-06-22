# shadcn Sidebar + theme consolidation + custom titlebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom `Rail` with a shadcn offcanvas `Sidebar`, consolidate the app's parallel custom-token styling onto shadcn's semantic system (named warm-paper ramp), and turn the app's top bar into a custom platform-adaptive titlebar (frameless window).

**Architecture:** Five sequential, independently-reviewable phases: (1) Sidebar swap, (2) Custom titlebar, (3) Theme consolidation in `src/index.css`, (4) Parallel component sweep onto tokens/components, (5) `CLAUDE.md`. Each phase ends green on `just typecheck` and a `just run` smoke check.

**Tech Stack:** Tauri 2 (Rust), React 19, Vite 7, Tailwind 4, shadcn-style UI (`radix-ui`), `zustand`, `@tabler/icons-react`, Bun.

**Spec:** `docs/superpowers/specs/2026-06-22-shadcn-sidebar-theming-design.md`

---

## Verification model (read first)

This project has **no test runner** (no vitest/jest; `package.json` has only dev/build/preview/tauri). The work is UI composition, CSS tokens, and Tauri config — not unit-testable logic. So instead of red/green TDD, every task verifies with:

- **`just typecheck`** (`tsc --noEmit`, strict, `noUnusedLocals`/`noUnusedParameters`) — must stay green.
- **Grep gates** — assert legacy tokens/classes are gone where claimed.
- **`just run`** visual smoke — the native window; confirm the specific behavior changed.

Do **not** introduce a test framework (YAGNI). Do **not** edit `src/components/ui/*` stock primitives — they are canonical shadcn.

---

## Task 0: Git baseline

The repo currently has **zero commits**; everything is untracked. Establish a baseline so each later task is a reviewable diff. (Executing this plan implies consent to its commits.)

**Files:** none created; baseline commit of existing tree.

- [ ] **Step 1: Confirm ignores cover build artifacts**

Run: `cat .gitignore`
Expected: contains `node_modules`, `dist`, and `src-tauri/target` (or `/target`). If any is missing, add it before committing.

- [ ] **Step 2: Stage and verify what will be committed**

Run: `git add -A && git status --short | grep -E 'node_modules|target|/dist/' || echo "clean: no build artifacts staged"`
Expected: `clean: no build artifacts staged`

- [ ] **Step 3: Commit the baseline**

```bash
git commit -m "chore: baseline commit of existing project"
```

---

## Phase 1 — Sidebar swap

Replace `rail.tsx` with `app-sidebar.tsx` built from `ui/sidebar`, wrap the shell in `SidebarProvider`/`SidebarInset`, add a `SidebarTrigger` to the top bar, and route focus mode through `setOpen(false)`. The sidebar's built-in ⌘B is free (App.tsx binds only S/Enter/Z/Y).

### Task 1.1: Create `AppSidebar`

**Files:**
- Create: `src/components/app/app-sidebar.tsx`

Carries over `STATUS_DOT`, `CHARACTER_COLORS`, `AddCharacterDialog`, `AddLoreDialog` from `rail.tsx` (which is deleted in Task 1.4). Status-dot/label colors keep the **current** custom tokens (`bg-ok`, `text-accent-ink`, `text-faint`) for now; Phase 4 tokenizes them.

- [ ] **Step 1: Write the component**

```tsx
// app-sidebar.tsx — the left navigation as a shadcn Sidebar: chapters (with
// status), characters, lore. Collapses offcanvas (⌘B). Replaces the old Rail.

import { useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ColorDot } from "@/components/app/color-dot";
import { chapterStatus, useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import type { ChapterStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_DOT: Record<ChapterStatus, string> = {
  active: "bg-ok",
  draft: "bg-warn",
  outline: "bg-scratch-ink",
  planned: "bg-faint opacity-50",
};

const CHARACTER_COLORS = [
  "oklch(0.55 0.12 30)",
  "oklch(0.5 0.08 235)",
  "oklch(0.55 0.1 145)",
  "oklch(0.58 0.12 300)",
  "oklch(0.6 0.12 60)",
  "oklch(0.5 0.06 100)",
];

function AddCharacterDialog() {
  const addCharacter = useProjectStore((s) => s.addCharacter);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [color, setColor] = useState(CHARACTER_COLORS[0]);

  const submit = () => {
    if (!name.trim()) return;
    addCharacter({ name: name.trim(), role: role.trim(), color });
    setName("");
    setRole("");
    setColor(CHARACTER_COLORS[0]);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <SidebarGroupAction title="Add character">
          <IconPlus />
        </SidebarGroupAction>
      </DialogTrigger>
      <DialogContent className="font-ui sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">Add character</DialogTitle>
          <DialogDescription>
            Characters power dialogue speaker chips and the AI cast tracker.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="char-name">Name</Label>
            <Input
              id="char-name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Det. Marlow"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="char-role">Role</Label>
            <Input
              id="char-role"
              value={role}
              onChange={(e) => setRole(e.currentTarget.value)}
              placeholder="Interrogator"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Color</Label>
            <div className="flex gap-2">
              {CHARACTER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label="color"
                  aria-pressed={c === color}
                  onClick={() => setColor(c)}
                  className={cn(
                    "size-6 rounded-full ring-offset-2 ring-offset-background transition-shadow",
                    c === color && "ring-2 ring-ring",
                  )}
                >
                  <ColorDot color={c} className="size-6" />
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!name.trim()}>
            Add character
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddLoreDialog() {
  const addLore = useProjectStore((s) => s.addLore);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const submit = () => {
    if (!title.trim()) return;
    addLore(title.trim());
    setTitle("");
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <SidebarGroupAction title="Add lore">
          <IconPlus />
        </SidebarGroupAction>
      </DialogTrigger>
      <DialogContent className="font-ui sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">Add lore note</DialogTitle>
          <DialogDescription>A worldbuilding entry to track.</DialogDescription>
        </DialogHeader>
        <Input
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="The Tile"
        />
        <DialogFooter>
          <Button onClick={submit} disabled={!title.trim()}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AppSidebar() {
  const project = useProjectStore((s) => s.project);
  const meta = useProjectStore((s) => s.meta);
  const activeId = useProjectStore((s) => s.activeChapterId);
  const selectChapter = useProjectStore((s) => s.selectChapter);
  const guard = useViewStore((s) => s.requestGuarded);

  if (!project) return null;

  return (
    <Sidebar collapsible="offcanvas" className="font-ui">
      <SidebarHeader>
        <span className="truncate px-2 py-1 font-heading text-sm text-foreground">
          {project.name}
        </span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Chapters</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {project.chapters.map((c) => {
                const status = chapterStatus(c, meta, activeId);
                const on = c.id === activeId;
                return (
                  <SidebarMenuItem key={c.id}>
                    <SidebarMenuButton
                      isActive={on}
                      onClick={() => guard(() => void selectChapter(c.id))}
                      className="grid grid-cols-[24px_1fr_auto] items-center gap-1.5"
                    >
                      <span
                        className={cn(
                          "font-serif text-[13px] italic",
                          on ? "text-accent-ink" : "text-faint",
                        )}
                      >
                        {c.label}
                      </span>
                      <span className="truncate">{c.title}</span>
                      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Characters</SidebarGroupLabel>
          <AddCharacterDialog />
          <SidebarGroupContent>
            {meta.characters.length === 0 ? (
              <p className="px-2 py-1 text-xs text-faint">None yet — add your cast.</p>
            ) : (
              <SidebarMenu>
                {meta.characters.map((c) => (
                  <SidebarMenuItem key={c.id}>
                    <SidebarMenuButton className="text-mid">
                      <ColorDot color={c.color} />
                      <span className="truncate">{c.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Lore</SidebarGroupLabel>
          <AddLoreDialog />
          <SidebarGroupContent>
            {meta.lore.length === 0 ? (
              <p className="px-2 py-1 text-xs text-faint">No notes yet.</p>
            ) : (
              <SidebarMenu>
                {meta.lore.map((l) => (
                  <SidebarMenuItem key={l.id}>
                    <SidebarMenuButton className="text-mid">
                      <span className="size-1.5 shrink-0 rounded-full bg-lore-ink" />
                      <span className="truncate">{l.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `just typecheck`
Expected: PASS (no errors). `AppSidebar` is not yet imported anywhere — that's fine; it's an exported component, not an unused local.

### Task 1.2: Wrap the shell in `SidebarProvider` + focus sync

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports**

Add to the import block:

```tsx
import { SidebarProvider, SidebarInset, useSidebar } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app/app-sidebar";
```

- [ ] **Step 2: Remove the Rail from `Workspace`**

Replace the `Workspace` function body's returned JSX so it no longer renders the rail block. New `Workspace` return:

```tsx
  return (
    <div className="flex min-h-0 flex-1">
      {/* Editor and PDF share the central space; the AI panel is a fixed rail. */}
      <div className="min-w-0 flex-1">
        <Editor />
      </div>

      {showPdf ? (
        <div className="min-w-[340px] flex-1">
          <PdfPane />
        </div>
      ) : null}

      {showAi ? (
        <div className="w-[360px] shrink-0">
          <AiPanel />
        </div>
      ) : null}
    </div>
  );
```

Then delete the now-unused `Rail` import (`import { Rail } from "@/components/app/rail";`).

- [ ] **Step 3: Add the `FocusSync` helper**

Add above `App`:

```tsx
// Focus mode reclaims the editor by collapsing the sidebar (offcanvas) instead
// of unmounting it. Lives inside SidebarProvider so it can call useSidebar().
function FocusSync() {
  const focus = useViewStore((s) => s.focus);
  const { setOpen } = useSidebar();
  useEffect(() => {
    setOpen(!focus);
  }, [focus, setOpen]);
  return null;
}
```

- [ ] **Step 4: Wrap the ready branch**

Replace the `status === "ready"` block in `App`'s return:

```tsx
      {status === "ready" ? (
        <SidebarProvider>
          <FocusSync />
          <AppSidebar />
          <SidebarInset className="h-svh min-w-0 bg-background">
            <TopBar />
            <Workspace />
          </SidebarInset>
        </SidebarProvider>
      ) : (
        <Welcome />
      )}
```

- [ ] **Step 5: Typecheck**

Run: `just typecheck`
Expected: PASS.

### Task 1.3: Add the `SidebarTrigger` to the top bar

**Files:**
- Modify: `src/components/app/top-bar.tsx`

- [ ] **Step 1: Import the trigger**

Add:

```tsx
import { SidebarTrigger } from "@/components/ui/sidebar";
```

- [ ] **Step 2: Render it at the start of the header**

Immediately inside `<header ...>`, before the brand `<DropdownMenu>`:

```tsx
      <SidebarTrigger className="-ml-1 text-mid" />
```

- [ ] **Step 3: Typecheck**

Run: `just typecheck`
Expected: PASS.

### Task 1.4: Delete the old rail

**Files:**
- Delete: `src/components/app/rail.tsx`

- [ ] **Step 1: Confirm nothing else imports it**

Run: `grep -rn "components/app/rail" src || echo "no references"`
Expected: `no references`

- [ ] **Step 2: Delete the file**

Run: `git rm src/components/app/rail.tsx`

- [ ] **Step 3: Typecheck**

Run: `just typecheck`
Expected: PASS.

### Task 1.5: Visual smoke + commit

- [ ] **Step 1: Run the app**

Run: `just run`
Confirm: sidebar shows chapters/characters/lore; clicking a chapter switches it (and the unsaved-edits guard still fires when dirty); ⌘B (Cmd/Ctrl+B) toggles the sidebar offcanvas; the top-bar trigger toggles it; "+" on Characters/Lore opens the add dialogs; entering focus mode collapses the sidebar and exiting restores it.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(ui): replace custom Rail with shadcn offcanvas Sidebar"
```

---

## Phase 2 — Custom titlebar (frameless, platform-adaptive)

Windows/Linux: `decorations:false` + custom min/max/close. macOS: native traffic lights via `titleBarStyle:Overlay` + a left inset. Platform detected with `@tauri-apps/plugin-os`.

### Task 2.1: Add the OS plugin (platform detection)

New dependency justification: need reliable OS detection to branch titlebar behavior; `@tauri-apps/plugin-os` is the first-party, synchronous, idiomatic Tauri way (no hand-rolled UA sniffing).

**Files:**
- Modify: `package.json` (via bun), `src-tauri/Cargo.toml` (via cargo), `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`

- [ ] **Step 1: Install JS + Rust packages**

```bash
bun add @tauri-apps/plugin-os
cd src-tauri && cargo add tauri-plugin-os && cd ..
```

- [ ] **Step 2: Register the plugin in `lib.rs`**

In `src-tauri/src/lib.rs`, add to the builder chain (after the other `.plugin(...)` lines):

```rust
        .plugin(tauri_plugin_os::init())
```

- [ ] **Step 3: Grant the capability**

In `src-tauri/capabilities/default.json`, add `"os:default"` to the `permissions` array.

- [ ] **Step 4: Typecheck**

Run: `just typecheck`
Expected: PASS.

### Task 2.2: Platform helper

**Files:**
- Create: `src/lib/platform.ts`

- [ ] **Step 1: Write the helper**

```ts
// platform.ts — OS detection for platform-adaptive chrome (titlebar controls,
// macOS traffic-light inset). platform() from the OS plugin is synchronous in
// Tauri v2, but throws outside the Tauri runtime (e.g. `just dev` browser
// preview); default to non-macOS there.

import { platform } from "@tauri-apps/plugin-os";

function detect(): string {
  try {
    return platform();
  } catch {
    return "linux";
  }
}

export const IS_MAC = detect() === "macos";
```

- [ ] **Step 2: Typecheck**

Run: `just typecheck`
Expected: PASS.

### Task 2.3: Window controls component

**Files:**
- Create: `src/components/app/window-controls.tsx`

- [ ] **Step 1: Write the component**

```tsx
// window-controls.tsx — custom minimize/maximize/close for the frameless window
// on Windows/Linux. macOS uses native traffic lights (titleBarStyle: Overlay),
// so this renders nothing there. getCurrentWindow() is called lazily inside
// handlers so it is never invoked in the non-Tauri browser preview.

import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconCopy, IconMinus, IconSquare, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { IS_MAC } from "@/lib/platform";

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (IS_MAC) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void win.isMaximized().then(setMaximized);
    void win
      .onResized(() => {
        void win.isMaximized().then(setMaximized);
      })
      .then((u) => {
        unlisten = u;
      });
    return () => unlisten?.();
  }, []);

  if (IS_MAC) return null;

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Minimize"
        onClick={() => void getCurrentWindow().minimize()}
      >
        <IconMinus />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={maximized ? "Restore" : "Maximize"}
        onClick={() => void getCurrentWindow().toggleMaximize()}
      >
        {maximized ? <IconCopy /> : <IconSquare />}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Close"
        className="hover:bg-destructive hover:text-destructive-foreground"
        onClick={() => void getCurrentWindow().close()}
      >
        <IconX />
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `just typecheck`
Expected: PASS.

### Task 2.4: Drag region + inset + controls in the top bar

**Files:**
- Modify: `src/components/app/top-bar.tsx`

- [ ] **Step 1: Imports**

```tsx
import { WindowControls } from "@/components/app/window-controls";
import { IS_MAC } from "@/lib/platform";
import { cn } from "@/lib/utils"; // already imported — keep one import only
```

- [ ] **Step 2: Make the header a drag region (+ macOS inset)**

Change the `<header ...>` opening tag to add `data-tauri-drag-region` and a macOS left inset (clears the traffic lights):

```tsx
    <header
      data-tauri-drag-region
      className={cn(
        "flex h-11 items-center gap-3 border-b border-line-soft bg-background px-3 font-ui",
        IS_MAC && "pl-20",
      )}
    >
```

- [ ] **Step 3: Make the flex spacer draggable too**

The existing spacer `<div className="flex-1" />` is a child and blocks dragging in its area. Add the attribute:

```tsx
      <div className="flex-1" data-tauri-drag-region />
```

- [ ] **Step 4: Mount the controls at the far right**

As the **last** child inside `<header>` (after the `project ? (...) : (...)` block), add:

```tsx
      <WindowControls />
```

- [ ] **Step 5: Typecheck**

Run: `just typecheck`
Expected: PASS.

### Task 2.5: Tauri window config (frameless + macOS overlay)

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Create: `src-tauri/tauri.macos.conf.json`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Remove native decorations (base config = Windows/Linux)**

In `src-tauri/tauri.conf.json`, add `"decorations": false` to the `app.windows[0]` object:

```json
      {
        "label": "main",
        "title": "aproprose",
        "width": 1280,
        "height": 820,
        "minWidth": 960,
        "minHeight": 640,
        "decorations": false
      }
```

- [ ] **Step 2: macOS override (RFC 7396 replaces arrays — repeat the full window object)**

Create `src-tauri/tauri.macos.conf.json`:

```json
{
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "aproprose",
        "width": 1280,
        "height": 820,
        "minWidth": 960,
        "minHeight": 640,
        "decorations": true,
        "titleBarStyle": "Overlay",
        "hiddenTitle": true,
        "trafficLightPosition": { "x": 16, "y": 16 }
      }
    ]
  }
}
```

- [ ] **Step 3: Window-control permissions**

In `src-tauri/capabilities/default.json`, add these to `permissions` (alongside `os:default` from Task 2.1):

```json
    "core:window:allow-start-dragging",
    "core:window:allow-minimize",
    "core:window:allow-maximize",
    "core:window:allow-unmaximize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-internal-toggle-maximize",
    "core:window:allow-is-maximized",
    "core:window:allow-close"
```

- [ ] **Step 4: Typecheck**

Run: `just typecheck`
Expected: PASS.

### Task 2.6: Visual smoke + commit

- [ ] **Step 1: Run the app**

Run: `just run`
Confirm (Linux dev machine): no native titlebar; dragging the empty top-bar area moves the window; double-clicking it maximizes/restores; the min/max/close buttons work; the maximize icon toggles between square and restore; brand menu / PDF / AI / Compile / SidebarTrigger all still click normally. (macOS overlay + inset is only verifiable on a Mac — note as a follow-up if unavailable.)

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(window): custom platform-adaptive titlebar (frameless + controls)"
```

---

## Phase 3 — Theme consolidation (`src/index.css`)

Introduce a named warm-paper ramp, define the shadcn semantic mapping **once** in `:root`, and override only the ramp values per theme. Add `--success`/`--warning`. Keep legacy custom tokens as **temporary aliases** so un-swept components keep rendering; Phase 4 removes the aliases after the sweep. Rename `--font-ui` → `--font-sans`.

> CSS note: `var()` resolves per element against the cascaded custom-property values, so a single `--background: var(--paper-100)` in `:root` retunes automatically when a theme block overrides `--paper-100`. In dark, "ink" steps are light and "paper" steps are dark — the ramp values invert; the semantic mapping does not.

### Task 3.1: Rewrite the token blocks

**Files:**
- Modify: `src/index.css` (the `:root`, `[data-theme="sepia"]`, `.dark` blocks)

- [ ] **Step 1: Replace the `:root` block**

Replace the entire `:root { ... }` block (lines ~21–96) with:

```css
:root {
  --radius: 0.625rem;

  /* ── warm-paper ramp (light values; themes override below) ─────────────── */
  --paper-50: oklch(0.985 0.004 80); /* raised surfaces: card/popover */
  --paper-100: oklch(0.965 0.006 80); /* app background */
  --paper-150: oklch(0.945 0.008 80); /* sidebar */
  --paper-200: oklch(0.935 0.008 78); /* sunk: muted/secondary */
  --ink-300: oklch(0.78 0.008 60); /* faint text */
  --ink-500: oklch(0.62 0.01 60); /* muted text */
  --ink-700: oklch(0.45 0.012 60); /* mid text */
  --ink-900: oklch(0.26 0.015 60); /* strong text / primary */
  --line-100: oklch(0.94 0.005 60); /* faint divider (sidebar) */
  --line-200: oklch(0.9 0.006 60); /* default border */
  --line-300: oklch(0.82 0.008 60); /* strong divider */
  --clay-500: oklch(0.56 0.1 45); /* accent solid: ring */
  --clay-600: oklch(0.5 0.1 45); /* accent ink: on-accent text */
  --clay-tint: oklch(0.93 0.04 65); /* accent surface */
  --moss-500: oklch(0.65 0.15 145); /* success */
  --amber-500: oklch(0.72 0.13 75); /* warning */
  --danger-500: oklch(0.577 0.245 27.325); /* destructive */

  /* ── shadcn semantic mapping (shared by every theme) ──────────────────── */
  --background: var(--paper-100);
  --foreground: var(--ink-900);
  --card: var(--paper-50);
  --card-foreground: var(--ink-900);
  --popover: var(--paper-50);
  --popover-foreground: var(--ink-900);
  --primary: var(--ink-900);
  --primary-foreground: var(--paper-50);
  --secondary: var(--paper-200);
  --secondary-foreground: var(--ink-900);
  --muted: var(--paper-200);
  --muted-foreground: var(--ink-500);
  --accent: var(--clay-tint);
  --accent-foreground: var(--clay-600);
  --destructive: var(--danger-500);
  --destructive-foreground: var(--paper-50);
  --success: var(--moss-500);
  --success-foreground: var(--paper-50);
  --warning: var(--amber-500);
  --warning-foreground: var(--ink-900);
  --border: var(--line-200);
  --input: var(--line-200);
  --ring: var(--clay-500);
  --chart-1: var(--clay-500);
  --chart-2: oklch(0.5 0.08 235);
  --chart-3: oklch(0.65 0.12 85);
  --chart-4: oklch(0.58 0.1 215);
  --chart-5: oklch(0.45 0.07 285);
  --sidebar: var(--paper-150);
  --sidebar-foreground: var(--ink-900);
  --sidebar-primary: var(--ink-900);
  --sidebar-primary-foreground: var(--paper-50);
  --sidebar-accent: var(--paper-200);
  --sidebar-accent-foreground: var(--ink-900);
  --sidebar-border: var(--line-100);
  --sidebar-ring: var(--clay-500);

  /* ── legacy aliases (TEMPORARY — removed in Phase 4 after the sweep) ───── */
  --paper: var(--card);
  --rail: var(--sidebar);
  --sunk: var(--muted);
  --mid: var(--muted-foreground);
  --faint: var(--ink-300);
  --line-soft: var(--border);
  --line-strong: var(--line-300);
  --accent-ink: var(--clay-600);
  --ok: var(--success);
  --warn: var(--warning);
  --flag: var(--destructive);

  /* ── kept app tokens (irreducible) ────────────────────────────────────── */
  --ai-tint: oklch(0.95 0.018 285);
  --ai-edge: oklch(0.86 0.04 285);
  --ai-ink: oklch(0.4 0.08 285);
  --lore-tint: oklch(0.96 0.045 95);
  --lore-edge: oklch(0.84 0.06 90);
  --lore-ink: oklch(0.45 0.07 80);
  --scratch-tint: oklch(0.95 0.025 200);
  --scratch-edge: oklch(0.84 0.05 215);
  --scratch-ink: oklch(0.42 0.08 220);
  --sheet: oklch(0.99 0.008 95);
  --sheet-ink: oklch(0.22 0.015 60);
}
```

- [ ] **Step 2: Replace the `[data-theme="sepia"]` block**

Replace the entire sepia block with ramp + kept-token overrides only (the shared mapping is inherited from `:root`):

```css
[data-theme="sepia"] {
  --paper-50: oklch(0.955 0.025 80);
  --paper-100: oklch(0.93 0.03 80);
  --paper-150: oklch(0.91 0.035 78);
  --paper-200: oklch(0.895 0.04 76);
  --ink-300: oklch(0.74 0.025 60);
  --ink-500: oklch(0.6 0.03 60);
  --ink-700: oklch(0.45 0.035 55);
  --ink-900: oklch(0.28 0.04 50);
  --line-100: oklch(0.9 0.025 65);
  --line-200: oklch(0.85 0.03 65);
  --line-300: oklch(0.76 0.04 60);
  --clay-500: oklch(0.5 0.12 35);
  --clay-600: oklch(0.5 0.12 35);
  --clay-tint: oklch(0.88 0.05 65);

  --sheet: oklch(0.96 0.03 82);
  --sheet-ink: oklch(0.26 0.04 50);
}
```

- [ ] **Step 3: Replace the `.dark, [data-theme="dark"]` block**

Replace the entire dark block with cool-slate ramp + the few direct overrides (destructive hue, block tints, sheet) — mapping inherited from `:root`:

```css
.dark,
[data-theme="dark"] {
  --paper-50: oklch(0.225 0.008 250); /* card/popover (raised) */
  --paper-100: oklch(0.2 0.008 250); /* background */
  --paper-150: oklch(0.18 0.008 250); /* sidebar */
  --paper-200: oklch(0.27 0.01 250); /* muted/secondary */
  --ink-300: oklch(0.4 0.01 60); /* faint */
  --ink-500: oklch(0.62 0.012 60); /* muted text */
  --ink-700: oklch(0.72 0.012 60); /* mid text */
  --ink-900: oklch(0.92 0.008 80); /* strong text (light on dark) */
  --line-100: oklch(0.26 0.01 250); /* sidebar divider */
  --line-200: oklch(0.3 0.012 250); /* border */
  --line-300: oklch(0.38 0.015 250); /* strong divider */
  --clay-500: oklch(0.72 0.1 50); /* ring */
  --clay-600: oklch(0.78 0.1 55); /* accent ink */
  --clay-tint: oklch(0.3 0.04 50); /* accent surface */
  --danger-500: oklch(0.704 0.191 22.216);

  --ai-tint: oklch(0.24 0.022 285);
  --ai-edge: oklch(0.36 0.04 285);
  --ai-ink: oklch(0.78 0.06 285);
  --lore-tint: oklch(0.26 0.035 95);
  --lore-edge: oklch(0.38 0.05 90);
  --lore-ink: oklch(0.8 0.07 90);
  --scratch-tint: oklch(0.24 0.025 215);
  --scratch-edge: oklch(0.36 0.05 215);
  --scratch-ink: oklch(0.8 0.07 215);
  --sheet: oklch(0.92 0.012 80);
  --sheet-ink: oklch(0.22 0.015 60);
}
```

- [ ] **Step 4: Typecheck**

Run: `just typecheck`
Expected: PASS (CSS isn't type-checked, but this catches accidental TS/import breakage).

### Task 3.2: Update `@theme inline` (add status colors, font rename)

**Files:**
- Modify: `src/index.css` (the `@theme inline` block)

- [ ] **Step 1: Add status color tokens**

In `@theme inline`, after the `--color-destructive: var(--destructive);` line, add:

```css
  --color-destructive-foreground: var(--destructive);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
```

(Note: there is no existing `--color-destructive-foreground`; add it so `bg-destructive text-destructive-foreground` works in the window controls.)

- [ ] **Step 2: Keep legacy `--color-*` mappings for now**

Leave the existing `--color-paper/-rail/-sunk/-mid/-faint/-line-soft/-line-strong/-accent-ink/-ok/-warn/-flag` mappings in place (the aliases still resolve them). They are deleted in Phase 4.

- [ ] **Step 3: Rename the UI font token**

In `@theme inline`, rename `--font-ui` to `--font-sans`:

```css
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
```

- [ ] **Step 4: Rename every `font-ui` class usage to `font-sans`**

Run (replaces the utility class across the frontend, including `index.css`):

```bash
grep -rl '\bfont-ui\b' src | xargs sed -i 's/\bfont-ui\b/font-sans/g'
```

- [ ] **Step 5: Verify no `font-ui` remains**

Run: `grep -rn '\bfont-ui\b' src || echo "none"`
Expected: `none`

- [ ] **Step 6: Typecheck**

Run: `just typecheck`
Expected: PASS.

### Task 3.3: Visual smoke + commit

- [ ] **Step 1: Run the app and check all three themes**

Run: `just run`
Confirm: light, sepia, and dark all render as before (Settings → appearance). Sidebar, editor, AI/PDF panels, build badge, and the titlebar look unchanged (legacy aliases keep colors intact). The chrome font still renders sans.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "refactor(theme): named warm-paper ramp + shadcn semantic mapping; add success/warning; font-ui->font-sans"
```

---

## Phase 4 — Component sweep (parallel Workflow) + alias removal

Rewrite each `src/components/app/*` file to use shadcn semantic tokens + components, then delete the legacy aliases. The sweep runs as a Workflow (one agent per file); a final task removes the aliases and runs the grep gate.

### Rewrite rules (apply to every app component)

| Legacy | Replace with |
|---|---|
| `text-mid` | `text-muted-foreground` |
| `text-faint` | `text-muted-foreground/60` |
| `bg-sunk` (and `bg-sunk/50`) | `bg-muted` (`bg-muted/50`) |
| `border-line-soft` | `border-border` (or just `border`) |
| `border-line-strong` | `border-border` |
| `text-accent-ink` / `bg-accent-ink` / `from-accent-ink` | `text-primary` / `bg-primary` / `from-primary` (accent emphasis) |
| `bg-paper` | `bg-card` |
| `bg-ok` / `text-ok` | `bg-success` / `text-success` |
| `bg-warn` / `text-warn` | `bg-warning` / `text-warning` |
| `bg-flag` / `text-flag` | `bg-destructive` / `text-destructive` |
| raw `<button>` (non-primitive) | `Button` (`@/components/ui/button`), pick `variant`/`size` |
| raw `<input>` (non-primitive) | `Input` (`@/components/ui/input`), or `InputGroup` for icon inputs |
| ad-hoc `text-[Npx]` | nearest type-scale class (`text-xs`, `text-[11px]`→`text-xs`, etc.) or a Typography component |

**Keep (do not change):** `--ai-*`, `--lore-*`, `--scratch-*` block-type classes; `--sheet`/`--sheet-ink` in `pdf-pane`; `color-dot`'s `--dot` inline CSS var; the `CHARACTER_COLORS` oklch array in `app-sidebar`; the brand gradient in `top-bar`/`welcome` (may simplify but not required). Do not touch `src/components/ui/*`.

Each agent: rewrite its file per the rules, keep behavior identical, then run `just typecheck` and report. BuildBadge in `top-bar` should become a `Badge` (`@/components/ui/badge`) with the status color; the PDF/AI toggle buttons should become `Toggle` (`@/components/ui/toggle`) driven by their `aria-pressed` state.

### Task 4.1: Run the sweep Workflow

**Files (modified by agents):** `top-bar.tsx`, `window-controls.tsx`, `app-sidebar.tsx`, `ai-panel.tsx`, `block.tsx`, `welcome.tsx`, `pdf-pane.tsx`, `editor.tsx`, `inline.tsx`, `auto-textarea.tsx`, `settings-sheet.tsx`, `color-dot.tsx`

- [ ] **Step 1: Invoke the Workflow**

Use the Workflow tool with this script (pipeline: rewrite → typecheck per file):

```js
export const meta = {
  name: 'aproprose-style-sweep',
  description: 'Rewrite each app component onto shadcn semantic tokens + components',
  phases: [{ title: 'Sweep' }],
}

const RULES = `Replace legacy classes per this map, keep behavior identical, do NOT touch src/components/ui/*:
text-mid->text-muted-foreground; text-faint->text-muted-foreground/60; bg-sunk->bg-muted (bg-sunk/50->bg-muted/50);
border-line-soft & border-line-strong->border-border; text/bg/from-accent-ink->text/bg/from-primary; bg-paper->bg-card;
bg-ok/text-ok->bg-success/text-success; bg-warn/text-warn->bg-warning/text-warning; bg-flag/text-flag->bg-destructive/text-destructive;
raw <button> (not a ui/ primitive)-> <Button> from @/components/ui/button with a sensible variant/size;
raw <input>-> <Input> from @/components/ui/input (or InputGroup for icon inputs);
ad-hoc text-[Npx]-> nearest type-scale class.
KEEP: --ai-*/--lore-*/--scratch- block classes, --sheet/--sheet-ink, color-dot --dot inline var, CHARACTER_COLORS oklch array, brand gradient.
In top-bar: BuildBadge -> <Badge> with status color; PDF/AI toggles -> <Toggle> from @/components/ui/toggle bound to aria-pressed.`

const FILES = [
  'src/components/app/top-bar.tsx',
  'src/components/app/window-controls.tsx',
  'src/components/app/app-sidebar.tsx',
  'src/components/app/ai-panel.tsx',
  'src/components/app/block.tsx',
  'src/components/app/welcome.tsx',
  'src/components/app/pdf-pane.tsx',
  'src/components/app/editor.tsx',
  'src/components/app/inline.tsx',
  'src/components/app/auto-textarea.tsx',
  'src/components/app/settings-sheet.tsx',
  'src/components/app/color-dot.tsx',
]

const results = await pipeline(
  FILES,
  (file) => agent(
    `Read ${file} and rewrite it in place to satisfy these rules. Then read it back and confirm no legacy classes remain. ${RULES}`,
    { label: `sweep:${file.split('/').pop()}`, phase: 'Sweep' }
  ),
  (_done, file) => agent(
    `Run \`just typecheck\` from the repo root. If it fails because of changes to ${file}, fix ${file} until it passes. Report the final typecheck status.`,
    { label: `verify:${file.split('/').pop()}`, phase: 'Sweep' }
  ),
)
return { swept: FILES.length, results }
```

- [ ] **Step 2: Typecheck the whole tree**

Run: `just typecheck`
Expected: PASS. Fix any file the Workflow left broken.

### Task 4.2: Remove the legacy aliases

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Delete the alias block**

Remove the "legacy aliases (TEMPORARY ...)" block added in Task 3.1 (the `--paper`, `--rail`, `--sunk`, `--mid`, `--faint`, `--line-soft`, `--line-strong`, `--accent-ink`, `--ok`, `--warn`, `--flag` declarations).

- [ ] **Step 2: Delete the legacy `@theme inline` color mappings**

Remove these lines from `@theme inline`: `--color-paper`, `--color-rail`, `--color-sunk`, `--color-mid`, `--color-faint`, `--color-line-soft`, `--color-line-strong`, `--color-accent-ink`, `--color-ok`, `--color-warn`, `--color-flag`. (Keep `--color-sheet`, `--color-sheet-ink`, and the `--color-ai-*/--color-lore-*/--color-scratch-*` mappings.)

- [ ] **Step 3: Grep gate — no legacy tokens remain in app components**

Run:

```bash
grep -rnE '\b(text|bg|border|from|to|via|ring)-(mid|faint|sunk|line-soft|line-strong|accent-ink|paper|ok|warn|flag)\b' src/components/app && echo "FOUND — fix these" || echo "clean"
```

Expected: `clean`

- [ ] **Step 4: Grep gate — no legacy CSS vars remain**

Run:

```bash
grep -nE -- '--(rail|sunk|mid|faint|line-soft|line-strong|accent-ink|paper|ok|warn|flag)\b' src/index.css && echo "FOUND — fix these" || echo "clean"
```

Expected: `clean` (the `--paper-*`/`--line-*` ramp steps are fine — the pattern requires a word boundary right after the name, so `--paper-50`/`--line-200` won't match).

- [ ] **Step 5: Typecheck**

Run: `just typecheck`
Expected: PASS.

### Task 4.3: Visual smoke + commit

- [ ] **Step 1: Run the app, all themes**

Run: `just run`
Confirm: light/sepia/dark all render correctly; sidebar, chapter status dots (success/warning/scratch colors), build badge, PDF/AI toggles, welcome screen, AI panel, and editor blocks look right; titlebar still works.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "refactor(ui): sweep app components onto shadcn tokens/components; drop legacy aliases"
```

---

## Phase 5 — `CLAUDE.md`

Document the consolidated system so the next contributor doesn't re-sprawl.

### Task 5.1: Update conventions

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a "Theming & tokens" subsection** under Frontend Conventions covering:
  - All color flows through shadcn semantic tokens (`bg-background`, `text-muted-foreground`, `border-border`, `bg-sidebar`, `bg-success`/`bg-warning`/`bg-destructive`). Retune the palette by editing the named ramp (`--paper-*`, `--ink-*`, `--line-*`, `--clay-*`) in `src/index.css`; the semantic mapping lives once in `:root`.
  - Status states use `--success`/`--warning`/`--destructive` (each with `-foreground`).
  - The only custom app tokens that remain — and why: block-type tints (`--ai-*`/`--lore-*`/`--scratch-*`), the PDF `--sheet`/`--sheet-ink`, `--prose-size`.
  - Chrome font is `font-sans`; body is serif (`font-serif`); headings `font-heading`.
  - No ad-hoc `text-[Npx]`/inline `oklch()` in components — use the type scale + tokens.

- [ ] **Step 2: Add a "Window shell" subsection** under Tauri Conventions covering:
  - Layout is `SidebarProvider` → `AppSidebar` + `SidebarInset` (editor/PDF/AI). The sidebar is offcanvas; ⌘B toggles it; focus mode collapses via `setOpen(false)`.
  - The top bar is the custom titlebar: `data-tauri-drag-region` on the header + spacer; `WindowControls` (min/max/close) on Windows/Linux; macOS uses native traffic lights (`titleBarStyle: Overlay`, configured in `tauri.macos.conf.json`) + a `pl-20` inset. Platform via `IS_MAC` from `@/lib/platform`.
  - New window capabilities live in `capabilities/default.json` (`core:window:allow-*`, `os:default`).

- [ ] **Step 3: Update the Layout bullet** for `src/components/ui/` to mention `sidebar`, and note `src/components/app/window-controls.tsx` + `src/lib/platform.ts`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document consolidated theming + custom titlebar conventions"
```

---

## Self-review (completed by plan author)

**Spec coverage:** Sidebar swap → Phase 1 ✓. Custom titlebar (platform-adaptive) → Phase 2 ✓. Maximal token consolidation onto named ramp → Phase 3 ✓. Component sweep via parallel Workflow → Phase 4 ✓. Irreducible tokens kept (block tints, sheet) → Tasks 3.1/4.2 ✓. CLAUDE.md → Phase 5 ✓. Typography unchanged (serif) → no task needed, confirmed in spec ✓.

**Placeholder scan:** No TBD/TODO; every code step shows full code or an exact command + expected output. ✓

**Type/name consistency:** `AppSidebar`, `WindowControls`, `FocusSync`, `IS_MAC` used consistently across tasks; sidebar primitive names match `ui/sidebar` exports; `chapterStatus`/store selectors match `project-store`; button size `icon-sm` exists. ✓

**Sequencing safety:** Legacy aliases (Task 3.1) keep every commit visually intact until Task 4.2 removes them after the sweep; `font-ui`→`font-sans` token + class rename happen in the same commit (Task 3.2). ✓
