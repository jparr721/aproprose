# Editable Inline Manuscript Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review every pending manuscript proposal in context inside the editor, allow rewrite and insert text to be edited before acceptance, and correct unreadable added-text contrast in every theme.

**Architecture:** Keep `useAgentConsoleStore.pendingProposal` canonical and keep the live chapter untouched until acceptance. Add one strict proposal-text mutation, project the live block stream plus proposal into typed read-only review rows, and render those rows through an ephemeral editor review mode. Move proposal decisions behind shared functions so the inline editor and compact sidebar use the existing validated project-store apply path.

**Tech Stack:** React 19, TypeScript 5.8 strict mode, Zustand 5, Tailwind CSS 4 semantic tokens, shadcn-style primitives, Vitest 4, Testing Library, Vite 7, Tauri 2.

## Global Constraints

- Follow the approved design in `docs/superpowers/specs/2026-08-01-editable-inline-manuscript-review-design.md`.
- Fix the addition-color defect first in a standalone test-first bug commit.
- Do not mutate `useProjectStore.blocks`, dirty state, compile input, save output, or editor history while proposal text is edited.
- Keep `useAgentConsoleStore.pendingProposal` as the only canonical proposal state.
- Preserve the existing source preconditions, stale validation, atomic apply behavior, event recording, persistence, and one-step undo behavior.
- Keep remove and move proposals structurally fixed. Only rewrite and insert `newText` may be edited.
- Keep outline proposal review behavior unchanged.
- Keep review view state ephemeral and exclude it from persisted view state.
- Use semantic color tokens and existing typography and UI primitives. Do not add literal colors, inline styles, or dependencies.
- Use the keybinding registry and `data-capture-keyboard`; do not add raw window keyboard listeners.
- Use test-first changes and run focused tests before each implementation step.
- Use ASCII punctuation in all new or changed source, tests, and documentation.
- Preserve unrelated working-tree changes. At plan creation time these files are modified outside this work: `src/components/app/agent-console/agent-message.test.tsx`, `src/components/app/agent-console/agent-message.tsx`, `src/lib/ai/agent-controller.ts`, `src/lib/ai/agent-messages.test.ts`, `src/lib/ai/agent-messages.ts`, `src/lib/ai/agent-runtime.test.ts`, and `src/lib/ai/agent-runtime.ts`.
- Inspect `git diff` before every commit and stage only the paths named by that task. The controller task overlaps an existing modified file, so merge into its current contents and never replace the file wholesale.

---

## File Structure

### Files created

- `src/components/app/agent-console/diff-preview.test.tsx` - Regression coverage for readable addition, deletion, and baseline diff styles.
- `src/lib/ai/proposal-decisions.ts` - Shared validation, accept, reject, event, toast, and outline-undo behavior.
- `src/lib/ai/proposal-decisions.test.ts` - Decision behavior for both proposal kinds, stale failures, ownership, and final cleanup.
- `src/lib/ai/manuscript-review-projection.ts` - Pure projection from live blocks and one pending manuscript proposal to typed editor rows.
- `src/lib/ai/manuscript-review-projection.test.ts` - Projection coverage for every kind, ordering, stale sources, and input immutability.
- `src/components/app/manuscript-review/manuscript-review-header.tsx` - Sticky proposal summary, navigation, batch decisions, and close control.
- `src/components/app/manuscript-review/manuscript-review-change.tsx` - Type-aware changed-row rendering and rewrite or insert editing.
- `src/components/app/manuscript-review/manuscript-review-surface.tsx` - Projection orchestration, local navigation, and proposal decision wiring.
- `src/components/app/manuscript-review/manuscript-review-surface.test.tsx` - Inline review rendering, editing, stale, navigation, and decision coverage.

### Files modified

- `src/components/app/agent-console/diff-preview.tsx` - Let added text inherit normal foreground on a success tint.
- `src/stores/agent-console-store.ts` - Add the strict canonical proposal-text edit action and error.
- `src/stores/agent-console-store.test.ts` - Prove allowed edits, rejected edits, ownership, and project-state isolation.
- `src/stores/agent-persistence.test.ts` - Prove edited proposal text survives snapshot serialization and restoration.
- `src/components/app/agent-console/review-tray.tsx` - Use shared decisions and render manuscript proposals as a compact summary.
- `src/components/app/agent-console/review-tray.test.tsx` - Cover compact manuscript behavior and unchanged outline review.
- `src/stores/view-store.ts` - Own the ephemeral reviewed proposal ID and open or close actions.
- `src/stores/view-store.test.ts` - Prove lifecycle, mutual exclusion with outline, and persistence exclusion.
- `src/lib/ai/agent-controller.ts` - Auto-open a newly staged manuscript proposal only for the active target chapter.
- `src/lib/ai/agent-controller.test.ts` - Cover automatic open, inactive target, outline replacement, and replacement cleanup.
- `src/stores/agent-persistence.ts` - Close editor review as soon as a project transition starts.
- `src/stores/agent-persistence.test.ts` - Cover review cleanup on project switch and close.
- `src/lib/ai/agent-navigation.ts` - Add guarded navigation that opens a manuscript proposal in the editor.
- `src/lib/ai/agent-navigation.test.ts` - Cover same-chapter, guarded cross-chapter, canceled, stale, and failed navigation.
- `src/components/app/auto-textarea.tsx` - Forward an accessible label to proposal textareas.
- `src/components/app/auto-textarea.test.tsx` - Cover the forwarded textarea label.
- `src/components/app/editor.tsx` - Swap the authoring stream for inline review when the active proposal ID matches.
- `src/components/app/editor.test.tsx` - Prove review activation locks authoring and close restores normal editing.

### Files deleted

- `src/components/app/agent-console/manuscript-review.tsx` - Sidebar manuscript cards superseded by inline editor review.
- `src/components/app/agent-console/manuscript-review.test.tsx` - Coverage replaced by projection, surface, editor, and tray tests.

---

### Task 1: Correct added-text contrast as a standalone bug fix

**Files:**
- Create: `src/components/app/agent-console/diff-preview.test.tsx`
- Modify: `src/components/app/agent-console/diff-preview.tsx:4-32`

**Interfaces:**
- Consumes: `diffWords(before, after)` and semantic theme utilities.
- Produces: additions with `bg-success/10` and inherited foreground, deletions with the existing destructive treatment, and unchanged text with inherited foreground.

- [ ] **Step 1: Add the failing contrast regression test**

Create `src/components/app/agent-console/diff-preview.test.tsx`:

```tsx
// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentDiffPreview } from "@/components/app/agent-console/diff-preview";

afterEach(() => cleanup());

describe("AgentDiffPreview", () => {
  it("uses a success tint without a solid-success foreground token", () => {
    render(
      <AgentDiffPreview
        before="The harbor slept."
        after="The harbor shone."
      />,
    );

    const addition = screen.getByText("shone.");
    expect(addition.tagName).toBe("INS");
    expect(addition.className).toContain("bg-success/10");
    expect(addition.className).not.toContain("text-success-foreground");
    expect(addition.className).not.toContain("text-success");

    const deletion = screen.getByText("slept.");
    expect(deletion.tagName).toBe("DEL");
    expect(deletion.className).toContain("bg-destructive/10");
    expect(deletion.className).toContain("text-destructive");
  });
});
```

- [ ] **Step 2: Run the focused test and verify the bug exists**

Run:

```bash
bun x vitest run src/components/app/agent-console/diff-preview.test.tsx
```

Expected: FAIL because the addition still contains `text-success-foreground`.

- [ ] **Step 3: Remove the inappropriate foreground token**

In `src/components/app/agent-console/diff-preview.tsx`, change the addition class to:

```tsx
className="bg-success/10 no-underline"
```

Do not change the deletion branch or add `text-success`.

- [ ] **Step 4: Re-run focused and neighboring tests**

Run:

```bash
bun x vitest run src/components/app/agent-console/diff-preview.test.tsx src/components/app/agent-console/manuscript-review.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit only the bug fix**

Run:

```bash
git diff -- src/components/app/agent-console/diff-preview.tsx src/components/app/agent-console/diff-preview.test.tsx
git add src/components/app/agent-console/diff-preview.tsx src/components/app/agent-console/diff-preview.test.tsx
git commit -m "fix: correct proposal addition contrast"
```

---

### Task 2: Add strict canonical editing for proposal text

**Files:**
- Modify: `src/stores/agent-console-store.ts:73-120,735-765`
- Modify: `src/stores/agent-console-store.test.ts:742-777`
- Modify: `src/stores/agent-persistence.test.ts:1260-1310`

**Interfaces:**
- Consumes: one owned manuscript proposal, its proposal ID, its change ID, and a string value.
- Produces: `updatePendingManuscriptText(edit: PendingManuscriptTextEdit): void` and explicit `PendingProposalEditError` failures.

- [ ] **Step 1: Add failing store tests for editable and fixed kinds**

Add fixtures for one rewrite, insert, remove, move, and outline change. Add tests that call this planned API:

```ts
store.updatePendingManuscriptText({
  proposalId: "proposal-1",
  changeId: "rewrite-1",
  newText: "The rain softened against the glass.",
});

const pending = useAgentConsoleStore.getState().pendingProposal;
if (pending === null || pending.kind !== "manuscript") {
  throw new Error("Expected an editable manuscript proposal.");
}
expect(pending.changes[0].change.newText).toBe(
  "The rain softened against the glass.",
);
expect(pending.changes[0].precondition).toBe(originalPrecondition);
```

Cover these exact cases:

- A rewrite updates only its `newText`.
- An insert updates only its `newText`, including the empty string.
- Remove and move edits throw `PendingProposalEditError` with code `change-not-editable`.
- An outline proposal throws code `wrong-kind`.
- A mismatched proposal ID throws code `proposal-mismatch`.
- A missing change ID throws code `change-missing`.
- A transition or unavailable ownership state throws the existing ownership error before any mutation.
- Every failure leaves the pending proposal deeply equal to its prior value.

- [ ] **Step 2: Run the store test and verify the API is missing**

Run:

```bash
bun x vitest run src/stores/agent-console-store.test.ts
```

Expected: FAIL because `updatePendingManuscriptText` does not exist.

- [ ] **Step 3: Define the edit contract and explicit error**

Add these exports near the other agent-console store contracts:

```ts
export interface PendingManuscriptTextEdit {
  proposalId: string;
  changeId: string;
  newText: string;
}

export type PendingProposalEditErrorCode =
  | "proposal-mismatch"
  | "wrong-kind"
  | "change-missing"
  | "change-not-editable";

export class PendingProposalEditError extends Error {
  readonly code: PendingProposalEditErrorCode;

  constructor(code: PendingProposalEditErrorCode, message: string) {
    super(message);
    this.name = "PendingProposalEditError";
    this.code = code;
  }
}
```

Add this state action:

```ts
updatePendingManuscriptText: (edit: PendingManuscriptTextEdit) => void;
```

- [ ] **Step 4: Implement the immutable proposal edit at the store boundary**

Inside the action:

1. Call `requireDraftMutationOwnership(state)` first.
2. Require a non-null proposal whose ID matches `edit.proposalId`.
3. Require `proposal.kind === "manuscript"`.
4. Find exactly one change with `edit.changeId`.
5. Require `change.kind` to be `rewrite` or `insert` and require its existing `newText` to be non-null.
6. Build a new `ManuscriptPendingChange` with every field copied explicitly and only `change.newText` replaced.
7. Build a new `ManuscriptPendingProposal` with every envelope field copied explicitly and the updated changes array.
8. Return only `{ pendingProposal: updatedProposal }`.

Use a single-purpose pure helper with this signature:

```ts
function editPendingManuscriptChange(
  item: ManuscriptPendingChange,
  edit: PendingManuscriptTextEdit,
): ManuscriptPendingChange
```

Do not alter the precondition, reason, structural fields, summary, creation metadata, draft revision, messages, or project store.

- [ ] **Step 5: Add the project-state isolation test**

Capture the live authoring state before the edit:

```ts
const projectBefore = useProjectStore.getState();
const blocksBefore = projectBefore.blocks;
const pastBefore = projectBefore.past;
const futureBefore = projectBefore.future;
const dirtyBefore = projectBefore.chapterDirty;
```

After editing a staged rewrite, assert reference equality for `blocks`, `past`, and `future`, and assert `chapterDirty` remains `dirtyBefore`. This proves compile and save inputs remain the live block stream and no editor history entry was created.

- [ ] **Step 6: Add the failing persistence round-trip test**

In `src/stores/agent-persistence.test.ts`, stage a manuscript proposal, edit its rewrite, call `toAgentSnapshot()`, then call `fromAgentSnapshot("/book", snapshot)`. Assert the restored `newText` is the edited value and the restored `projectRoot` is `/book`.

Run:

```bash
bun x vitest run src/stores/agent-persistence.test.ts -t "edited proposal text"
```

Expected before the store action is complete: FAIL. Expected after the action is complete: PASS without a persistence schema change because pending proposal changes are already serialized.

- [ ] **Step 7: Run focused store and persistence tests**

Run:

```bash
bun x vitest run src/stores/agent-console-store.test.ts src/stores/agent-persistence.test.ts
just typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit the canonical proposal edit**

Run:

```bash
git diff -- src/stores/agent-console-store.ts src/stores/agent-console-store.test.ts src/stores/agent-persistence.test.ts
git add src/stores/agent-console-store.ts src/stores/agent-console-store.test.ts src/stores/agent-persistence.test.ts
git commit -m "feat: edit staged manuscript text"
```

---

### Task 3: Extract shared proposal decisions without changing behavior

**Files:**
- Create: `src/lib/ai/proposal-decisions.ts`
- Create: `src/lib/ai/proposal-decisions.test.ts`
- Modify: `src/components/app/agent-console/review-tray.tsx:28-261`
- Modify: `src/components/app/agent-console/review-tray.test.tsx`

**Interfaces:**
- Consumes: a canonical `PendingProposal`, optional selected change ID, the current project store, and agent-console ownership.
- Produces: shared stale IDs and five decision functions used by every proposal review surface.

- [ ] **Step 1: Add failing direct decision tests**

Create tests for these exports:

```ts
proposalStaleChangeIds(proposal: PendingProposal): Set<string>
acceptProposalChange(proposal: PendingProposal, changeId: string): void
acceptAllProposalChanges(proposal: PendingProposal): void
rejectProposalChange(proposal: PendingProposal, changeId: string): void
rejectAllProposalChanges(proposal: PendingProposal): void
```

Move the proposal and project fixtures from `review-tray.test.tsx` only when they are reusable without rendering. Cover:

- Manuscript Accept applies only the selected change, removes it from pending state, and records `accepted` with count 1.
- Manuscript Accept All applies every change atomically, clears pending state, and records `accepted-all` with the original count.
- Reject one writes no manuscript state, removes only that change, and records `rejected`.
- Reject All writes no manuscript state, clears pending state, and records `rejected-all`.
- Stale or invalid application keeps the proposal and emits the existing actionable toast.
- An unknown change ID raises an explicit error and performs no write.
- Outline Accept still exposes the existing Undo toast and calls `undoAgentOutlineProposal` from its action.
- Ownership validation occurs before all decisions.
- `proposalStaleChangeIds` covers missing project, wrong root, inactive manuscript chapter, changed manuscript source, and changed outline source.

- [ ] **Step 2: Run the direct test and verify the module is missing**

Run:

```bash
bun x vitest run src/lib/ai/proposal-decisions.test.ts
```

Expected: FAIL because the shared module does not exist.

- [ ] **Step 3: Move current decision behavior into the shared module**

Move these responsibilities from `review-tray.tsx` without changing strings or order of effects:

- `eventText`
- `proposalEvent`
- `showOutlineUndo`
- `showProposalApplyFailure`
- `proposalStaleIds`, renamed `proposalStaleChangeIds`
- Individual and batch Accept behavior
- Individual and batch Reject behavior

Each Accept function must apply successfully before removing pending changes or recording an event. Each Reject function must validate ownership and change identity before changing pending state. Keep outline and manuscript branches exhaustive.

- [ ] **Step 4: Replace tray-local closures with shared calls**

In `ReviewTray`, keep reactive subscriptions for project blocks, metadata, active chapter, and ownership so stale and disabled states re-render. Replace local decision implementations with calls such as:

```tsx
onClick={() => acceptAllProposalChanges(proposal)}
```

Keep navigation and the current manuscript or outline presentation unchanged in this task. The purpose of this commit is extraction only.

- [ ] **Step 5: Run direct and tray regression tests**

Run:

```bash
bun x vitest run src/lib/ai/proposal-decisions.test.ts src/components/app/agent-console/review-tray.test.tsx
just typecheck
```

Expected: PASS with no visible behavior change.

- [ ] **Step 6: Commit the shared decision layer**

Run:

```bash
git diff -- src/lib/ai/proposal-decisions.ts src/lib/ai/proposal-decisions.test.ts src/components/app/agent-console/review-tray.tsx src/components/app/agent-console/review-tray.test.tsx
git add src/lib/ai/proposal-decisions.ts src/lib/ai/proposal-decisions.test.ts src/components/app/agent-console/review-tray.tsx src/components/app/agent-console/review-tray.test.tsx
git commit -m "refactor: share proposal decisions"
```

---

### Task 4: Build the pure manuscript review projection

**Files:**
- Create: `src/lib/ai/manuscript-review-projection.ts`
- Create: `src/lib/ai/manuscript-review-projection.test.ts`

**Interfaces:**
- Consumes: ordered live `Block[]` and one `ManuscriptPendingProposal`.
- Produces: typed review rows, one navigation order, and validated stale change IDs without changing either input.

- [ ] **Step 1: Define failing tests around the row contract**

Write tests against this public shape:

```ts
export type ManuscriptReviewRow =
  | ManuscriptUnchangedRow
  | ManuscriptRewriteRow
  | ManuscriptInsertRow
  | ManuscriptRemoveRow
  | ManuscriptMoveSourceRow
  | ManuscriptMoveDestinationRow
  | ManuscriptStaleRow;

export interface ManuscriptReviewProjection {
  rows: ManuscriptReviewRow[];
  navigationChangeIds: string[];
  staleChangeIds: Set<string>;
}

export function projectManuscriptReview(
  blocks: Block[],
  proposal: ManuscriptPendingProposal,
): ManuscriptReviewProjection
```

Every row interface must include a stable `key` and a literal `kind`. Changed rows must include `changeId`, the complete `ManuscriptPendingChange`, and the exact display data needed by the renderer. Use these row-specific contracts:

```ts
export interface ManuscriptUnchangedRow {
  kind: "unchanged";
  key: string;
  block: Block;
}

export interface ManuscriptRewriteRow {
  kind: "rewrite";
  key: string;
  changeId: string;
  source: Block;
  beforeText: string;
  change: ManuscriptPendingChange;
}

export interface ManuscriptInsertRow {
  kind: "insert";
  key: string;
  changeId: string;
  afterId: string | null;
  change: ManuscriptPendingChange;
}

export interface ManuscriptRemoveRow {
  kind: "remove";
  key: string;
  changeId: string;
  source: Block;
  change: ManuscriptPendingChange;
}

export interface ManuscriptMoveSourceRow {
  kind: "move-source";
  key: string;
  changeId: string;
  source: Block;
  change: ManuscriptPendingChange;
}

export interface ManuscriptMoveDestinationRow {
  kind: "move-destination";
  key: string;
  changeId: string;
  source: Block;
  destinationIndex: number;
  change: ManuscriptPendingChange;
}

export interface ManuscriptStaleRow {
  kind: "stale";
  key: string;
  changeId: string;
  sourceType: string;
  frozenText: string;
  frozenOrder: number;
  change: ManuscriptPendingChange;
}
```

- [ ] **Step 2: Cover every single-kind projection before implementation**

Use three distinct live blocks and assert exact row kind and key sequences for:

- No changes: one `unchanged` row per live block.
- Rewrite: the target slot becomes one `rewrite` row with frozen before text and edited `newText` available through the change.
- Insert after a live block: the insert follows that block.
- Insert with `afterId: null`: the insert is at chapter end, matching `applyProposal`.
- Remove: the source slot becomes a `remove` row instead of disappearing.
- Move: a `move-source` marker stays at the original slot and one `move-destination` decision row appears at the clamped destination.
- Stale rewrite, insert, remove, and move: each produces a frozen `stale` row at locator order and does not transform live content.

Assert `navigationChangeIds` contains each change exactly once. For move, navigation must point to the destination decision row rather than the source marker.

- [ ] **Step 3: Cover mixed ordering and immutability**

Add exact sequence assertions for:

- Two inserts with the same anchor remain in proposal order.
- A rewrite followed by an insert at that rewritten target.
- A remove followed by an insert at the removed block boundary.
- A move to index 0 and a move beyond chapter length, each clamped like `applyProposal`.
- A mixed rewrite, insert, remove, and move proposal.
- One stale change among fresh changes leaves the fresh projection intact.
- `blocks`, every block object, `proposal`, every proposal change, and every precondition remain deeply equal to structured clones captured before projection.
- No projected row uses `uid()` or produces an ID that can be mistaken for a persisted block ID.

- [ ] **Step 4: Run the projection tests and verify the module is missing**

Run:

```bash
bun x vitest run src/lib/ai/manuscript-review-projection.test.ts
```

Expected: FAIL because the projection module does not exist.

- [ ] **Step 5: Implement validation and materialization through existing proposal logic**

Inside `projectManuscriptReview`:

1. Call `validateManuscriptChanges(proposal, blocks)` and create the stale ID set.
2. Call `materializeManuscriptChanges` only for fresh IDs so locator resolution stays identical to acceptance.
3. Pair materialized changes back to their pending change IDs in proposal order.
4. Use an internal virtual content list whose nodes reference existing live blocks or pending insert and move changes.
5. Track source annotations separately so remove and move markers remain at their original live positions without affecting destination index arithmetic.
6. Preserve the same last-insert-per-anchor rule used by `applyProposal`.
7. Clamp move destinations with `Math.max(0, Math.min(toIndex, remaining.length))`.
8. Merge annotations and virtual content into a new rows array.
9. Derive navigation order from rendered decision rows. A move source marker is not a decision row.
10. Return new arrays and sets only. Never mutate an input object or call a store.

Use exhaustive `switch` branches and a `never` assertion for unhandled change kinds. Do not create a generic row with optional fields.

- [ ] **Step 6: Run focused projection and apply-order tests**

Run:

```bash
bun x vitest run src/lib/ai/manuscript-review-projection.test.ts src/lib/blocks/proposal.test.ts src/lib/ai/agent-proposals.test.ts
just typecheck
```

Expected: PASS and identical ordering between preview and apply behavior.

- [ ] **Step 7: Commit the pure projection**

Run:

```bash
git diff -- src/lib/ai/manuscript-review-projection.ts src/lib/ai/manuscript-review-projection.test.ts
git add src/lib/ai/manuscript-review-projection.ts src/lib/ai/manuscript-review-projection.test.ts
git commit -m "feat: project manuscript proposals inline"
```

---

### Task 5: Add ephemeral review lifecycle and guarded navigation

**Files:**
- Modify: `src/stores/view-store.ts:30-119`
- Modify: `src/stores/view-store.test.ts:16-181`
- Modify: `src/lib/ai/agent-controller.ts:1192-1195`
- Modify: `src/lib/ai/agent-controller.test.ts`
- Modify: `src/stores/agent-persistence.ts:1326-1357`
- Modify: `src/stores/agent-persistence.test.ts`
- Modify: `src/lib/ai/agent-navigation.ts:1-225`
- Modify: `src/lib/ai/agent-navigation.test.ts:406-700`
- Modify: `src/lib/ai/proposal-decisions.ts`
- Modify: `src/lib/ai/proposal-decisions.test.ts`

**Interfaces:**
- Consumes: a proposal ID, current pending proposal identity, project root, active chapter, and the existing dirty-chapter guard.
- Produces: ephemeral review open or close actions, automatic entry for active targets, guarded explicit entry for inactive targets, and cleanup on final decision or project transition.

- [ ] **Step 1: Add failing view-store lifecycle tests**

Extend `ViewState` through tests for this API:

```ts
manuscriptReviewProposalId: string | null;
openManuscriptReview: (proposalId: string) => void;
closeManuscriptReview: () => void;
```

Test these exact outcomes:

- Initial value is null.
- `openManuscriptReview("proposal-1")` stores the ID, closes `outlineOpen`, clears `focus`, and leaves AI and PDF visibility unchanged.
- `closeManuscriptReview()` clears only the ID.
- `openOutline()` and opening the outline through its toggle clear a manuscript review ID because the outline replaces the editor.
- `partialize` excludes `manuscriptReviewProposalId` and both actions.
- Persisted layout hydration never restores an unknown manuscript review ID.

- [ ] **Step 2: Run the view-store tests and verify the fields are missing**

Run:

```bash
bun x vitest run src/stores/view-store.test.ts src/stores/view-store.outline.test.ts
```

Expected: FAIL because the review lifecycle API does not exist.

- [ ] **Step 3: Implement the ephemeral state**

Add the nullable ID beside other ephemeral fields and add explicit actions:

```ts
openManuscriptReview: (proposalId) =>
  set({
    manuscriptReviewProposalId: proposalId,
    outlineOpen: false,
    focus: false,
  }),
closeManuscriptReview: () => set({ manuscriptReviewProposalId: null }),
```

Update `toggleOutline` and `openOutline` to clear the review ID whenever they open the outline. Do not add the ID to `persistedViewStateSchema`, `partialize`, or the persisted merge.

- [ ] **Step 4: Add failing controller staging tests**

In `agent-controller.test.ts`, exercise the captured tool environment's `replacePendingProposal` and assert:

- A manuscript proposal for the current project and active chapter opens its own ID.
- A manuscript proposal for another chapter remains pending but does not open review.
- An outline proposal closes an existing manuscript review.
- Replacing one manuscript proposal with another closes the old ID before optionally opening the new active proposal.
- A late proposal from a run that no longer owns the console changes neither pending state nor review state.

Reset `useViewStore` in the relevant test setup.

- [ ] **Step 5: Merge automatic entry into the current controller implementation**

In the existing `replacePendingProposal` environment callback:

1. Keep the current `ownsRun` guard first.
2. Close any prior manuscript review.
3. Replace the canonical pending proposal.
4. Read `useProjectStore.getState()` after replacement.
5. Open review only when the proposal is manuscript, project roots match, and `activeChapterId === proposal.chapterId`.

Do not overwrite unrelated uncommitted changes already present in `agent-controller.ts`. Patch only this callback and required imports.

- [ ] **Step 6: Add failing guarded navigation tests**

Add this public function:

```ts
export async function openManuscriptProposalInEditor(
  proposal: ManuscriptPendingProposal,
): Promise<boolean>
```

Test:

- Same active chapter opens review immediately and returns true.
- Another chapter uses `useViewStore.requestGuarded`, selects the chapter, then opens review.
- Canceling the dirty guard returns false and leaves review closed.
- Missing project, wrong root, missing chapter, failed chapter selection, or a pending proposal ID that changed during navigation returns false.
- Successful navigation schedules the first projected decision row to scroll into view.

The function must re-read pending proposal and project state after asynchronous chapter selection before opening review. It must never open a stale or replaced proposal.

- [ ] **Step 7: Implement guarded editor entry**

Reuse the current guarded chapter-selection pattern in `navigateToProposalChange`. Keep the proposal object as the correlation token. After navigation succeeds, require all of these again:

- Pending proposal is non-null.
- Pending proposal kind is manuscript.
- Pending proposal ID equals `proposal.id`.
- Current project root equals `proposal.projectRoot`.
- Active chapter equals `proposal.chapterId`.

Then call `openManuscriptReview(proposal.id)` and schedule a scroll for the first proposal change using a stable review data attribute.

- [ ] **Step 8: Close review on final decisions and project transitions**

Extend direct decision tests so accepting or rejecting the final manuscript change clears `manuscriptReviewProposalId`. Removing one of multiple changes keeps review open. Outline decisions must not open manuscript review.

At the start of `transitionAgentProject`, close manuscript review synchronously before queued persistence work. Add tests for switching roots and closing the project. Keep the pending proposal persistence behavior unchanged.

- [ ] **Step 9: Run focused lifecycle tests**

Run:

```bash
bun x vitest run src/stores/view-store.test.ts src/stores/view-store.outline.test.ts src/lib/ai/agent-controller.test.ts src/lib/ai/agent-navigation.test.ts src/lib/ai/proposal-decisions.test.ts src/stores/agent-persistence.test.ts
just typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit lifecycle and navigation**

Inspect the overlapping controller diff first, then stage exact files. If the pre-existing controller changes are still uncommitted, use patch staging for that file and stage only the import and proposal-replacement hunks from this task:

```bash
git diff -- src/stores/view-store.ts src/stores/view-store.test.ts src/lib/ai/agent-controller.ts src/lib/ai/agent-controller.test.ts src/stores/agent-persistence.ts src/stores/agent-persistence.test.ts src/lib/ai/agent-navigation.ts src/lib/ai/agent-navigation.test.ts src/lib/ai/proposal-decisions.ts src/lib/ai/proposal-decisions.test.ts
git add src/stores/view-store.ts src/stores/view-store.test.ts src/lib/ai/agent-controller.test.ts src/stores/agent-persistence.ts src/stores/agent-persistence.test.ts src/lib/ai/agent-navigation.ts src/lib/ai/agent-navigation.test.ts src/lib/ai/proposal-decisions.ts src/lib/ai/proposal-decisions.test.ts
git add -p src/lib/ai/agent-controller.ts
git diff --cached -- src/lib/ai/agent-controller.ts
git commit -m "feat: manage manuscript review lifecycle"
```

The cached controller diff must contain only this task's import and `replacePendingProposal` changes. Leave every other controller hunk unstaged.

---

### Task 6: Build the inline review surface

**Files:**
- Modify: `src/components/app/auto-textarea.tsx:17-88`
- Modify: `src/components/app/auto-textarea.test.tsx`
- Create: `src/components/app/manuscript-review/manuscript-review-header.tsx`
- Create: `src/components/app/manuscript-review/manuscript-review-change.tsx`
- Create: `src/components/app/manuscript-review/manuscript-review-surface.tsx`
- Create: `src/components/app/manuscript-review/manuscript-review-surface.test.tsx`

**Interfaces:**
- Consumes: an active manuscript proposal, live blocks, project characters, ownership status, the projection, canonical text-edit action, and shared decision functions.
- Produces: a read-only chapter stream with editable rewrite and insert text, fixed structural proposals, stale handling, sticky controls, and inline navigation.

- [ ] **Step 1: Add a failing accessible-label test to AutoGrowTextarea**

Extend the component contract with:

```ts
ariaLabel?: string;
```

Add a test that renders `AutoGrowTextarea` with `ariaLabel="Edit proposed rewrite"` and asserts `screen.getByRole("textbox", { name: "Edit proposed rewrite" })` resolves the inner textarea.

Run:

```bash
bun x vitest run src/components/app/auto-textarea.test.tsx
```

Expected: FAIL because the prop is not accepted or forwarded.

- [ ] **Step 2: Forward the accessible name without changing layout**

Destructure `ariaLabel`, add it to the prop type, and set this attribute on the existing textarea:

```tsx
aria-label={ariaLabel}
```

Do not set `proseBody` for proposal editors. Re-run the test and expect PASS.

- [ ] **Step 3: Add failing header tests through the surface test**

Create `manuscript-review-surface.test.tsx` with a happy-dom environment and reset all three stores in `beforeEach`. Render a proposal containing rewrite, insert, remove, and move changes. Assert the header exposes:

- Proposal summary.
- `4 changes`.
- `Previous change` and `Next change` accessible names.
- `Accept All`, `Reject All`, and `Close Review`.
- A card primitive through `data-slot="card"`, `data-slot="card-header"`, and `data-slot="card-content"`.
- Sticky positioning through the semantic class `sticky`.

Assert Previous is disabled on the first decision row, Next advances to the second decision row, and the active row receives `data-active-review-change="true"`. Mock `HTMLElement.prototype.scrollIntoView` and assert it is called with `block: "center"`.

- [ ] **Step 4: Implement the small header component**

Use this strict prop contract:

```ts
export interface ManuscriptReviewHeaderProps {
  summary: string;
  remaining: number;
  previousDisabled: boolean;
  nextDisabled: boolean;
  acceptAllDisabled: boolean;
  decisionsDisabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClose: () => void;
}
```

Build the raised surface from `Card`, `CardHeader`, `CardTitle`, `CardContent`, `TypographyEyebrow`, `TypographyMuted`, and stock `Button` variants. Keep the header compact, sticky, and below the chapter heading. Use Tabler arrow, check, and close icons. Do not add custom colors or an inline style.

- [ ] **Step 5: Add failing read-only and change-kind rendering tests**

Assert the projected stream renders:

- Every unchanged block text in original type-aware presentation.
- One row with `data-review-row-kind="rewrite"` at the target location.
- One row with `data-review-row-kind="insert"` after its anchor.
- One row with `data-review-row-kind="remove"` at the source location.
- One `move-source` marker at the original location and one `move-destination` decision row at the destination.
- Change kind, reason, and position labels through typography components.
- Accept and Reject only at decision rows. A move source marker has no duplicate decision controls.
- No drag handle, block selection control, add-block control, or authoring textarea for unchanged blocks.

Use stable attributes:

```text
data-agent-change-id
data-agent-decision-change-id
data-review-row-kind
data-active-review-change
```

The destination row owns `data-agent-decision-change-id` for a move. Every changed row may expose `data-agent-change-id` for diagnostics.

- [ ] **Step 6: Implement type-aware changed rows with semantic tokens**

Use a discriminated `switch` over `ManuscriptReviewRow.kind`:

- `unchanged`: render `BlockBody` with `editing={false}`, the resolved speaker, and `hit={null}` inside a non-interactive block-width wrapper.
- `rewrite`: render `AgentDiffPreview` from frozen source text to current `newText` by default.
- `insert`: render an always-editable `AutoGrowTextarea` for primary text, plus fixed dialogue speaker and segment metadata when present.
- `remove`: render the source through `BlockBody` inside deletion semantics.
- `move-source`: render a compact source marker with the source preview and no decision controls.
- `move-destination`: render the moved source read-only at its destination with decision controls.
- `stale`: render frozen locator text, `Source changed - regenerate`, Reject, and disabled Edit or Accept controls.

Use only semantic treatment such as faint `bg-success/10` or `bg-destructive/10`, semantic borders, `bg-card`, `text-foreground`, `text-muted-foreground`, and `text-destructive`. Keep added text on inherited foreground. Do not add a theme-specific branch.

Create view-only proposal blocks with stable keys derived from proposal and change IDs. Do not call `uid()` and do not insert these blocks into project state.

- [ ] **Step 7: Add failing rewrite edit tests**

For a fresh rewrite:

1. Assert the default view contains `del` and `ins` segments from frozen and current proposal text.
2. Click `Edit proposal`.
3. Assert a textbox named `Edit proposed rewrite` contains the full current `newText`.
4. Assert the frozen original remains directly above the textbox.
5. Change the textbox value.
6. Assert `useAgentConsoleStore.pendingProposal` changed and `useProjectStore.blocks`, dirty state, past, and future did not.
7. Blur the textbox.
8. Assert the recomputed diff contains the newly added words.
9. Assert the edit wrapper has `data-capture-keyboard` and the textarea lacks the prose-body attribute.

For a stale rewrite, assert the Edit proposal control is disabled and the frozen text remains visible.

- [ ] **Step 8: Add failing insert edit tests**

For narration and dialogue inserts, assert:

- The proposal textbox is visible at rest and has name `Edit proposed insert`.
- Typing updates only the canonical proposal `newText`.
- Dialogue speaker and tail segments render read-only and do not become inputs.
- Empty text remains a valid staged value.
- A stale insert renders frozen proposal text read-only and disables acceptance.
- Native text input is isolated by a `data-capture-keyboard` ancestor.

- [ ] **Step 9: Wire text edits and individual decisions**

Use this component contract:

```ts
export interface ManuscriptReviewChangeProps {
  row: ManuscriptReviewRow;
  characters: Character[];
  disabled: boolean;
  editingRewrite: boolean;
  onBeginRewriteEdit: (changeId: string) => void;
  onEndRewriteEdit: () => void;
  onTextChange: (changeId: string, value: string) => void;
  onAccept: (changeId: string) => void;
  onReject: (changeId: string) => void;
}
```

The surface owns only transient `editingRewriteId` and active navigation state. The text change callback must call:

```ts
updatePendingManuscriptText({
  proposalId: proposal.id,
  changeId,
  newText: value,
});
```

Accept and Reject must call the shared decision functions with the current proposal read from the store, not a stale render closure. Require that the current proposal still matches the rendered proposal ID before acting.

- [ ] **Step 10: Add failing batch, stale, and revalidation tests**

Cover:

- Accept one applies the edited value and removes only that change.
- Reject one leaves manuscript state untouched and removes only that change.
- Accepting one reprojects the remaining proposal and can make a dependent source visibly stale.
- Accept All is disabled when at least one projected change is stale.
- Reject All remains enabled for stale proposals when ownership is ready.
- All decisions are disabled while ownership is not ready.
- Close Review clears only view state and preserves the entire proposal.
- Accepting or rejecting the final change removes the surface.
- Replacing the proposal resets rewrite edit state and selects the first decision in the replacement.

- [ ] **Step 11: Implement surface orchestration and navigation**

The surface must:

1. Recompute `projectManuscriptReview(blocks, proposal)` with `useMemo`.
2. Keep the active navigation change ID valid when a decision removes a row.
3. Select the first remaining decision when the prior active ID disappears.
4. Query only `[data-agent-decision-change-id]` for navigation.
5. Call `scrollIntoView({ behavior: "smooth", block: "center" })` after Previous or Next.
6. Disable Previous and Next at list ends rather than wrapping.
7. Call `acceptAllProposalChanges`, `rejectAllProposalChanges`, and `closeManuscriptReview` from the header.
8. Re-read ownership and stale state on every render.
9. Reset `editingRewriteId` and active navigation when `proposal.id` changes.

Keep the surface independent of DnD, selection, formatting, find replacement, dictation, block insertion, and project mutation callbacks.

- [ ] **Step 12: Run focused component tests and typecheck**

Run:

```bash
bun x vitest run src/components/app/auto-textarea.test.tsx src/components/app/manuscript-review/manuscript-review-surface.test.tsx src/components/app/agent-console/diff-preview.test.tsx
just typecheck
```

Expected: PASS.

- [ ] **Step 13: Commit the inline review surface**

Run:

```bash
git diff -- src/components/app/auto-textarea.tsx src/components/app/auto-textarea.test.tsx src/components/app/manuscript-review/manuscript-review-header.tsx src/components/app/manuscript-review/manuscript-review-change.tsx src/components/app/manuscript-review/manuscript-review-surface.tsx src/components/app/manuscript-review/manuscript-review-surface.test.tsx
git add src/components/app/auto-textarea.tsx src/components/app/auto-textarea.test.tsx src/components/app/manuscript-review/manuscript-review-header.tsx src/components/app/manuscript-review/manuscript-review-change.tsx src/components/app/manuscript-review/manuscript-review-surface.tsx src/components/app/manuscript-review/manuscript-review-surface.test.tsx
git commit -m "feat: render editable inline proposal review"
```

---

### Task 7: Integrate review mode into the editor and compact the sidebar

**Files:**
- Modify: `src/components/app/editor.tsx:133-420`
- Modify: `src/components/app/editor.test.tsx`
- Modify: `src/components/app/agent-console/review-tray.tsx:1-350`
- Modify: `src/components/app/agent-console/review-tray.test.tsx`
- Delete: `src/components/app/agent-console/manuscript-review.tsx`
- Delete: `src/components/app/agent-console/manuscript-review.test.tsx`

**Interfaces:**
- Consumes: current pending proposal, ephemeral reviewed proposal ID, active project and chapter, live blocks, characters, and shared proposal decisions.
- Produces: an editor that renders exactly one of normal authoring or inline review, plus a compact manuscript tray that opens review through guarded navigation.

- [ ] **Step 1: Add failing editor activation tests**

Extend `editor.test.tsx` fixtures and mocks to cover:

- Matching pending manuscript proposal ID, root, and active chapter renders `ManuscriptReviewSurface`.
- A mismatched review ID renders normal authoring.
- A matching ID with the wrong project root renders normal authoring.
- A matching ID with a different active chapter renders normal authoring.
- An outline proposal never activates manuscript review.
- Closing review returns to normal authoring without clearing the proposal.

When inline review is active, assert the editor still shows the chapter heading and word count, but does not render `DndContext`, sortable block wrappers, `AddBlockRow`, `SelectionToolbar`, or authoring `Block` components. The normal branch must retain all current behavior.

- [ ] **Step 2: Run the editor test and verify the review branch is absent**

Run:

```bash
bun x vitest run src/components/app/editor.test.tsx
```

Expected: FAIL because `Editor` does not read review state or render the surface.

- [ ] **Step 3: Derive one strict active review in Editor**

Read `pendingProposal` and `manuscriptReviewProposalId`. Derive a non-null active review only when all conditions match:

```text
pending proposal exists
pending proposal kind is manuscript
review ID equals proposal ID
project exists
project root equals proposal project root
active chapter equals proposal chapter ID
```

Do not repair a mismatch with a fallback. A mismatch means normal authoring renders and lifecycle tests expose the stale state.

- [ ] **Step 4: Branch only the chapter body**

Keep the existing chapter header and empty-project states. Within the chapter content area:

- Render `ManuscriptReviewSurface` for the strict active review.
- Otherwise render the existing DnD, block stream, add row, find bar, and selection toolbar unchanged.

Do not render authoring blocks behind the review surface. This structural branch is the lock that prevents live edits, selection, formatting, insertion, deletion, and reordering during review.

- [ ] **Step 5: Replace manuscript tray expansion tests with compact summary tests**

In `review-tray.test.tsx`, replace manuscript-card assertions with:

- Manuscript label, summary, and remaining count render.
- `Review in editor`, `Accept All`, and `Reject All` render without an expand trigger.
- No manuscript diff cards or `data-agent-change-id` nodes render in the sidebar.
- Clicking Review in editor calls `openManuscriptProposalInEditor(proposal)`.
- A false navigation result shows `Couldn't open proposal context` and keeps the proposal.
- Accept All is disabled by stale IDs or unavailable ownership.
- Reject All remains enabled for stale IDs when ownership is ready.
- Batch decisions call the same shared functions used by the editor.

Retain every existing outline assertion for collapse, cards, navigation, individual decisions, batch decisions, stale state, and undo.

- [ ] **Step 6: Split the tray presentation by proposal kind**

For manuscript proposals, render a plain `Card` with:

- `TypographyEyebrow` manuscript label.
- `CardTitle` summary.
- `TypographyMuted` remaining count.
- Review in editor button.
- Accept All and Reject All buttons.

Do not wrap the manuscript branch in `Collapsible`, `ScrollArea`, or `ManuscriptReview`.

For outline proposals, keep the current `Collapsible`, `ScrollArea`, `OutlineReview`, individual decisions, and navigation. Keep the same strings and control hierarchy.

- [ ] **Step 7: Delete superseded sidebar manuscript cards**

Delete `manuscript-review.tsx` and `manuscript-review.test.tsx` with `apply_patch`. Remove all imports and verify no production reference remains:

```bash
if rg -n "agent-console/manuscript-review|\\bManuscriptReview\\b" src; then
  exit 1
fi
```

Expected: exit 0 with no matches after the deletion. The exact-word check does not match `ManuscriptReviewSurface`.

- [ ] **Step 8: Run all integration-focused tests**

Run:

```bash
bun x vitest run src/components/app/editor.test.tsx src/components/app/manuscript-review/manuscript-review-surface.test.tsx src/components/app/agent-console/review-tray.test.tsx src/components/app/agent-console/outline-review.test.tsx src/lib/ai/agent-navigation.test.ts src/lib/ai/proposal-decisions.test.ts
just typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit editor and sidebar integration**

Run:

```bash
git diff -- src/components/app/editor.tsx src/components/app/editor.test.tsx src/components/app/agent-console/review-tray.tsx src/components/app/agent-console/review-tray.test.tsx src/components/app/agent-console/manuscript-review.tsx src/components/app/agent-console/manuscript-review.test.tsx
git add src/components/app/editor.tsx src/components/app/editor.test.tsx src/components/app/agent-console/review-tray.tsx src/components/app/agent-console/review-tray.test.tsx src/components/app/agent-console/manuscript-review.tsx src/components/app/agent-console/manuscript-review.test.tsx
git commit -m "feat: review manuscript proposals in editor"
```

---

### Task 8: Verify behavior, themes, and repository gates

**Files:**
- Verify all files changed by Tasks 1 through 7.
- Modify only a previously changed file if a failing test or visual mismatch proves a defect.

**Interfaces:**
- Consumes: the completed inline review implementation and approved visual specification.
- Produces: evidence that proposal editing is isolated, decisions remain safe, themes are readable, outline behavior is unchanged, and all project gates pass.

- [ ] **Step 1: Run the complete focused feature suite**

Run:

```bash
bun x vitest run src/components/app/agent-console/diff-preview.test.tsx src/stores/agent-console-store.test.ts src/stores/agent-persistence.test.ts src/lib/ai/proposal-decisions.test.ts src/lib/ai/manuscript-review-projection.test.ts src/stores/view-store.test.ts src/stores/view-store.outline.test.ts src/lib/ai/agent-controller.test.ts src/lib/ai/agent-navigation.test.ts src/components/app/auto-textarea.test.tsx src/components/app/manuscript-review/manuscript-review-surface.test.tsx src/components/app/editor.test.tsx src/components/app/agent-console/review-tray.test.tsx src/components/app/agent-console/outline-review.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run repository-wide frontend gates**

Run:

```bash
just typecheck
bun x vitest run
just build
```

Expected: TypeScript, every frontend test, and the production web build PASS.

If an unrelated pre-existing failure appears, stop and report its exact command and output instead of masking it with a fallback. Ask before expanding scope.

- [ ] **Step 3: Check styling and obsolete implementation residue**

Run:

```bash
if rg -n "text-success-foreground" src/components/app/agent-console src/components/app/manuscript-review; then
  exit 1
fi
if rg -n "agent-console/manuscript-review" src; then
  exit 1
fi
rg -n "bg-success/10|bg-destructive/10|data-capture-keyboard|data-agent-decision-change-id" src/components/app
git diff --check origin/main --
```

Expected: both forbidden searches exit 0 with no matches, required semantic treatments and isolation attributes are present, and `git diff --check` prints nothing.

- [ ] **Step 4: Verify the live UI against the approved visual direction**

Run the browser preview:

```bash
just dev
```

Use a staged mixed manuscript proposal and inspect these states at the desktop target width:

- Light theme, default rewrite diff.
- Light theme, active insert editor.
- Sepia theme, added and deleted text.
- Dark theme, default rewrite diff.
- Dark theme, active insert editor.
- Stale change with disabled Edit and Accept but enabled Reject.
- Move source marker and move destination decision row.
- Compact manuscript sidebar next to inline review.
- Outline proposal sidebar expanded to confirm its existing flow remains unchanged.

For each theme, verify added text uses normal readable foreground on the faint green tint. Verify unchanged text remains visually primary, deletion styling remains readable, controls remain compact, and no hunk uses a custom literal color.

- [ ] **Step 5: Exercise the golden interaction path**

In the running app:

1. Stage a mixed manuscript proposal for the active chapter and confirm review opens automatically.
2. Edit a rewrite and an insert.
3. Close Review and confirm the proposal remains pending while the manuscript remains unchanged.
4. Reopen from Review in editor.
5. Reject one structural change.
6. Accept one edited text change and confirm only that change applies.
7. Confirm remaining rows revalidate and reproject.
8. Accept All for the remaining fresh changes.
9. Undo once and confirm the accepted manuscript batch reverses as one history step.
10. Stage a proposal for another chapter, use Review in editor, and verify the dirty-chapter guard can cancel or complete navigation.

- [ ] **Step 6: Apply verification-before-completion discipline**

Invoke `superpowers:verification-before-completion`, read its instructions, and use the fresh outputs from Steps 1 through 5 as the completion evidence. Do not claim success from earlier cached output.

- [ ] **Step 7: Inspect commits and final scope**

Run:

```bash
git status --short
git log --oneline --decorate -8
git diff --stat origin/main --
git diff --check origin/main --
```

Expected: feature files and their tests are committed in the planned task boundaries, unrelated user changes remain preserved, and the diff contains no whitespace errors.

If visual or integration verification required a code correction, add a failing regression test where practical, make the minimum root fix in the owning task's files, rerun the complete gate, and commit only that correction with a specific `fix:` message.
