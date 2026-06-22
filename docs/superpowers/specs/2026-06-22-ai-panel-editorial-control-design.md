# AI Panel: editorial control + cursor anchoring

- **Date:** 2026-06-22
- **Status:** Approved (design)
- **Area:** Frontend AI panel (`src/components/app/ai-panel.tsx`) + AI lib (`src/lib/ai/*`) + view store

## Problem

The AI panel today does three things the author dislikes:

1. **Auto-inference.** Every generating tab (Suggest, Critique, Continuity, Cast) fires a model
   call automatically — on mount via the `useAi` hook, and again whenever `suggestNonce` /
   `activeChapterId` change. Opening a tab or moving the cursor silently spends a model call.
2. **No editorial control.** Suggest is pure zero-shot: it asks `gpt-5.4-nano` for three
   continuations with no way for the author to steer the direction. Zero-shot output is weak.
3. **No sense of place.** The panel never shows *where* the model thinks the cursor is, so the
   author can't tell what "continue from here" will actually continue from.

## Goals

- Nothing calls the model until the author explicitly clicks **Generate** (or sends a Brainstorm
  message / runs "Clean up", which already require a click). Applies to all AI screens.
- The author can type an optional free-text instruction ("more tension", "have her lie") on every
  generating tab, giving editorial control over the request.
- The panel shows a persistent "you are here" anchor with the first words of the selected block.
- Continuations read context **up to the cursor** and generate **from the cursor** — already the
  case in code; preserve it and make it legible.

## Non-goals

- No character-level caret. The cursor is the **selected block** (`selectedId`), matching the
  app's block model. ("First words of the block I've selected" confirms block granularity.)
- No change to the **scene prose** sent (still blocks up to & including the selected block) or to
  *where* a suggestion inserts (still after the selected block). The grounding does gain an
  optional `AUTHOR'S REQUEST` block and a richer `cursorSummary` — that is the point of the work.
- No new test framework, no Rust changes, no change to the model or provider plumbing.

## Decisions

- **Cursor unit:** block-level (selected block).
- **Ask box scope:** all four generating tabs (Suggest, Critique, Continuity, Cast).
- **Button label:** generic **Generate** (sparkle icon), not tab-specific verbs.
- **Stale handling:** when the anchor changes (selected block or chapter), results **clear back to
  idle** — they do **not** auto-refetch. This preserves the old safety property ("never insert a
  stale suggestion into a new spot") without ever auto-calling the model.
- **Instruction is optional:** empty = model uses its judgment (today's behavior); filled = steered.

## Design

### 1. `useAi` → manual, idle-first hook (`ai-panel.tsx`)

Rework the existing hook so it never runs on its own:

- Initial state: `data: null`, `loading: false`, `error: null` (idle). No `useEffect` that calls
  `run()` on mount.
- Expose `run()`; it sets `loading`, awaits the op, sets `data`/`error`.
- Add a `resetKey` argument. When it changes, **clear** `data`/`error`/`loading` back to idle
  (does *not* call `run()`). Each generating tab passes a key derived from
  `` `${activeChapterId}:${selectedId}` `` so moving the cursor or switching chapters drops stale
  results.
- The op passed to `run()` reads the *current* instruction at call time (via a ref or by passing
  the op fresh), so Generate always uses what's in the ask box now.

### 2. "You are here" anchor (`ai-panel.tsx`, panel shell)

A compact strip rendered once in the panel shell, between `TabsList` and `TabsContent`, so it
shows for every tab. Reads `selectedId` + `blocks` from the project store.

- Layout: a small eyebrow ("Continuing after") + block-type label + the block's text in a
  `line-clamp-1` span inside a `min-w-0` container, so the first words show and adapt to panel
  width. **No JS truncation** (per CLAUDE.md — use Tailwind clamp utilities).
- Empty state (nothing selected / empty block): "Place your cursor in the manuscript."
- Styling: reuse the existing `font-ui text-[11px] text-mid` register and the `ai-edge`/`ai-tint`
  accent already used by `ContextLine`.

### 3. `AskBox` component + Generate (`ai-panel.tsx`)

A new shared component used at the top of Suggest, Critique, Continuity, Cast:

- A `Textarea` (small, `rows={2}`, resize-none) + a primary **Generate** button (`IconSparkles`).
- Props: `value`, `onChange`, `onGenerate`, `loading`, `placeholder`. Disabled-while-loading on
  the button; Cmd/Ctrl+Enter also triggers Generate.
- Instruction text lives in each tab's local `useState` (form state, not a store).
- Tab-specific placeholders, e.g.
  - Suggest: "Ask for a direction — e.g. more tension, have her lie (optional)"
  - Critique: "Focus the critique — e.g. pacing, dialogue (optional)"
  - Continuity: "Anything specific to check? (optional)"
  - Cast: "Anything specific about the cast? (optional)"
- The box stays visible above results so the author can refine and regenerate.

### 4. Instruction plumbing (`context.ts`, `operations.ts`, `prompts.ts`)

- `AiContext` gains `instruction?: string` (in `operations.ts`).
- Call sites build context as `{ ...buildAiContext(), instruction: instr.trim() || undefined }`.
  `buildAiContext` itself is unchanged except for the `cursorSummary` enrichment below.
- `buildGrounding` appends, when `instruction` is present, a final block:
  `AUTHOR'S REQUEST (follow this):\n${instruction}` — placed **last** so it's the freshest, most
  salient directive in the window.
- Each generating system prompt (`SUGGEST_SYSTEM`, `CRITIQUE_SYSTEM`, `CONTINUITY_SYSTEM`,
  `CAST_SYSTEM`) gets one line: *if the author included a request, honour it; otherwise use your
  judgment.*
- `cursorSummary` is enriched to include the first words of the last block (e.g. *"Cursor sits
  just after a narration block ending: '…since the funeral.'"*) so the model knows exactly where
  the prose leaves off — mirrors the UI anchor.

### 5. Triggers stop inferring (`view-store.ts`, `block.tsx`, `editor.tsx`)

- `triggerSuggest` no longer bumps a run-nonce. It opens the panel, sets `aiTab: 'suggest'`,
  and bumps a **focus tick** (rename `suggestNonce` → `suggestFocusTick`, comment updated) that
  the Suggest tab watches to focus its ask textarea. No model call.
- The editor "Suggest from context" button and each block's ✨ spark: `select(block.id)` then
  `triggerSuggest()` — unchanged calls, new (inert) effect. Cursor lands in the ask box, ready.

### 6. Per-tab state machine

Each generating tab renders: **anchor (shell)** → **AskBox** → one of:

- **idle** (default on open): short hint, e.g. "Click Generate to read up to your cursor and
  suggest where the scene goes next."
- **loading:** existing `LoadingLines` skeleton.
- **error:** existing `AiError`; its retry calls `run()` with the current instruction.
- **data:** existing result rendering (Suggest variants/insert, Critique notes, Continuity flags,
  Cast rows) unchanged. Suggest's "Try again" calls `run()` (same as Generate).

Brainstorm is unchanged (already explicit send; anchor strip still shows above it).

## Data flow (Suggest example, after)

1. Author clicks ✨ on a block → `select(block.id)` + `triggerSuggest()` → panel opens on Suggest,
   ask box focused. **No model call.**
2. Author types "have her finally admit it" (or leaves it blank) and clicks **Generate**.
3. `run()` calls `suggestContinuation({ ...buildAiContext(), instruction })`.
4. `buildGrounding` emits chapter/cast/cursor/scene + `AUTHOR'S REQUEST` block.
5. Results render below the ask box. If the author now clicks a different block, the Suggest
   results clear to idle (resetKey changed) so "Insert below" can't drop a stale line.

## Edge cases

- **No block selected:** anchor shows the placeholder; Generate still works (context falls back to
  whole-chapter as `buildAiContext` already does when `selectedId` is unset) — acceptable.
- **Instruction whitespace-only:** treated as empty (`.trim() || undefined`).
- **Chapter switch mid-results:** resetKey changes → clear to idle (no auto-refetch).
- **Rapid Generate clicks:** button disabled while `loading`.

## Verification

- `just typecheck` green (strict, `noUnusedLocals`/`noUnusedParameters`).
- Manual pass in `just run`: confirm (a) opening any tab makes **no** network call until Generate,
  (b) the anchor tracks the selected block, (c) an instruction visibly steers Suggest output,
  (d) moving the cursor clears results to idle.
- No test runner exists in the project. The only pure logic is `buildGrounding` (instruction
  branch) and the anchor first-words derivation; a small vitest could cover them but is **out of
  scope** unless requested.

## Out of scope

- Character-level caret / mid-block insertion.
- Multi-chapter context.
- Persisting instructions across sessions.
- Adding a test framework.
