# Carve & split blocks from a text selection

**Status:** approved design · **Date:** 2026-06-22 · **Area:** editor (frontend)

## Problem

A chapter is an ordered list of typed `Block`s (`narration`, `dialogue`, `lore`,
`scratchpad`, `chapter`, `latex`). Today the authoring unit is the whole block:
you can change a block's *entire* type via the `TypeChip`, insert a fresh block
after the selected one, and edit text in place — but you cannot operate on a
**sub-slice** of a block's text.

The writer wants two moves while editing prose:

1. **Split at cursor** — drop the caret mid-paragraph and break the block into
   two blocks of the same type, so new material can be slotted between them.
2. **Convert a selection** — highlight a sub-range inside a block, pick a target
   type, and carve that slice out into its own block of the new type. The text
   before and after stay as blocks of the original type.

## Core insight: one primitive

Both moves are the same operation — *cut a block's `text` at offsets and reflow
into new blocks*:

- **Split at cursor** = cut at one point → 2 blocks, same type.
- **Convert selection** = cut at two points → up to 3 blocks:
  `[before(orig type)] · [middle(new type)] · [after(orig type)]`, with empty
  edge pieces dropped.

The editor already edits each block through a native `<textarea>`
(`AutoGrowTextarea`), which exposes `selectionStart` / `selectionEnd` / `value`.
No rich-text/contenteditable rewrite is needed — we read offsets off the
textarea and hand them to a pure carve function.

## Decisions (resolved during brainstorming)

- **Trigger:** a **floating selection toolbar** above the highlighted text
  (Notion/Medium style) for convert + isolate; a **keyboard shortcut** for the
  caret-only split.
- **Transform:** **purely mechanical**, no AI. The selected text becomes the new
  block's body verbatim (with the small cleanups below). No model call.
- **Keybindings (revised this session):**
  - `⌘/Ctrl+S` → **Save & build PDF** (saving now rebuilds the PDF; overloaded by
    design).
  - `⌘/Ctrl+Enter` → **Split block at cursor** (freed up because build moved onto
    `⌘S`).
  - `⌘/Ctrl+Z` → Undo · `⌘/Ctrl+Shift+Z` / `Ctrl+Y` → Redo (unchanged).
- **Settings** gains a read-only **Keyboard** section listing every binding,
  driven by a single keybindings registry so the list can't drift from the real
  handlers.
- **Tests:** add a minimal **`vitest`** harness and unit-test the pure carve and
  keybinding logic. Broader/component/e2e testing is delegated to other agents;
  this work establishes the harness and baseline coverage.

---

## Component design

### 1. Pure carve logic — `src/lib/blocks/carve.ts` (new)

No React, no store, no I/O — just `Block`-in / `Block[]`-out. This is the unit
that gets tested.

```ts
// Replace one block with the pieces that result from splitting at a caret.
// No-op (returns [block]) when `at` is 0 or at the end — never makes an empty block.
export function planSplit(block: Block, at: number): Block[]

// Replace one block with [before?, mid, after?]; empty edge pieces are dropped.
export function planCarve(
  block: Block,
  start: number,
  end: number,
  newType: BlockType,
): Block[]
```

Rules:

- **Boundary trim.** Trailing whitespace is trimmed off `before`, leading
  whitespace off `after`, and `mid` is `trim()`-ed, so cuts don't leave ragged
  spaces.
- **Field inheritance.**
  - `before` / `after` keep the source block's `type` and type-specific fields
    (`speaker`, `level`, …).
  - A dialogue **`beat`** is reattached to the **last surviving dialogue piece**
    (so a 2-way split puts it on the second half); if no dialogue piece survives
    the carve, the beat is dropped.
  - The **`mid`** piece: if `newType === block.type` (the "isolate" / ✂ Split
    case) it inherits the source's type fields (e.g. keeps the speaker); if
    `newType !== block.type` it starts with **fresh** fields.
- **Dialogue quote-strip.** When `newType === "dialogue"`, strip one matched
  surrounding quote pair from `mid` (`"…"`, `“…”`, `'…'`, `‘…’`). The block
  renders its own quotes via the serializer (`` ``…'' ``), so stored text must
  not include them.
- **Emphasis rebalancing.** The editor writes italics as `_like this_`. If a cut
  lands inside an `_…_` span, each piece is closed/reopened so no piece emits a
  dangling `_`: for a piece spanning `[a, b)`, if an emphasis run is open at `a`
  (odd count of `_` in `text[0:a]`) prepend `_`; if it is still open at `b`
  append `_`.
- **Output shape.** Every produced piece is `dirty: true`, `raw: ""`, with a
  fresh `uid()`. (Verified safe: the serializer re-renders any `dirty`/`raw:""`
  block from its fields with a standard `\n\n` separator — the same path
  `insertAfter` already relies on.)

Edge cases (all covered by tests):

- Split at `0` or `len` → `[block]` (no-op, no empty block).
- Carve with the selection spanning the whole text → `[mid]` only → equivalent to
  a whole-block type change.
- Selection at the very start/end → no empty leading/trailing block.
- Cut inside an `_italic_` span → rebalanced on both pieces.

### 2. Store actions — `src/stores/project-store.ts` (edit)

Two actions, each **one undo step** (reusing the existing `capPush` history
pattern), that splice the carve result in place of the original block:

```ts
splitBlock: (id: string, at: number) => void          // selects the 2nd piece
convertSelection: (
  id: string, start: number, end: number, type: BlockType,
) => void                                              // selects the mid piece
```

`convertSelection` selecting the new middle piece means the speaker chip is
immediately at hand to assign a speaker for a fresh dialogue block.

`saveChapter` stays the **save-only primitive** (it is called internally by
`compileNow`; making it compile would loop). The "save = rebuild" behavior is
wired at the call sites (see §6).

### 3. Selection → pixel rect — `src/lib/textarea-caret.ts` (new)

```ts
export function selectionRect(
  textarea: HTMLTextAreaElement, start: number, end: number,
): DOMRect | null
```

Native `<textarea>` selections are **not** part of the DOM Selection API, so we
use the standard **mirror-div** technique: clone the textarea's computed styles
into a hidden, absolutely-positioned div, place a marker span at the offset, and
measure it. Returns viewport coordinates for anchoring the toolbar. Self-
contained, no new dependency.

### 4. Floating toolbar — `src/components/app/selection-toolbar.tsx` (new)

A **single instance** rendered by `Editor`. It owns no per-block wiring:

- Subscribes to `document`'s `selectionchange` (rAF-throttled) plus focus/blur.
- On change, reads `document.activeElement`; acts only when it is a
  `[data-prose-body]` textarea inside a `[data-block-id]` element **with a
  non-empty selection**. It resolves the block id via
  `activeElement.closest('[data-block-id]')`.
- Computes the anchor rect via `selectionRect` and portals the toolbar above the
  highlight (flips below when near the top of the viewport).
- Hides on empty selection, blur (unless focus moved into the toolbar), scroll,
  and `Escape`. `onMouseDown` is `preventDefault`-ed so clicking a button does
  not drop the textarea selection.
- **Buttons:** one `→ <Type>` button for each prose type **other than the source
  block's type** (`narration`, `dialogue`, `lore`, `scratchpad`), plus **✂ Split**.
  - `→ <Type>` → `convertSelection(id, start, end, type)`.
  - **✂ Split** → `convertSelection(id, start, end, sourceType)` — isolates the
    selection as its own same-type paragraph.
- Styled with `font-ui`, theme tokens, and the shadcn `Button` — matching the
  existing block action row.

> **Positioning trade-off (recommended vs fallback).** Recommended: the mirror-div
> rect for an exact above-the-highlight anchor (matches the approved mockup).
> Fallback if line-wrap/scroll math proves fiddly: anchor the bar to the block's
> top-right. We start with the mirror-div approach.

### 5. Block markers — `src/components/app/block.tsx` + `auto-textarea.tsx` (edit)

- `auto-textarea.tsx`: forward arbitrary pass-through props (`data-*`) to the
  underlying `<textarea>` (small, clean change; it already forwards `onKeyDown`).
- `block.tsx`: tag the **carve-eligible body** textareas with `data-prose-body`:
  `narration`, the `dialogue` utterance body, `lore` body, `scratchpad` body. The
  dialogue **beat**, lore **title**, chapter **scene heading**, and **raw latex**
  textareas are deliberately **not** marked, so the toolbar and the split shortcut
  ignore them.

No per-block keydown is needed: the split shortcut is handled by the global
keybinding dispatcher (§6), which reads the focused `[data-prose-body]` textarea.

### 6. Keybindings registry — `src/lib/keybindings.ts` (new) + wiring

Single source of truth for both the handlers and the Settings list, so they
cannot drift.

```ts
export interface Combo { mod?: boolean; shift?: boolean; alt?: boolean; key: string }
export interface Keybinding {
  id: string;
  label: string;
  description?: string;
  combos: Combo[];          // matches if ANY combo matches
  scope: "global" | "editor";
}
export const KEYBINDINGS: Keybinding[]
export function matchesCombo(e: KeyboardEvent, combo: Combo): boolean   // pure
export function bindingFor(e: KeyboardEvent): Keybinding | null         // pure
export function comboTokens(combo: Combo, mac: boolean): string[]       // ["⌘","⇧","Z"] — one per <Kbd> chip
export function formatCombo(combo: Combo, mac: boolean): string         // "⌘⇧Z" / "Ctrl+Shift+Z" — plain text (titles)
export function isMac(): boolean                                        // navigator.userAgent
```

`comboTokens` returns one token per key so a chord renders as separate chips
inside the shadcn `KbdGroup` (e.g. `⌘` + `S`); `formatCombo` is the flat-string
form for `title`/`aria-label`.

Registry contents:

| id | combo(s) | label | scope |
|----|----------|-------|-------|
| `save-build` | `⌘/Ctrl+S` | Save & build PDF | global |
| `split` | `⌘/Ctrl+Enter` | Split block at cursor | editor |
| `undo` | `⌘/Ctrl+Z` | Undo | editor |
| `redo` | `⌘/Ctrl+Shift+Z`, `Ctrl+Y` | Redo | editor |

`App.tsx` (edit): replace the inline string checks in the `keydown` handler with
a dispatch over `bindingFor(e)`:

- `save-build` → `compileNow()` (saves the dirty chapter, then rebuilds).
- `split` → if `document.activeElement` is a `[data-prose-body]` textarea,
  `preventDefault()` and `splitBlock(blockId, textarea.selectionStart)`;
  otherwise no-op.
- `undo` / `redo` → unchanged, keeping the existing "skip when focus is in the AI
  panel or a dialog" guard.

`top-bar.tsx` (edit): relabel the "Save chapter" menu item to **"Save & build
PDF"** and route it to `compileNow`. The prominent **Compile** button keeps
calling `compileNow` and now also **renders its shortcut hint** — a
`KbdGroup` of `comboTokens` for the `save-build` binding (`⌘` `S`) — using the
existing `@/components/ui/kbd` primitive, so the build affordance advertises its
key the same way the rest of the UI will.

### 7. Shared chord rendering — `src/components/ui/kbd.tsx` (existing)

The shadcn **`Kbd`** / **`KbdGroup`** primitive already exists and is the single
component for rendering a chord. Both the Settings list and the Compile button
render chords by mapping `comboTokens(combo, isMac())` into
`<KbdGroup><Kbd>…</Kbd>…</KbdGroup>`. No bespoke chip component is introduced.

### 8. Settings — `src/components/app/settings-sheet.tsx` (edit)

Add a read-only **Keyboard** section that maps over `KEYBINDINGS` and renders
each row as `label` + a `KbdGroup` built from `comboTokens(combo, isMac())`
(redo shows its two alternates). A muted footnote notes the mouse affordance:
*"Highlight text in a block to convert or isolate the selection."* Rebinding keys
is a non-goal.

---

## Testing

Add **`vitest`** as a dev-dependency with a `"test": "vitest"` script (Vitest
reads the existing `vite.config.ts`; pure-logic tests need no jsdom). Baseline
coverage authored here:

- `src/lib/blocks/carve.test.ts`
  - split: no-op at 0/end; mid-split keeps type; dialogue split keeps speaker on
    both halves and moves the beat to the trailing half.
  - carve: 3-way result; empty edges dropped; whole-text selection → single
    piece; dialogue quote-strip across all quote styles; speaker reset when
    converting to a *different* type; speaker kept when isolating (same type);
    emphasis rebalancing across a cut.
- `src/lib/keybindings.test.ts`
  - `matchesCombo` / `bindingFor` for each binding incl. the `mod = ⌘|Ctrl`
    equivalence and the redo alternates; `formatCombo` mac vs non-mac output.

`textarea-caret.ts` (needs a real layout box) and `selection-toolbar.tsx` /
`block.tsx` (React + DOM) are verified manually here and left for the
comprehensive testing pass by other agents. `just typecheck` must stay green.

## Files

| File | Change |
|------|--------|
| `src/lib/blocks/carve.ts` | **new** — pure split/carve/quote-strip/emphasis |
| `src/lib/textarea-caret.ts` | **new** — selection → pixel rect (mirror-div) |
| `src/lib/keybindings.ts` | **new** — registry + matchers + formatter |
| `src/components/app/selection-toolbar.tsx` | **new** — floating toolbar |
| `src/stores/project-store.ts` | `splitBlock`, `convertSelection` actions |
| `src/components/app/block.tsx` | `data-prose-body` markers on carve-eligible bodies |
| `src/components/app/auto-textarea.tsx` | forward pass-through `data-*` props |
| `src/components/app/editor.tsx` | render `<SelectionToolbar />` once |
| `src/components/app/top-bar.tsx` | "Save chapter" → "Save & build PDF" → `compileNow`; Compile button shows `⌘S` hint via `Kbd` |
| `src/components/app/settings-sheet.tsx` | read-only Keyboard section (renders chords via `Kbd`) |
| `src/components/ui/kbd.tsx` | **existing** — reused for all chord chips (no change) |
| `src/App.tsx` | keydown dispatch via registry; `⌘S`→build, `⌘↵`→split |
| `src/lib/blocks/carve.test.ts` | **new** — carve unit tests |
| `src/lib/keybindings.test.ts` | **new** — keybinding unit tests |
| `package.json` / `vitest` | add dev-dep + `test` script |

## Non-goals (YAGNI)

- AI-assisted reshape of the carved slice (mechanical was chosen).
- Cross-block selection, merging adjacent blocks, drag-to-merge.
- User-customizable / rebindable keys (the registry is display + dispatch only).
- A toolbar exposing every block type (`chapter`, `latex` excluded).
