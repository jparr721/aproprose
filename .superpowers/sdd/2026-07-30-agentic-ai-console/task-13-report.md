# Task 13 Report

## Result

- Status: PASS
- Task: Delete the legacy AI tabs, handoffs, caches, and Sculpt state.
- Baseline commit: `44f7cc7`
- Branch: `brainstorm-agentic-ai-console`
- Scope: Task 13 only. The approved spec, implementation plan, and progress ledger were not edited.

## Before-deletion scans

The scans below were captured before deletion and verified against the unchanged baseline commit. Counts are match counts per path.

### Legacy UI and state concepts

```bash
rg -n "right-panel|SculptReview|useAiIntent|dispatchAiIntent|useAiCacheStore|useAiActivityStore|useBrainstormStore|useMuseStore|useAiPersistence|openAiTab|setAiTab|aiCollapsed|aiTab" src
```

- Total: 390 matches in 46 files.

```text
   4 src/commands/ai.test.ts
   1 src/components/app/agent-console/agent-console.tsx
   6 src/components/app/block/block-actions.test.tsx
   6 src/components/app/block/block-toolbar.test.tsx
   8 src/components/app/editor.test.tsx
   1 src/components/app/editor.tsx
   1 src/components/app/outline/sculpt-review.tsx
  10 src/components/app/right-panel/brainstorm-tab.test.tsx
  11 src/components/app/right-panel/brainstorm-tab.tsx
   1 src/components/app/right-panel/context-anchor.test.tsx
   8 src/components/app/right-panel/continuity-tab.test.tsx
   2 src/components/app/right-panel/continuity-tab.tsx
   9 src/components/app/right-panel/critique-tab.test.tsx
   2 src/components/app/right-panel/critique-tab.tsx
  11 src/components/app/right-panel/edit-tab.test.tsx
   6 src/components/app/right-panel/edit-tab.tsx
   2 src/components/app/right-panel/finding-actions.tsx
  12 src/components/app/right-panel/index.tsx
  32 src/components/app/right-panel/muse-tab.test.tsx
  35 src/components/app/right-panel/muse-tab.tsx
   2 src/components/app/right-panel/shared.tsx
  11 src/components/app/right-panel/suggest-tab.test.tsx
   6 src/components/app/right-panel/suggest-tab.tsx
  15 src/hooks/use-ai-intent.test.tsx
   4 src/hooks/use-ai-intent.ts
  11 src/hooks/use-ai.test.tsx
   5 src/hooks/use-ai.ts
   4 src/lib/ai/agent.test.ts
   3 src/lib/ai/agent.ts
   2 src/lib/ai/cache-key.ts
   1 src/lib/dom.ts
   1 src/lib/outline/beat-signals.ts
  22 src/stores/ai-activity-store.test.ts
   2 src/stores/ai-activity-store.ts
  11 src/stores/ai-cache-store.test.ts
   2 src/stores/ai-cache-store.ts
  15 src/stores/ai-intent-store.test.ts
   4 src/stores/ai-intent-store.ts
  24 src/stores/ai-persistence.test.ts
  13 src/stores/ai-persistence.ts
  15 src/stores/brainstorm-store.test.ts
   1 src/stores/brainstorm-store.ts
  37 src/stores/muse-store.test.ts
   1 src/stores/muse-store.ts
   8 src/stores/view-store.test.ts
   2 src/stores/view-store.ts
```

### Pure helper concepts

```bash
rg -n "aiCacheKey|editComposerState|buildAiContext|buildScopedContext|buildSuggestContext|buildEditRequest|buildRefineRequest|buildSculptContext" src --glob '!src/components/app/right-panel/**' --glob '!src/lib/ai/*.test.ts'
```

- Total: 22 matches in 8 files.

```text
   2 src/hooks/use-ai.test.tsx
   2 src/hooks/use-ai.ts
   2 src/lib/ai/agent.ts
   1 src/lib/ai/cache-key.ts
  12 src/lib/ai/context.ts
   1 src/lib/ai/edit-composer.ts
   1 src/lib/ai/sculpt-context.ts
   1 src/stores/project-store.ts
```

The `project-store.ts` match was a stale documentation reference, not a caller. After the direct legacy consumers were removed, import scans showed no retained caller for `cache-key`, `edit-composer`, `context`, or `sculpt-context`.

### Dead operation concepts

```bash
rg -n "suggestContinuation|editBlocks|reviseChapter|assignSpeakers|sculptChapter|brainstorm|cleanTranscript" src --glob '!src/lib/ai/operations.ts' --glob '!src/lib/ai/operations.*.test.ts'
```

- Total: 59 matches in 17 files.

```text
   8 src/components/app/right-panel/brainstorm-tab.test.tsx
  10 src/components/app/right-panel/brainstorm-tab.tsx
   5 src/components/app/right-panel/edit-tab.test.tsx
   8 src/components/app/right-panel/edit-tab.tsx
   5 src/components/app/right-panel/index.tsx
   1 src/components/app/right-panel/suggest-tab.test.tsx
   2 src/components/app/right-panel/suggest-tab.tsx
   1 src/lib/ai/context.ts
   8 src/lib/ai/prompts.ts
   1 src/lib/blocks/structure-proposal.ts
   1 src/lib/types.ts
   1 src/stores/ai-activity-store.ts
   1 src/stores/ai-intent-store.ts
   2 src/stores/ai-persistence.test.ts
   2 src/stores/ai-persistence.ts
   2 src/stores/brainstorm-store.test.ts
   1 src/stores/brainstorm-store.ts
```

### Forbidden in-app product concepts

```bash
rg -n -i "muse|brainstorm tab|suggest tab|edit tab|critique tab|continuity tab|send to edit|codex|claude" src src-tauri/src
```

- Total: 218 matches in 29 files.

```text
   3 src/commands/ai.test.ts
   1 src/components/app/color-dot.tsx
   2 src/components/app/right-panel/continuity-tab.test.tsx
   3 src/components/app/right-panel/critique-tab.test.tsx
   1 src/components/app/right-panel/edit-tab.tsx
   1 src/components/app/right-panel/finding-actions.tsx
   6 src/components/app/right-panel/index.tsx
  42 src/components/app/right-panel/muse-tab.test.tsx
  52 src/components/app/right-panel/muse-tab.tsx
   4 src/components/app/settings/ai-tab.test.tsx
   1 src/components/app/theme-controller.tsx
   3 src/lib/ai/agent.test.ts
  15 src/lib/ai/agent.ts
   2 src/lib/ai/context.ts
   1 src/lib/ai/edit-composer.ts
   1 src/lib/ai/grounding-render.ts
   1 src/lib/ai/model.test.ts
   5 src/lib/ai/operations.ts
   4 src/lib/ai/prompts.test.ts
   6 src/lib/ai/prompts.ts
   1 src/lib/blocks/structure.dump.test.ts
   1 src/lib/types.ts
   1 src/stores/ai-intent-store.ts
  39 src/stores/muse-store.test.ts
  18 src/stores/muse-store.ts
   1 src/stores/settings-dialog-store.ts
   1 src/stores/settings-store.test.ts
   1 src/stores/settings-store.ts
   1 src/stores/view-store.ts
```

## Retained-call-site migration

- Replaced the legacy console DOM marker with `data-agent-console` and updated the shared auxiliary-surface selector.
- Removed obsolete cache and intent resets from block, toolbar, and editor tests.
- Removed obsolete tab API expectations from command and view-store tests.
- Replaced stale product-name comments and test fixture values without changing runtime behavior.
- Removed the public `ProjectState.applySculpt` action after its only UI caller was deleted.
- Retained the pure outline-model `applySculpt` reducer because the current strict agent outline proposal path uses it internally.
- Retained deterministic manual outline editing actions: add, remove, edit, reorder, move across chapters, and chapter metadata editing.
- Reduced `outline-board-store.ts` to exactly the two navigation fields and three navigation actions specified by the brief.

## Deleted modules

- Entire `src/components/app/right-panel/` directory, including all legacy tabs, tab tests, shared chrome, and finding actions.
- Full-board `src/components/app/outline/sculpt-review.tsx`.
- Intent, cache, activity, chat, legacy agent-run, and old persistence stores with their tests.
- `use-ai` and `use-ai-intent` hooks with their tests.
- Old `src/lib/ai/agent.ts` with its test.
- Proven-dead helpers and tests: `cache-key`, `edit-composer`, `context`, `sculpt-context`, and `structure-proposal`.
- Legacy operation prompt module and prompt tests after retained assertions moved.
- Dedicated dead operation tests for author preference routing and speaker assignment.

## Retained operation surface

- Reduced `operations.ts` from 748 lines to 211 lines.
- Retained structured critique and continuity inference used by the current agent controller.
- Retained manuscript and outline proposal sanitizers used by the current proposal builder.
- Retained finding-id sanitization and result schemas required by the structured analysis contract and its tests.
- Moved critique and continuity prompt constants into `agent-prompts.ts`.
- Moved pure preference-rendering assertions into `author-preferences.test.ts`.
- Removed the legacy `Suggestion`, `SuggestResult`, and `ChatMessage` domain types after caller scans reached zero.
- Retained `ManuscriptProposal`, `SculptProposal`, `BlockChange`, and `SculptChange` for current reducers and proposal construction.

## Post-deletion scans

Each required scan returned no output and exit code 1, which is the expected `rg` result for zero matches.

```text
legacy concepts: 0 matches
pure helper concepts: 0 matches
dead operation concepts: 0 matches
forbidden in-app product concepts: 0 matches
SuggestResult and ChatMessage types or Suggestion type imports: 0 matches
listed deleted file paths: 0 matches
```

The unrelated `Suggestion` UI primitive in `src/components/ai-elements/suggestion.tsx` remains; the removed contract was the legacy domain type in `src/lib/types.ts`.

## Verification

- `just typecheck`: PASS.
- Focused Vitest run: PASS, 13 files and 114 tests.
- `just test`: PASS, 88 frontend files and 940 tests; Rust 44 passed, 1 ignored, 0 failed.
- `just build`: PASS. Vite emitted its chunk-size advisory and completed successfully.
- `just fmt`: PASS.
- `cargo clippy --all-targets -- -D warnings`: PASS.
- `git diff --check`: PASS.
- Added-line ASCII scan for source changes: PASS, zero matches.
- ASCII scan for this report: PASS, zero matches.

## Scope review

- Source diff before this report: 80 files, 333 insertions, 7,344 deletions.
- No dependency, Tauri capability, runtime model-selection, or release automation changes.
- No spec, implementation plan, or progress ledger edits.
- No known blockers or unresolved failures.

## Fix Round 1

### Review target

- Reviewed Task 13 commit: `318bfbd` (`refactor: remove legacy AI panel flows`).
- Fix commit: the commit containing this report section. Its SHA is returned in the task handoff because a commit cannot contain its own final SHA.
- Scope: remove the legacy partial-apply manuscript wrapper and dead anchored-context text aggregation without changing the strict agent proposal path.

### Exact pre-change references

Exact word scans against reviewed commit `318bfbd` found:

```text
applyManuscriptProposal: 13 matches
ProposalApplyResult: 3 matches
blocksText: 3 matches
```

The public wrapper matches were limited to one reducer comment, one result-type comment, the `ProjectState` interface, its implementation, and the dedicated wrapper tests. `blocksText` appeared only in `AnchoredContext`, its controller construction, and the findings fixture. No grounding renderer consumed it.

### Changes

- Removed `ProjectState.applyManuscriptProposal`, its implementation, imports, and eight dedicated wrapper tests.
- Removed `ProposalApplyResult` from `lib/types.ts`.
- Retained `applyProposal` as the pure manuscript reducer used by strict agent application.
- Retained `applyAgentManuscriptProposal` and its ownership, correlation, precondition, selection, conflict, atomicity, and undo tests.
- Removed `AnchoredContext.blocksText`, the controller-side concatenation, and the findings fixture field.
- Kept critique and continuity grounding unchanged: it still renders the same id-labeled `blocks` collection.
- Added no replacement regression because the retained strict-path and grounding tests already exercise the required behavior directly.

### Exact post-change references

```text
exact applyManuscriptProposal: 0 matches
exact ProposalApplyResult: 0 matches
exact blocksText: 0 matches
applyAgentManuscriptProposal: 12 retained matches
applyProposal: 25 retained matches across the pure reducer, strict store path, and reducer tests
```

The public project-store proposal scan now exposes only strict manuscript and outline agent actions. No index-based or partial-apply wrapper remains.

All four Task 13 residue scans again returned no output and exit code 1:

```text
legacy concepts: 0 matches
pure helper concepts: 0 matches
dead operation concepts: 0 matches
forbidden in-app product concepts: 0 matches
```

### Fix verification

- Focused Vitest run: PASS, 8 files and 205 tests.
- `just typecheck`: PASS.
- `just test`: PASS, 88 frontend files and 932 tests; Rust 44 passed, 1 ignored, 0 failed.
- `just build`: PASS. Vite emitted its chunk-size advisory and completed successfully.
- `just fmt`: PASS.
- `cargo clippy --all-targets -- -D warnings`: PASS.
- `git diff --check`: PASS.
- Added-line ASCII scan: PASS, zero matches.
- Report ASCII scan: PASS, zero matches.
- Source diff before this report append: 7 files, 2 insertions, 176 deletions.
- No spec, implementation plan, or progress ledger edits.
