# AI authoring pipeline ledger

## Intake

- task: Add AI refinement above Writing voice and Writing/editing instructions; analyze background notes and outline synchronization; enforce version/changelog gates and build new versions on each main push per later direct steering.
- input: Free-form feature request with screenshot.
- target: main
- branch: codex/ai-authoring-guidance
- worktree: /Users/jarredparr/.config/jp-skills/worktrees/aproprose/codex/ai-authoring-guidance (created clean by root)
- primary: /Users/jarredparr/Projects/aproprose
- supervisor: /root/supervisor
- coordination: collaboration tools; hub unavailable
- plan: party (no detailed existing plan supplied)
- verify-mode: local; user explicitly authorized full checks/tests on continuation
- delivery: latest user steering authorizes commit and push; keep worktree and branch, no merge for this turn
- merge: repository uses merge commits; deferred per latest delivery steering
- rules read: /Users/jarredparr/Projects/jp-skills/skills/pipeline/SKILL.md; worktree AGENTS.md; user-provided additional AGENTS instructions
- write ownership: supervisor writes only this ledger; root coordinates all implementation, reviews and QA

## Verification surface

- CI runs (verified from .github/workflows/ci.yml): bun x tsc --noEmit; bun x vitest run; bun run build; src-tauri/cargo clippy --all-targets -- -D warnings; src-tauri/cargo test
- CI skips: cargo fmt --check; just bundle (native bundle; tag-triggered release workflow does platform packaging)
- recipes: just typecheck; just test (Vitest then cargo test); just build; just fmt (cargo fmt then cargo clippy); just bundle
- generators: None identified during intake
- needs: Bun dependencies, Rust dependencies, macOS Tauri; inspect optional external LaTeX tests
- full gate: authorized; root running local surface

## Intake user batch and resolved steering

1. Verification: full local gate (all typechecks, frontend/Rust tests, lint, builds and generators) or CI only?
2. Outline edit approval: user reviews AI proposal before manuscript changes (recommended), or agent evaluates and applies automatically?

- Request source: pipeline requires explicit permission before any local verification.
- request_user_input_async is unavailable in the supervisor tool inventory; Plan-only request_user_input cannot be used for permission. Root successfully relayed supervisor's exact batch with its available request_user_input_async; answers pending.
- Independent research and planning may continue; dependent local verification remains blocked on explicit answer.
- Root relayed separate asynchronous scope clarification: (a) AI buttons plus deep audit/design, or (b) also implement automatic outline synchronization and approved manuscript updates. Pending answer, confirmed scope is buttons plus audit; no new background writes are authorized by assumption.
- Continuation answer: user explicitly authorizes local checks/tests, commit and push. verify-mode is local. No further verification permission question needed.
- Latest feature correction: clicking an AI button must use the existing box text and generate directly. Nonblank/configured field opens dialog and starts exactly one initial generation; optional steering remains for follow-up; blank field still requires author intent. Review/Apply/Cancel remains.
- Approval/synchronization optional questions do not block confirmed buttons plus audit/design scope; no new background synchronization implemented.
- Later direct user scope expansion: require version bump for each change following ~/Projects/ronin precedent, require changelog change, and always build new versions on each push to main with changelog update. This is explicit scope, not a follow-up invented by workers.
- Later direct user instruction: update GitHub gates so PRs must be up to date before merging. Root observed main branch protection 404 and rulesets [] (currently unprotected); authorized action is strict required checks on main, without extra review/bypass policy.

## Party plan

- Round 1: architect and research complete, read-only; Wildcard/Level/Killjoy/Splinter to run as independent personas in two waves within concurrency limits
- Runtime deviation: Additional spawn calls rejected with 'agent thread limit reached' despite completed workers. Root reuses architect slot for separately labeled Level and Killjoy passes, then Wildcard slot for Splinter. All required perspectives remain; fresh agent per persona could not be honored due to platform limit.
- Topic research: complete, read-only; primary-source brief required input to Round 2
- Research interim: Existing ai v6, zod and configured provider/model plus pending proposals cover scope. No new dependency recommended. Current v7 SDK docs differ in approval API; do not drive a v6 upgrade for this feature.
- Architect interim: Background refresh follows explicit saveChapter or topology changes, not typing. commitStoryRefresh updates logline/overview/characters but does not write meta.chapters. Manual outline setters persist without AI request. Proposed direction: debounced in-memory chapter capture without autosave; reuse proposal acceptance lifecycle for outline-to-manuscript changes.
- Research verdicts for Round 2 disposition:
  - Accept existing ai@6.0.208 + Zod + getModel for preference refinement: already installed and supports schema validation.
  - Accept existing PendingProposal, stale fingerprints, accept/reject and undo for outline-to-manuscript: fits established review behavior.
  - Accept existing story-refresh-store queue and optimistic commit for manuscript-to-derived metadata: extend the existing refresh rather than add a parallel workflow.
  - Reject SDK upgrade/new workflow dependency: no capability gap; version 6 needsApproval adds redundant model calls for existing proposal tray.
  - Version-pinned primary sources: https://raw.githubusercontent.com/vercel/ai/ai@6.0.208/content/docs/03-ai-sdk-core/10-generating-structured-data.mdx ; https://raw.githubusercontent.com/vercel/ai/ai@6.0.208/content/docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx
  - Research agent reports no local verification run, no dependency/service/scope delta.
- Architect final: Preserve existing queue generation/abort, coalescing, compare-and-swap and persistence guards. Do not use autosave to implement typing-triggered AI: saveChapter reparses IDs, clears undo/redo, and can overwrite edits made across its await (project-store.ts:1562-1600). Architect recommends refinement assistants plus deep audit, treating live bidirectionality as a scoped enhancement. Supervisor relayed that final scope must follow the user's action language and pending approval answer; do not silently narrow the request based only on implementation preference.
- Wildcard preliminary: Existing preference setters persist per keystroke. Assistant interview/draft must remain local until Apply. For empty fields, solicit freeform intent rather than fabricate taste. Freeze provider/model and source field; stale source must block Apply. Local settings dialog review fits better than expanding project PendingProposal variants.
- Wildcard ownership objection: ChapterOutline is authored forward plan; ChapterKnowledge is derived saved-text evidence. Automatic mutation of plan from observed prose can erase future intent and loop back into manuscript edits. Prefer separate as-written knowledge/proposals or explicit per-field ownership. Outline-sculpt tasks cannot stage manuscript changes; reverse synchronization belongs in a distinct manuscript-authorized task using the existing review tray.
- Wildcard UI acceptance: Output schema must reject empty and over-limit (PREFERENCE_MAX_CHARS) output before setters; do not silently slice. Reuse retry excluding abort and safe error recovery. Buttons need target-specific accessible names. No project/manuscript context needed for generic settings helper. Test intent prerequisite, exclusions in prompt, target-only Apply, cancel/close/unmount cancellation and late results, stale source rejection, frozen provider/model per run, changed settings on next run, recovery and invalid-output nonmutation.
- Level Round 1: Scope fits current provider/model SDK boundaries. Additional acceptance: trim output before min(1); steering-only works; both blank explains missing intent; abort check after getModel resolution because getModel takes no signal; generation ownership prevents late close/reopen results; nested dialog Escape/focus checks; no project requirement; snapshot original field, peer context, provider/model and reject stale replacement. Update AiTab mocks for imported getModel. No local checks run.
- Killjoy Round 1: No unsupported bug claims. Confirmed literal scope remains buttons plus deep audit/design pending answer; do not add live refresh subsystem before scope confirmation.
- Wildcard final evidence: Global field UI ai-tab.tsx:350; persisted setters settings-store.ts:69; limit types.ts:363. Saved-text enqueue project-store.ts:1624; derived metadata commit project-store.ts:1691. Outline-sculpt manuscript staging guard agent-proposals.ts:225. Existing nonempty preference may be clarified without mandatory interview; empty existing preference requires author-provided intent. No source files edited or local checks run.
- Round 2: Splinter sequential cross-review SIGNOFF on A-D, subject to boundary invariants below
- Splinter invariants: Inference slice cannot import/use setters or project store. Preference and intent are labeled input data under a neutral helper system prompt, avoiding authorSystem making the text being rewritten constrain its own clarification. UI owns controller, generation, field snapshot; Apply synchronously compares live field/provider/model. Close/unmount/config change aborts and invalidates; Generate captures fresh current source and discards prior draft; retries retain frozen inputs and signal. Intent required only for blank source. Audit must separate authored plan from derived knowledge and saved-only from typing. QA exercises both fields, Cancel/Apply, empty-input gate, missing-config/error and stale prevention where feasible. No dependency/store/proposal-union changes.
- Splinter exact A contract: input {field: 'styleGuide' | 'editingRules', current: string, request: string}; options {provider, modelId, signal}; output string. No peer preference in inference. Require nonblank current or request; validate trimmed nonblank output <=2000. B handles live field setter/configuration and all persistence. Ready to dispatch A only; no checks until authorized.
- Consensus: APPROVED by Splinter after Level/Killjoy/Wildcard/Architect plus research dispositions; no blocking plan objections remain within confirmed scope
- Cross-review: Architect accepts A/B disjoint write sets; A contract consumed by B. C only writes audit doc. Splinter signs off A-D invariants.

| Slice | Behavior and detailed todos | Exact write set | Dependencies and owner |
|-------|----------------------------|-----------------|------------------------|
| A | Inference-only typed API; neutral prompt with labeled current/request data; Output.object trim, nonblank, max 2000; getModel frozen provider/model; abort checks; withAiRetry with SDK maxRetries 0; tests; no key/model fallback | src/lib/ai/refine-preference.ts; src/lib/ai/refine-preference.test.ts | Research accepted SDK6/getModel/Zod; worker |
| B | Field action slot; two target-labeled AI buttons; local steering/dialog/draft; explicit Apply writes own field; synchronous live source/config check; close/config/unmount abort and generation invalidation; blank-input gate; safe recovery; tests and existing mocks | src/components/app/settings/preference-assistant.tsx; src/components/app/settings/preference-assistant.test.tsx; src/components/app/settings/ai-tab.tsx; src/components/app/settings/ai-tab.test.tsx; src/components/app/settings/field.tsx | A exported API; root |
| C | Deep source-backed audit of save/topology triggers, disk-only capture, queue/fingerprints, SDK/prose evidence, metadata/rollback, authored vs derived ownership, acceptance; intended live/bidirectional design/test matrix; source-visible save race labeled unproven | docs/architecture/background-ai-authoring.md | Read current source; architect; no new background implementation without scope answer |
| D | Real native path and real component workshop where live states unreachable; capture screenshots for both fields and key states; one short-caption slide per screenshot; embed/relative local assets; copy to primary before cleanup | docs/slides/ai-preference-help-2026-10-07.html (actual final name); embedded screenshots | Finished code/gates; root QA completed |
| E | Version/changelog gate; exact-SHA reusable main release; retain signing/platform/Arch/updater proof; release-body validation and tests; main-only release recipe; bump current change and document author policy | Architect: .github/workflows/ci.yml; .github/workflows/release.yml; scripts/check-release.ts; scripts/check-release.test.ts; scripts/release-body.ts; scripts/release-body.test.ts; justfile. Root: package.json; src-tauri/Cargo.toml; src-tauri/tauri.conf.json; src-tauri/Cargo.lock; changelog.json; AGENTS.md | Architect/root disjoint writes; final gate after E complete |
| F | Configure actual GitHub main branch protection with required checks and strict true, requiring PR head up to date before merge; verify readback | External GitHub settings only; no local write set | Exact finalized check job names; root; local Composio CLI preferred |

- Research dispositions accepted SDK6/getModel/Zod, existing queue/proposals as future design foundation; rejected SDK upgrade, new dependencies and new approval state machine because existing capabilities suffice.
- B amended acceptance from direct user correction: generate automatically once on open when existing field is nonblank and configured; use current box text immediately; do not require a second Generate click. Root writes regression tests and observes failure before adjustment.
- Release scope deliberation active: Architect and Wildcard inspect actual Ronin workflows and Aproprose scripts. Exact new write sets pending amended consensus. Intended design: no bot bump loop; PR/main strict synchronized version + new valid changelog entry; main builds preserve signed matrix/updater publication.
- Wildcard release objection: Existing tag workflow assumes tag guard/event.created/GITHUB_REF_NAME version/release-body/Arch naming; main trigger cannot be added verbatim. Per-ref concurrency may replace pending main builds; use per-SHA identity for each-push guarantee. Build/publication intent must follow direct user wording and actual release design.
- Wildcard primary-doc update: GitHub concurrency now supports queue: max (May 2026); cancel-in-progress: false plus queue: max can serialize main runs without historical pending replacement. Waiting-time FIFO does not ensure dispatch order, so latest publication still needs monotonicity guard. Existing gh PATCH default make_latest=true can let older late build replace latest. GITHUB_TOKEN-created push/tag does not recurse. Sources: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax ; https://docs.github.com/en/rest/releases/releases?apiVersion=latest
- Wildcard source invariants: four current version files and newest changelog are 0.17.1; set-version.ts updates all four. release-body.ts validates summary/highlights but not uniqueness/date/order. Gate must require candidate > base, all four versions equal, and newly added/changed valid candidate-version entry; changelog file merely changing is insufficient. Existing _release pushes main plus tag together, so main workflow needs canonical version/SHA dedupe or legacy path double-creates releases/assets. Prefer author-committed bump/entry enforced by CI and build exact pushed SHA; avoid bot auto-bump loops.
- Architect release plan: Ronin precedent is four-file monotonic gate only (no release/changelog workflow). Aproprose existing signed three-platform draft/verify/publish release becomes workflow_call invoked by main-push CI after version/changelog/frontend/Rust pass. Key main CI concurrency by SHA so every push builds; retain PR cancellation. Avoid workflow_run split, bot bump and tag-trigger loop. Exact write sets pending root consensus.
- Release Wildcard/Level/Splinter acceptance: compare PR against base-repo origin including forks and stale equal-version PRs; support merge_group; main compares event.before to exact event SHA. Stable numeric SemVer and four proposed versions equal and above equal base, selecting only Aproprose Cargo.lock package. Unique valid candidate-version changelog entry must be new/changed versus base; old-entry-only edits fail. Every main push builds full matrix without dropped queued runs. Preserve platform/Arch/signing/updater notes and validation. If main publishes, enforce exact-SHA immutable version tag, same-SHA published no-op, draft rerun resume, mismatched/forced tag reject, no main bot commit, no duplicate main/tag release and monotonic latest. Root must explicitly choose publication interpretation versus build artifacts only.
- Architect API review facts: createRelease ignores target_commitish when tag exists, requiring independent existing-tag SHA validation. Published lookup may omit drafts, so draft-resume requires paginated listReleases. GitHub token restrictions can block creating releases/tags for older targets modifying workflows relative to default branch; external release proof remains unverified before actual remote run.
- Release plan cross-review signoff invariants: every reusable release job checks out inputs.sha and uses that SHA for identity; reusable concurrency must not retain old per-ref pending replacement. just version validates final bumped/changelog state against origin/main before main-only push. Canonical-main design retires tag-only push release trigger; root must record this material change explicitly rather than claim tag-only backcompat.

## Implementation

- Wave 1: A/B/C dispatched concurrently after approved contract; A and B may write simultaneously against agreed API and disjoint files, B integration depends on A finishing
- Wave 2: D after finished code and mode gate
- Write-set interim check: git status --short shows ai-tab.tsx, field.tsx, preference-assistant.tsx, refine-preference.test.ts and this ledger only; all inside declared ownership, C not yet written
- C progress findings: Factual background reducers exclude styleGuide/editingRules. Later saved-text refresh may replace manually edited global story fields; CAS guards concurrency rather than durable ownership. Up-to-date status trusts persisted knowledge when no current-session saved fingerprint exists. First triggered refresh indexes all missing chapters; every run reads chapter files. Map/reduce fails atomically before commit except isolated character jobs. Audit documents observed limits without expanding implementation scope.
- A complete (worker report): only refine-preference.ts and .test.ts added. Exports PreferenceField, RefinePreferenceInput, RefinePreferenceOptions, refinePreference. Neutral per-field prompt uses JSON-quoted current/request; no authorSystem/settings/project access. Both-blank TypeError before I/O, trimmed validated output <=2000, frozen inputs/config, maxRetries 0 with shared retry, abort boundaries. Tests cover providers/fields, prompt/intent, invalid/full-cap output, frozen retries, final/model errors and cancellation. No local checks, commits or scratch by worker.
- C complete (worker report): only docs/architecture/background-ai-authoring.md written. Source-linked trigger/field/data matrices, saved-only sequence, model/prompts/evidence, ownership/persistence, approval boundaries, cost/failure limits, unproven save race with regression prerequisite, smallest proposed live/bidirectional design and test/proof matrix. Clearly labels synchronization as design only and preserves current author review. No checks or commits.
- B complete (root and worker report): assigned settings integration/helper/tests written. Source-only cross-review found no blockers; live Apply guards and cancellation ownership fit contract. This is preliminary static cross-review, not a pushed review round.
- Dropped low-priority B suggestion: keyConfigured availability transition remount can discard local typed steering (preference-assistant.tsx:236). Left unchanged to preserve current key-removal safety; no persisted preference loss. No checks run; not treated as a must-fix.
- B continuation: two one-click auto-generation regression cases observed red before correction, then green. Focused 45 tests passed (root report).
- E implementation: architect assigned .github/workflows/ci.yml, release.yml, scripts/check-release.ts/.test.ts, release-body.ts/.test.ts and justfile. Root separately updated package.json/Cargo.toml/tauri.conf.json/Cargo.lock to 0.18.0, added current-version changelog entry and AGENTS release policy.
- E reliability detail (architect evidence): tauri-action v0 reads/merges/deletes/reuploads latest.json across matrix jobs, creating a lost-platform race. Root approved max-parallel: 1 for existing signed three-platform matrix and same-draft Arch asset replacement on rerun; assigned file set unchanged. Upstream sources: https://raw.githubusercontent.com/tauri-apps/tauri-action/v0/src/upload-version-json.ts ; https://raw.githubusercontent.com/tauri-apps/tauri-action/v0/src/upload-release-assets.ts
- E seven-file implementation complete (architect report): stable CI check names match F; main reusable release waits all three gates; inputs/checkouts and concurrency keyed to exact SHA; platforms serialize within a release while different SHA releases may build concurrently. Same-SHA draft retry reuses release; published retry currently fails before build (not an idempotent no-op). Arch replacement requires draft. Focused tests/actionlint next.
- E retry disposition (root): Published same-SHA retry failing before build is accepted as explicit safer outcome; no published assets touched. Only unfinished-draft retry must succeed. Earlier no-op suggestion dropped; no duplicate released-commit build required.
- E integration amendment: strict main required checks block new direct main pushes. Existing version recipe will create codex/release-VERSION branch, commit/push that branch, and open ready PR through existing gh. It no longer directly pushes main or tags. Seven-file architect write ownership unchanged.
- F complete (root report): Composio PUT then independent GET confirms main branch protection strict=true; required contexts 'version + changelog', 'typecheck + tests', 'cargo test + clippy'; enforce_admins=true. No other policy extras. Exact API payload/readback proof held by root.

## Verification

- No local checks run by supervisor.
- Mode: local, explicitly authorized on continuation
- Gate running by root: just typecheck; frontend Vitest; just build; just test (frontend plus Rust); cargo fmt --check; cargo clippy --all-targets -- -D warnings
- Root-reported results: just typecheck pass; two regression cases red then green; focused 45 tests pass; just build pass.
- Root-reported full frontend: 123 files, 1431 tests pass. cargo fmt --check pass. Rust tests compiling.
- Root-reported full just test: frontend 1431 tests pass; 53 Rust tests pass. Formerly ignored DNS lane explicitly run, 1 pass; all 54 Rust tests executed. cargo fmt --check pass. Clippy active; isolated native QA app build active. Release-slice final verification remains pending.
- Root-reported clippy pass; debug macOS app bundle pass. Final E-slice gate still pending.
- Final full-suite/typecheck rerun active after release edits (root report).
- E architect results: scripts/check-release.test.ts + scripts/release-body.test.ts, 59/59 pass; actionlint on ci.yml and release.yml pass with shellcheck disabled because not installed; just dry-run release recipe rendered shell passes bash -n; actual check-release CLI against base 24e4aaa prints 0.18.0; git diff --check clean. Seven-file write set respected. Remote signed build/publication and recipe network steps unexecuted.
- Full gate ongoing: just test plus cargo fmt --check and clippy (Rust job concurrency 2); final gate must rerun for release-scope edits.

## PR and review

- PR: not opened; first commit/push pending local gate
- Round 1: pending
- Round 2: pending
- Round 3: pending
- Rounds 4-5: only if required by findings
- Simplification: pending clean review exit
- Exact-commit final gate: pending
- Merge: deferred for this turn; deliver commit/push and retain branch/worktree

## QA and deck

- Target: actual isolated native app built from worktree
- Method: real running app path; captured screenshots; no fabricated AI responses
- Proof convention: self-contained HTML under docs/slides/<topic>-2026-10-07.html
- Copy-out: primary checkout docs/slides; required before worktree removal
- Token/key: existing configured provider key available; no secret values recorded
- Result: pass (root report). Real selected OpenRouter/openai/gpt-6-luna calls from both existing voice and editing rules after one click; optional steering regeneration and manual preview edit also passed. Original unchanged before Apply; both exact final responses persisted after Apply; peer field preserved. Actual native CUA screenshots; no fabricated UI/model responses and user's installed novel not modified.
- Deck: docs/slides/ai-preference-help-2026-10-07.html; self-contained HTML with five captured screenshots, 1474956 bytes
- Delivered copy-out: /Users/jarredparr/Projects/aproprose/docs/slides/ai-preference-help-2026-10-07.html (copied before cleanup; open_in_codex queued)

## Follow-ups and residual risk

- Follow-ups: none identified
- Residual risk: synchronization remains audit/design; final release verification and remote signed publication still pending

## Current handoff status

- A/B/C files written; final source-only B cross-review complete with no blockers.
- Audit: /Users/jarredparr/.config/jp-skills/worktrees/aproprose/codex/ai-authoring-guidance/docs/architecture/background-ai-authoring.md (195 lines per worker/root report)
- User continuation resolves verification permission and authorizes commit/push.
- Confirmed code scope: two preference AI assistants; background synchronization remains audit/design only without implementation scope answer.
- No additional user questions needed. Root executes approved local gate, regression-driven one-click generation change, commit and push.
- New CI/release scope now included by direct user instruction; amended plans/write sets pending, intended version 0.18.0 for feature minor (not yet applied).
- GitHub up-to-date PR gate applied and independently read back: strict required checks with contexts 'version + changelog', 'typecheck + tests', 'cargo test + clippy'.
- Optional scope fallback: audit/design remains selected; no new background synchronization implemented.
- Preserve dirty dedicated worktree and all artifacts; do not claim pipeline complete or remove worktree.
- Cleanup tail read: /Users/jarredparr/Projects/jp-skills/skills/cleanup/SKILL.md. Supervisor made no tmp scratch; nothing removed. Task records retained; no version/changelog/other-skill records touched.
