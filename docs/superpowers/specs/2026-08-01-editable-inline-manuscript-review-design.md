# Editable Inline Manuscript Proposal Review

**Date:** 2026-08-01
**Status:** Approved
**Related design:** `docs/superpowers/specs/2026-07-30-agentic-ai-console-design.md`

## Summary

Pending manuscript proposals will be reviewed in the editor as an editable,
staged overlay. The live manuscript remains unchanged until the author accepts a
change. Rewrites and inserts can be edited before acceptance. Removes and moves
remain fixed structural proposals with Accept and Reject controls.

This design supersedes the manuscript-specific presentation in the existing
proposal tray design. Outline proposals continue to use the current sidebar
review cards. The existing proposal envelope, source preconditions, atomic apply
behavior, undo behavior, persistence, and conversation events remain authoritative.

## Goals

- Show every pending manuscript change at its intended chapter location.
- Let the author read unchanged surrounding prose while reviewing a change.
- Let the author edit proposed rewrite and insert text before accepting it.
- Keep unaccepted proposal edits out of manuscript state, dirty state, compile
  output, save output, and editor history.
- Preserve individual Accept and Reject decisions, atomic Accept All, stale-source
  validation, and one-step undo.
- Keep the AI sidebar focused on conversation and a compact proposal summary.
- Correct the unreadable added-text color without adding custom colors.

## Non-goals

- Inline editor review for outline proposals.
- Structural editing of remove or move proposals.
- Converting one proposal kind into another during review.
- Editing live manuscript blocks while inline review mode is open.
- Multiple simultaneous pending proposals or historical proposal browsing.
- A rich-text or `contenteditable` replacement for the existing textarea editor.
- New review keyboard shortcuts.

## Approaches Considered

### Editable staged overlay - selected

The editor derives review rows from the live chapter and the canonical pending
proposal. Editing a rewrite or insert updates only the proposal's `newText`.
Acceptance passes the current proposal through the existing validated apply path.

This keeps the current safety model intact and avoids putting speculative content
into project state.

### Temporary manuscript working copy - rejected

A cloned chapter could provide a fully editable result preview, but it would
duplicate block identity, selection, history, dirty state, and reconciliation
logic. It would also make individual Accept and Reject semantics ambiguous after
the author changed surrounding prose.

### Apply immediately and undo on rejection - rejected

This would make the preview feel native, but unaccepted prose could leak into save,
compile, synchronization, backup, and crash recovery. Undo would also be an unsafe
substitute for explicit rejection after intervening author edits.

## Interaction Design

### Entering and leaving review

When a manuscript proposal is staged for the active project and chapter, the editor
opens review mode for that proposal. If the target chapter is not active, the
sidebar shows Review in editor. That action uses the existing guarded chapter
navigation before opening review mode.

Review mode is ephemeral view state keyed by proposal ID. It is not restored after
an app restart, but the pending proposal itself remains persisted. After restart,
the sidebar can reopen it.

Close Review hides the overlay and returns the editor to normal authoring without
changing the pending proposal. The author may then edit the manuscript. Existing
source validation determines whether those edits make proposal changes stale.

Clearing the proposal, accepting or rejecting its final change, switching projects,
or replacing it with a new proposal closes the prior review mode. A newly staged
manuscript proposal opens its own review mode when its target chapter is active.

### Approved visual treatment

The integrated review treatment was visually reviewed and approved in both light
and dark themes. The author selected the recommended direction without requesting
changes to hierarchy or density.

The approved treatment keeps review chrome quiet enough for the manuscript to
remain primary:

- The main editor and AI sidebar retain their existing side-by-side layout.
- The review header is a compact raised surface below the chapter heading.
- Each changed block stays on the manuscript text axis rather than moving into a
  separate review column.
- A thin semantic edge and faint tinted surface distinguish a change without
  enclosing every hunk in heavy card chrome.
- Change kind, reason, and position use the existing typography hierarchy above
  the prose.
- Edit, Accept, and Reject controls form a compact footer below each hunk.
- The active insert editor receives a stronger semantic focus treatment; inactive
  hunks remain visually quieter.
- The sidebar proposal summary remains compact and does not duplicate the inline
  diff.

### Review header

A sticky review header appears inside the editor surface and contains:

- Proposal summary.
- Remaining change count.
- Previous and Next navigation through remaining changes.
- Accept All.
- Reject All.
- Close Review.

Previous and Next scroll the corresponding inline change to the center of the
editor viewport. Stale changes remain in navigation because they still require
review or rejection.

Accept All is disabled when any remaining change is stale or when project ownership
is unavailable. Reject All remains available whenever project ownership permits a
proposal decision.

### Chapter behavior

All unchanged manuscript blocks remain visible in their normal positions and type
styles. They are read-only while review mode is open. Block selection, text editing,
formatting, insertion, deletion, and drag reordering are disabled. This prevents an
authoring gesture from invalidating the proposal while the author is editing only
its staged text.

The normal editor is unchanged when no manuscript review is open.

### Rewrite

A rewrite occupies the target block's normal location. Its default state renders a
unified word diff using the frozen source text and the current proposed text.
Deleted segments retain deletion styling, unchanged segments retain normal
foreground styling, and added segments use a success tint with readable foreground
text.

Selecting Edit proposal replaces the rendered diff with the existing seamless
textarea treatment containing the full proposed text. The frozen original remains
available directly above the editable field for comparison. Leaving the field
returns to the word diff, recomputed from the edited value.

The change reason and Accept and Reject controls remain adjacent to the change.

### Insert

An insert appears between its resolved boundaries at the exact proposed location.
Multiple inserts sharing one anchor appear in proposal order, matching application
order. The inserted block uses its proposed narration or dialogue presentation and
an editable textarea for `newText`.

Dialogue speaker and tail segment metadata remain fixed. Only the proposed primary
text is editable.

### Remove

A remove leaves the target block in its current location with deletion styling.
The source is not editable. The change reason and Accept and Reject controls appear
with it.

### Move

A move shows a compact source marker at the original position and a read-only
preview at the proposed destination. Both identify the same change. Accept and
Reject controls appear on the destination preview so the primary decision point is
where the block would land.

The destination cannot be dragged or otherwise changed during review.

### Stale changes

Validation runs against the live chapter before projection and again before every
accept action. A stale change renders from its frozen source locator, shows Source
changed - regenerate, and disables editing and acceptance. Reject remains enabled.

Accepting one valid change removes it from the pending proposal and immediately
revalidates and reprojects the remainder. Any dependent change made stale by that
acceptance becomes visibly unavailable.

## Sidebar Behavior

For manuscript proposals, the sidebar tray keeps:

- Manuscript label.
- Proposal summary.
- Remaining change count.
- Review in editor.
- Accept All and Reject All.

The sidebar no longer expands into manuscript diff cards. Accept All and Reject All
use the same shared decision functions as the editor. Outline proposals retain the
existing expanded review-card experience.

## State and Data Flow

```text
agent stage tool
      |
      v
canonical pending manuscript proposal
      |                     ^
      |                     |
      v                     | edit rewrite or insert newText
pure review projection -----+
      |
      v
inline editor review
      |
      v accept
existing validate and apply path
      |
      v
live manuscript plus one undo snapshot
```

### Canonical proposal state

`useAgentConsoleStore.pendingProposal` remains the only canonical proposal. A new
strictly typed store action updates `newText` for one manuscript rewrite or insert.
The action validates project ownership, proposal kind, proposal ID, change ID, and
change kind. Missing or mismatched data raises an explicit error. It does not alter
the precondition, reason, structural fields, or other changes.

Because pending proposal identity already participates in agent persistence,
proposal text edits use the existing persistence path. They do not create chat
messages or proposal events. The accepted or rejected decision remains the event
recorded in the conversation.

### Review view state

The shared view store owns an ephemeral reviewed proposal ID because the sidebar
opens review and the editor renders it. This field is excluded from persisted view
state. Review is active only when the ID matches the current pending manuscript
proposal and its project and chapter match the live workspace.

### Pure projection

A pure projection function combines ordered live blocks with validated manuscript
changes and returns typed review rows. It never modifies input blocks, mints real
block IDs, or calls project-store mutations.

The projection models rewrites, inserts, removes, move sources, move destinations,
and unchanged blocks explicitly. Stable row keys derive from live block IDs and
proposal change IDs. The function preserves proposal ordering and the same insert
and move positioning rules used by application.

### Shared decisions

Proposal validation, accept, reject, event recording, and failure messages currently
owned by the sidebar review component move behind shared manuscript and outline
decision functions. The editor and sidebar call the same functions, preventing
different apply or stale-state behavior between surfaces.

The existing project-store application path remains responsible for precondition
validation, conflict detection, manuscript mutation, dirty state, and undo history.

## Styling and Accessibility

The current addition style uses `bg-success/10 text-success-foreground`.
`success-foreground` maps to `paper-50`, so it is nearly white in light and sepia
themes and dark in the dark theme. That token is intended for text placed on a solid
success background, not a low-opacity tint.

The standalone bug fix keeps `bg-success/10` and removes
`text-success-foreground`, allowing added text to inherit the theme's normal
foreground. It does not introduce a custom color or change the palette. Direct
`text-success` is not used because the current moss token does not provide adequate
body-text contrast on light and sepia tinted surfaces.

Inline review reuses this corrected diff styling. Deletions retain
`bg-destructive/10 text-destructive`. Baseline text inherits foreground. Change
containers use existing semantic tokens and shadcn primitives.

Interactive controls have accessible names. Review rows expose stable change IDs
for navigation and tests. Editable proposal fields opt out of manuscript keyboard
handling so native text input, selection, and undo remain local to the field.

## Error Handling

- Ownership transitions disable proposal editing and decisions.
- A missing target or changed source produces the existing stale state rather than
  applying against a guessed block.
- Apply-time stale or invalid results keep the proposal visible and use the existing
  actionable error messages.
- A proposal edit targeting the wrong proposal or a non-editable change raises a
  specific error and performs no state change.
- Persistence failures continue through the existing agent persistence issue path.
- Closing review never clears or mutates a proposal.

## Testing

The color defect is fixed first as a standalone bug-fix commit:

- Add a component test that proves added segments currently select the inappropriate
  success foreground token.
- Change added segments to inherit normal foreground while retaining the success
  tint.
- Verify deletion and baseline segment styling remains unchanged.

Feature coverage then includes:

- Pure projection tests for unchanged, rewrite, insert, remove, and move rows.
- Projection ordering tests for multiple inserts, moves, and mixed proposals.
- Store tests proving only rewrite and insert `newText` can change.
- Persistence tests proving edited proposal text survives serialization.
- Tests proving proposal edits do not change manuscript blocks, dirty state, compile
  input, or editor history.
- Editor tests for automatic entry, explicit reopening, closing without rejection,
  read-only unchanged blocks, inline navigation, and every change presentation.
- Decision tests for individual Accept and Reject, atomic Accept All, Reject All,
  stale changes, revalidation after one acceptance, and final review cleanup.
- Sidebar tests proving manuscript summaries open editor review while outline cards
  remain unchanged.
- Typecheck, focused tests, full frontend tests, and the production web build.

## Acceptance Criteria

- Every pending manuscript change is visible at its intended chapter location.
- Rewrites and inserts can be edited without mutating the live manuscript.
- Removes and moves are visible in context but cannot be structurally edited.
- Accept applies the current edited proposal only after existing preconditions pass.
- Reject performs no manuscript write.
- Accept All remains atomic and produces one manuscript undo step.
- Closing review preserves the pending proposal.
- Added text is readable in light, sepia, and dark themes without custom colors.
- Outline proposal review behavior does not change.
