# Audit remediation consensus draft

Party input: Architect + QA/UX + Wildcard + Level + Killjoy + Splinter + topic research.
No implementation starts until objections and file ownership are cross-reviewed.

## Prior art dispositions

- Adapt existing tempfile/std for same-directory staged writes and explicit synchronization. Preserve complete old bytes on pre-replacement failure; distinguish post-replacement uncertainty. Multi-file updates need their own operation boundary.
- Adapt existing Git CLI using NUL-delimited porcelain/conflict/change protocols; retain bytes until explicit decoding. No Git library dependency.
- Adopt existing shadcn Field/Card/Typography/FindOptionToggle and react-resizable-panels. Numeric panel sizes are pixels; avoid treating them as percentages.
- Adopt @playwright/test as the portable browser regression runner missing from current dependencies. This is within explicitly requested finding 24; bundled absolute Codex runtime paths cannot support CI.
- Keep native proof separate from browser IPC fixtures. Use an isolated native app identity for real-data QA; component workshop renders actual components for exceptional UI states.

## Slice contracts

| Slice | Findings | Exact write set | Dependencies |
| --- | --- | --- | --- |
| N: native integrity and process | 04 native,05,06,10,11,12,22,23 | src-tauri/src/lib.rs; src-tauri/src/project.rs; src-tauri/src/novel.rs; src-tauri/src/git.rs; src-tauri/src/compile.rs; new src-tauri/src/durable_write.rs; new src-tauri/src/tex_text.rs; new src-tauri/src/process.rs | none; publish sync result contract before P consumes it |
| P: project lifecycle, sync, storage | 01,02,03,04 frontend,08,09,13,24 adapter | src/stores/project-store.ts; src/stores/project-store.test.ts; src/stores/project-store.outline.test.ts; src/stores/sync-store.ts; src/stores/sync-store.test.ts; src/lib/types.ts; src/lib/tauri.ts; src/lib/storage.ts; new src/lib/storage.test.ts; src/components/app/chapter-list.tsx; new src/components/app/chapter-list.test.tsx; src/components/app/outline/outline-board.tsx; src/components/app/outline/outline-board.test.tsx; new src/lib/project-operations.ts; new src/lib/project-operations.test.ts | N contract agreed; source edits disjoint with N |
| U: authoring UI and editor interactions | 07,14,15,16,17,18,19,20 editor | src/App.tsx; src/App.test.tsx; src/components/app/editor.tsx; src/components/app/editor.test.tsx; src/components/app/editor.delete-block.test.tsx; new src/hooks/use-editor-interactions.ts; src/components/app/find-bar.tsx; src/components/app/find-bar.test.tsx; src/components/app/pdf-pane.tsx; src/components/app/pdf-pane.test.tsx; src/components/app/settings/field.tsx; src/components/app/settings/appearance-tab.tsx; src/components/app/settings/ai-tab.tsx; src/components/app/settings/ai-tab.test.tsx; src/components/app/settings/backup-tab.tsx; src/components/app/settings/stats-tab.tsx; src/components/app/settings/stats-tab.test.tsx; src/components/app/settings/about-tab.tsx; src/components/app/backup-setup-dialog.tsx; src/components/app/backup-review-dialog.tsx; src/components/app/changelog-list.tsx; src/components/app/agent-console/agent-console.tsx; src/components/app/agent-console/agent-console.test.tsx; new src/components/app/backup-schedule-fields.tsx; new src/components/app/backup-schedule-fields.test.tsx; src/components/ui/alert.tsx; new src/components/app/settings/appearance-tab.test.tsx | P API stable for integration; independent UI edits can run with N/P |
| C: agent controller composition | 20 controller | src/lib/ai/agent-controller.ts; src/lib/ai/agent-controller.test.ts; new src/lib/ai/agent-submission-context.ts; new src/lib/ai/agent-tool-environment.ts; new src/lib/ai/agent-run-lifecycle.ts | P stable; preserve current public exports |
| H: agent persistence protocol | 21 | src/stores/agent-persistence.ts; src/stores/agent-persistence.test.ts; src/stores/agent-console-store.ts; src/stores/agent-console-store.test.ts; new src/stores/agent-persistence-coordinator.ts | P and storage adapter stable; no controller edits |
| A: browser/native automation and release | 24 browser,25,QA deck | .github/workflows/ci.yml; .github/workflows/release.yml; new .github/workflows/validate.yml; justfile; package.json; bun.lock; new playwright.config.ts; new tests/browser/audit-remediation.spec.ts; new tests/browser/fixtures.ts; new tests/workshop.html; new tests/workshop.tsx; new scripts/validate-release-assets.ts; new scripts/validate-release-assets.test.ts; new scripts/smoke-release-artifact.ts; new docs/slides/audit-remediation-2026-10-07.html; .gitignore | all slices for final integration; automation scaffolding can precede |

## Wave plan

1. N + P foundations and regression tests, with U in root. Freeze sync payload shape before consumers change.
2. C + H file-disjoint composition changes, while root finishes U/A.
3. Integration, full selected-mode gate, one ready PR, pushed-diff adversarial review rounds (minimum 3, maximum 5), whole-diff simplification, final exact-commit gate and CI, gated merge, real-data QA and delivered HTML screenshot deck.

## Required edge contracts

- Ownership is lifecycle generation plus root and chapter, not root equality alone. A-B-A invalidates old operations.
- Save persists a captured revision without replacing newer live text/history. Serialized per-root persistence/sync prevents competing disk writes.
- Loads check request identity and edit revision after awaits. Late reads do not clear edits made during the read.
- Save returns explicit outcome. Failure or remote divergence prevents build of misleading stale bytes.
- A successful pull still needs reconciliation after a failed push. Changed paths accompany every terminal sync outcome after pull.
- Dirty divergence preserves the live draft and remote disk bytes until an explicit user resolution; a blind save is blocked.
- Multi-file skeleton updates stage content first, report exact partial-commit outcomes, and retain originals for failed operations.
- Managed required files fail visibly. Metadata reserved characters round-trip through the plain-text serialization boundary.
- Editor stays mounted across view/pane toggles, but its commands are inactive while hidden. Native outline text undo remains native.
- At 960px, editor/outline stays usable with sidebar, PDF, and AI. Find/actions stay within pane bounds.
- Existing persistence ordering, failure retention, reset generations, proposal ownership, and frozen provider/model behavior remain authoritative.

Detailed per-finding acceptance is in audit-remediation-task.md. Workers must read actual files before editing and add failing regression tests before bug fixes. No test weakening, hook bypasses, unrelated features, or personal-data QA.

## Cross-review corrections

- U also owns src/components/app/pdf-find-bar.tsx, src/components/app/pdf-find-bar.test.tsx, src/components/app/find-option-toggle.tsx, src/components/app/settings/keyboard-tab.tsx, src/components/app/agent-console/agent-composer.tsx, and src/components/app/agent-console/agent-composer.test.tsx.
- A also owns new src-tauri/tauri.qa.conf.json for isolated native QA identity and config storage.
- U also owns src/components/ui/slider.tsx: forward accessible name/description to its actual focusable thumbs. Existing labels otherwise name only the non-control root.
- A also owns tsconfig.browser.json to typecheck the browser workshop and automation independently of production entrypoints.
- P owns src/lib/exit-guard.ts and src/lib/exit-guard.test.ts; U owns src/components/app/update-checker.tsx and its existing tests where needed. Explicit save outcomes and lifecycle ownership apply to close/update consumers too.
- P owns src/lib/backup/messages.ts and its tests for the new terminal error sync outcome.
- P also owns src/stores/view-store.ts, src/stores/view-store.test.ts, src/stores/settings-store.ts, src/stores/settings-store.test.ts, src/stores/stats-store.ts, and src/stores/stats-store.test.ts only as needed to observe native persistence errors safely at Zustand boundaries. A standalone thrown storage promise is insufficient if callers ignore it.
- Narrow main panels stack editor/PDF vertically; authoring width remains at least 360px where supported 960px shell geometry permits. Persisted panel flags remain unchanged; returning wide restores horizontal presentation.
- Skeleton mutations must derive their model at execution from current owned state; serialization alone does not repair captured stale models.
- Already accepted durable metadata snapshots drain at their captured root after close, with lifecycle guards on UI effects. Root loads await that queue; remote revision changes invalidate pre-pull writers. This preserves the existing queued close/reopen invariant without reading another project's current model.
- Reconciliation receives a typed project snapshot captured before native pull. Local metadata or manuscript revisions made during pull require explicit divergence resolution even if the manuscript was initially clean.
- Plain-text metadata tests include escaped braces, literal TeX-looking strings, all reserved characters, repeated save/open, and migration compatibility. Do not silently reinterpret legacy authored TeX.
- Native QA uses generated disposable projects under isolated app identity. Actual provider inference and other platforms' native launch/signature proof are explicitly unrun unless executed locally or in CI.

## Main integration amendment

- Refreshed base is `7e80500` (0.17.9), preserving incoming notifications, chapter reordering, animated dock, compact previews, and Chromium/WebKit scrollbar coverage.
- Root owns the required synchronized 0.17.10 version/changelog update; no tag or release publication.
- Browser configuration retains the upstream isolated port and both engines; reusable validation installs and runs both.
- Integration resolves P lifecycle/notification changes, C/H extracted failure notifications, and U primitive/layout changes within their existing slices.
