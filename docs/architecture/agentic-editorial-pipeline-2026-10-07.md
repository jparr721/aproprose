# Agentic editorial implementation pipeline

## Intake

```text
task:      Implement the approved agentic editorial architecture, including further structural cleanup within its scope.
target:    main
branch:    codex/agentic-editorial
worktree:  /Users/jarredparr/.config/jp-skills/worktrees/aproprose/codex/agentic-editorial (created)
supervisor: /root/pipeline_supervisor
plan:      already-specified (agentic-editorial-design-2026-10-07.md and agentic-editorial-contracts-2026-10-07.md)
verify-mode: local - user explicitly answered "Run the full gate locally"
base:      origin/main at 28afd5d
original:  /Users/jarredparr/.codex/worktrees/bd7d/aproprose
```

- The approved plan names behavior, affected modules, a phased delivery plan and acceptance fixtures. Step 2 deliberation is skipped under the pipeline's existing-plan condition. Exact file ownership and cross-review still precede each implementation wave.
- The original checkout contains the two relevant planning documents. They were copied into this dedicated worktree; unrelated original-checkout content is excluded.
- The supervisor coordinates only. Implementation, review and QA run through distinct workers. Collaboration messages substitute for unavailable hub tools.
- Permission question required by [pipeline SKILL.md](/Users/jarredparr/Projects/jp-skills/skills/pipeline/SKILL.md): "Before the first verification run, the supervisor batches you one question: run the full gate locally, or keep verification to CI only (typechecks, tests, builds, and generators all included in the question)."
- No local typecheck, lint, test, build or generator ran before the user's choice. The explicit answer authorizes all local verification lanes, builds and generators for this pipeline without repeating the question.

## Verification surface

| Lane | Entry point | CI status | Requirements |
|---|---|---|---|
| Version and changelog | `bun run scripts/check-release.ts <base>` | Required | Target revision; synchronized version increase and changelog |
| Frontend typecheck | `just typecheck` | Required via `bun x tsc --noEmit` | Bun dependencies |
| Frontend full test suite | `bun x vitest run` | Required | Bun dependencies; Happy DOM |
| Chromium and WebKit | `just test-browser` | Required | Playwright browsers; Vite preview dependencies |
| Frontend production build | `just build` | Required in Rust CI job | Bun dependencies |
| Rust tests | `cargo test` in `src-tauri` | Required | Rust graph; built `dist`; platform development dependencies |
| Rust Clippy | `cargo clippy --all-targets -- -D warnings` in `src-tauri` | Required | Rust graph and platform dependencies |
| Rust formatting | `cargo fmt --check` in `src-tauri` | CI skips | Rust formatter |
| Native production bundle | `just bundle` | Release workflow, platform-dependent | Native tooling; release credentials only for signing/publishing |
| Generators | No general application generator documented | Not applicable | Version mutation script is covered by the local verification authorization |

- No nested JavaScript workspace was found in the initial manifest inventory.
- CI currently covers frontend typecheck, full frontend tests, both browser engines, frontend build, Rust tests and Clippy. Local formatting and applicable native-build proof remain additional surface.
- The repository requires every PR to increase the version across package, Cargo manifest/lock and Tauri config, with a matching first changelog entry. Current target is version `0.18.1`.

## Source drift

- The architecture was grounded at `c411d4312963d85ea14a99494a9865198fc69e68`; the implementation starts at newer `origin/main` `28afd5d`.
- The intervening diff changes 72 files. Relevant changes include preference assistance, notification settings, agent failure classification, agent persistence, project-store error paths, story refresh and automated signed releases. Workers must read the current files and retain those behaviors.
- `AGENTS.md` now requires a synchronized version bump and the complete version/frontend/browser/Rust checks before merge.
- During implementation, `origin/main` advanced to `e4c323c` (PR 71, persistent Changes panel, version `0.18.2`). It overlaps controller, types, prompts, proposals, messages and stores. Root must retain upstream Changes-panel behavior, resolve integration explicitly and rerun the full gate on the resulting tree. Our `0.19.0` remains increasing.
- Root delegated only `agent-messages.ts` and `agent-messages.test.ts` conflict resolution to Book worker. The merge preserves generic SDK settlement, new tool/question persistence and incoming nullable bridge anchors. Both completed-overview privacy/schema and failed-overview lifecycle regressions remain. Worker left staging/commit to root.
- Source merge completed at `886b465`. Upstream Suggest continues through `buildContinuationIntent` to the purpose-built bridge writer, retaining visible anchored continuation. The SDK next-beat action remains read-only; the toolbar follows the incoming user flow rather than replacing it with the earlier planned read-only route.

## Slice and wave contract

- First pipeline unit: lossless instantiated Book/content access, author authority, purpose-built specialist policies and automatic chapter investigation through the existing review system. This is the approved plan's initial coherent delivery, not a claim that every future slice is implemented.
- Subsequent slices retain the approved native journal, generalized whole-book command/workspace migration, source-save recovery and remaining domain/UI migration. Any requirement not delivered in the first unit must remain explicit in the final report.

| Slice | Owner | Exact write set | Dependencies | State |
|---|---|---|---|---|
| Book/content foundation | `/root/book_implementation` | `src/content/record.ts`, `src/content/record.test.ts`, `src/book/types.ts`, `src/book/projections.ts`, `src/book/book.ts`, `src/book/book.test.ts`, `src/book/index.ts`, `src/lib/ai/agent-types.ts` (ChapterToolValue alias only), `docs/architecture/book-foundation-slice-2026-10-07.md` | Existing canonical fingerprint/snapshot/outline helpers | Complete; 2 focused files and 8 tests passed |
| Specialist policy and author authority | `/root/specialist_implementation` | `src/agents/action-contracts.ts`, `src/agents/purpose-agent.ts`, `src/agents/index.ts`, `src/agents/action-contracts.test.ts`, `src/author/author-profile.ts`, `src/author/index.ts`, `src/author/author-profile.test.ts`; existing prompt/operation/background exact files in specialist P1/P2, including `agent-compaction.ts` and its test | Action registry; frozen Author contract | Implementing regression-first |
| Editorial startup and integration | Root executor | `src/editorial/index.ts`, `src/editorial/editorial.ts`, `src/editorial/editorial.test.ts`, `src/app/editorial.ts`, `src/lib/ai/agent-controller.ts`, `src/lib/ai/agent-controller.test.ts`, `src/lib/ai/agent-runtime.ts`, `src/lib/ai/agent-runtime.test.ts`, `src/lib/outline/planner-grounding.ts`, `src/lib/outline/planner-grounding.test.ts`, `src/components/app/outline/chapter-subview.tsx`, `src/components/app/outline/chapter-subview.test.tsx`, `src/components/app/block/block-toolbar.tsx`, `src/components/app/block/block-toolbar.test.tsx`, `src/stores/agent-persistence.ts`, `src/stores/agent-persistence.test.ts` | Book and specialist foundation handoffs | Parallel only on disjoint files |
| Post-foundation type integration | Root executor after Book handoff | `src/lib/ai/agent-types.ts` | Book worker completes ChapterToolValue alias | Book handed off; root owns subsequent edits |
| Version and changelog | Root executor | `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, `changelog.json` | Current target version | Pending implementation completion |
| Browser QA and deck | Root executor or assigned QA worker | Exact test, fixture, capture and deck paths declared before QA work | Running changed app and configured inference | Pending |
| Catalog binding and coverage | `/root/book_implementation`, then root after handoff | `src/lib/ai/agent-tools.ts`, `src/lib/ai/agent-tools.test.ts` | Book foundation and specialist capability contract | Complete; handed back to root |
| Persisted author question rendering | `/root/book_implementation`, then root after handoff | `src/lib/ai/agent-messages.ts`, `src/lib/ai/agent-messages.test.ts`, `src/components/app/agent-console/agent-message.tsx`, `src/components/app/agent-console/agent-message.test.tsx` | Catalog `ask_author`; current persisted conversation format | Complete; handed back to root |

- Each implementation wave records exact file ownership before dispatch. Two concurrent workers cannot share a write path.
- Changed paths are checked between waves. An unexpected path requires review before proceeding.
- No silent narrowing of the accepted architecture. A deferred requirement remains explicit and cannot be reported complete.
- Book worker cross-reviewed the specialist plan: P1/P2 have no overlap; P3's projected `agent-types.ts` edits wait until Book handoff. Planner grounding must consume the canonical Book projection rather than duplicate formatting.
- During the foundation wave, Book alone owns `agent-types.ts`. Root edits to that file occur only after explicit handoff.
- Specialist P1 lists `agent-compaction.ts` and its test. Root's optional edits overlap and are excluded during that worker's wave until ownership is explicitly handed off.
- Specialist confirmed final ownership of compaction and its test; root retains controller summarization integration only.
- Specialist explicitly owns `src/lib/story-knowledge/prompts.ts`, authorized in root's initial assignment. It centralizes the five background prompts using the shared author context; no other worker writes it. The specialist plan is updated to include this exact path.
- Specialist implementation handoff is accepted by root. Root owns subsequent integration/gate fixes in those paths; the specialist has moved to read-only QA readiness investigation.
- Root accepted the Book plan: lazy injected reads and semantic schema have no missing dependency beyond root's controller integration. Specialist cross-review also requires one Book-owned target projection, and keeps next-beat task/persistence/type integration with root after handoff.
- The catalog wave transfers `agent-tools.ts` and its test from root to Book worker. It binds the same Book instance, provides manifest/metadata/character/search/range reads, and owns one capability-to-tool mapping with host enforcement. Root continues controller/runtime/UI on disjoint paths.
- Catalog implementation is handed back to root after focused success: 18 tools include author questions and derived story knowledge, with one mapping governing both SDK exposure and host handlers. Root owns subsequent integration fixes in those files.
- Root additionally owns `src/lib/ai/agent-proposals.ts` and `src/lib/ai/agent-proposals.test.ts` for next-beat read-only proposal defense. No other worker writes these paths.
- Root owns subsequent `src/lib/ai/agent-flow.test.ts` expectation updates for capability denial and complete semantic transcripts. These are contract assertions, not narrowed execution or deleted cases.
- Book worker's question-rendering wave proves `ask_author` round-trip persistence and renders tool-only question Cards after reopening. The existing composer records the actual author answer; the model does not answer its own question.

## Regression receipts

| Invariant | Command | Initial result | Disposition |
|---|---|---|---|
| Plan with AI begins investigation after hydration | `bun x vitest run src/components/app/outline/chapter-subview.test.tsx` | Exit 1; 4 passed, 1 failed. New regression expected one automatic submit, observed zero. | Reproduced before root fix; stand-alone bug-fix commit required |
| Master editor/planner missions and author authority | `bun x vitest run src/lib/ai/author-preferences.test.ts src/lib/ai/agent-prompts.test.ts` | Exit 1; 2 files, 4 failed and 16 passed. Failing cases: rigorous editor without universal minimal-change bias; planner starts from existing draft and one consequential question; complete declarations retained; declared wishes outrank craft defaults. | Reproduced before specialist fixes |
| Both foreground analyses retain editing rules | `bun x vitest run src/lib/ai/operations.findings.test.ts` | Exit 1; 1 file, 2 failed and 10 passed. Critique and continuity lacked frozen analysis editing rules. | Reproduced before specialist fixes |
| All five background specialists retain frozen declarations | `bun x vitest run src/lib/story-knowledge/operations.test.ts` | Exit 1; 1 failed and 13 passed. Frozen style and editing declarations were absent across the background specialists. | Reproduced before propagation fixes |
| Complete dialogue reaches controller tools | Controller focused regression; exact command pending root receipt | Initial old projection failed because speaker, tail and citationText were missing. | Reproduced before controller projection replacement |
| Read-only specialist cannot stage manuscript edits | `bun run test src/lib/ai/agent-tools.test.ts` | Exit 1; 1 failed file, 19 tests, 5 failed and 14 passed. Host guard case resolved a runtime proposal instead of rejecting; four other failures were absent catalog features. | Reproduced before single capability mapping was enforced at exposure and handler boundaries |
| Registered tools persist and question-only replies render | `bun run test src/lib/ai/agent-messages.test.ts src/components/app/agent-console/agent-message.test.tsx` | Exit 1; 2 failed files, 4 failed and 30 passed. Duplicate settle allowlist rejected registered tools and tool-only question UI was blank. | Reproduced before descriptor-registry validation and restored-question Card rendering |
| Existing overview proposal survives settling | `bun run test src/lib/ai/agent-messages.test.ts` | Exit 1; 3 failed and 20 passed before the broader whitelist fix. `stage_overview` shared the same root cause. | Existing bug expanded into regression coverage; root asked to retain stand-alone bug-fix commit |
| Source authority remains present without declared preferences | `bun x vitest run src/lib/ai/author-preferences.test.ts` | Exit 1; 1 failed and 9 passed. Empty author preference values omitted the authority contract. | Fixed before commit; preference/profile focused rerun passed 11 of 11 |

## Focused implementation receipts

| Owner | Command | Result |
|---|---|---|
| Book | `bun run test src/book/book.test.ts src/content/record.test.ts` | Exit 0; 2 files and 8 tests passed |
| Book | `git diff --check -- src/content src/book src/lib/ai/agent-types.ts docs/architecture/book-foundation-slice-2026-10-07.md` | Exit 0 |
| Book | `bunx tsc --noEmit` | Initial integration run red: own branded-ID comparison corrected; old controller projections and next-beat integration remained pending root work. Not a passing aggregate gate. |
| Root | `bun x vitest run src/components/app/outline/chapter-subview.test.tsx src/editorial/editorial.test.ts` | Exit 0; 8 of 8 passed; stand-alone bug fix committed as `5bd8e5c` |
| Root | Controller integration focused run; exact command pending receipt | 79 of 80 passed; old exact compaction system assertion pending update to the newly planned author contract. Not an aggregate pass. |
| Root | Grounding focused run; exact command pending receipt | 7 of 7 passed |
| Specialist | `bun x vitest run src/lib/ai/author-preferences.test.ts src/lib/ai/agent-prompts.test.ts src/lib/ai/operations.findings.test.ts src/lib/ai/refine-preference.test.ts src/lib/story-knowledge/operations.test.ts src/lib/story-knowledge/refresh.test.ts src/stores/story-refresh-store.test.ts src/lib/ai/agent-compaction.test.ts src/author/author-profile.test.ts src/agents/action-contracts.test.ts` | Exit 0; 10 files and 123 tests passed |
| Specialist | `just typecheck` | Exit 2; concurrent root/catalog integration fields and unused controller import remained. Not an aggregate pass. |
| Catalog | `bun run test src/lib/ai/agent-tools.test.ts src/book/book.test.ts src/content/record.test.ts` | Exit 0; 3 files and 28 tests passed |
| Catalog | `bunx tsc --noEmit` | Exit 2; root-owned unused controller import and exhaustive tool-descriptor map pending seven new names. Book/content/catalog types were clean. Not an aggregate pass. |
| Question UI/persistence | `bun run test src/lib/ai/agent-messages.test.ts src/components/app/agent-console/agent-message.test.tsx` | Exit 0; 2 files and 35 tests passed. Completed question input persists exactly without an answer field; read bodies are removed and restored questions render. |
| Question UI/persistence final | `bun run test src/lib/ai/agent-messages.test.ts src/components/app/agent-console/agent-message.test.tsx` | Exit 0; 2 files and 36 tests passed after adding completed dynamic question and failed/unexecuted-attempt coverage. All four paths handed back to root. |
| Question UI/persistence whitespace | `git diff --check -- src/lib/ai/agent-messages.ts src/lib/ai/agent-messages.test.ts src/components/app/agent-console/agent-message.tsx src/components/app/agent-console/agent-message.test.tsx` | Exit 0 |
| Question UI/persistence typecheck | `bunx tsc --noEmit` | Exit 0; session `19993` completed after handoff |
| Message conflict resolution | `bun run test src/lib/ai/agent-messages.test.ts` | Exit 0; 1 file and 24 tests passed; scoped whitespace/conflict-marker checks clean |

- Root explicitly defers relocation of the canonical fingerprint/snapshot helpers from AI context into a shared source module. The first unit reuses them to avoid duplicated truth; later extraction remains a structural opportunity.

## Aggregate gate receipts

| Lane | Command | Result |
|---|---|---|
| Frontend typecheck | `just typecheck` | Exit 0 |
| First full frontend suite | `bun x vitest run` | Exit 1; 132 files passed and 1 failed, 1626 tests passed and 3 failed. Three agent-flow expectations required new capability denial/citationText contracts. Full rerun remains required. |
| Full frontend suite after integration fixes | `bun x vitest run` (captured in `/tmp/aproprose-agentic-vitest-final.log`) | Exit 0; 1636 of 1636 tests passed. New target merge requires another full rerun. |
| Agent-flow regression after correction | Focused agent-flow run; exact command pending root receipt | 11 of 11 passed |
| Browser suite | `just test-browser` | Exit 0; 24 of 24 passed across Chromium and WebKit |
| Frontend production build | `just build` | First run exit 0; exact final-tree rerun in progress |
| Version/changelog | `bun run scripts/check-release.ts origin/main` | Exit 0; `0.19.0` synchronized across all four version files and changelog |
| Rust formatting | `cargo fmt --check` in `src-tauri` | Exit 0 |
| Rust tests | `cargo test` in `src-tauri` | In progress; reached aproprose crate compilation |

- A green focused rerun does not replace the required aggregate rerun. No push or PR gate is satisfied while the full suite/build remains pending.
- Current rerun sessions: typecheck `86257`, full Vitest `86652`, frontend build `80953`; Rust tests `58276`. Session IDs are coordination handles, not success receipts.
- Post-merge full suite runs `bun x vitest run`, captured in `/tmp/aproprose-postmerge-vitest.log`; post-merge build also runs again. A build begun during conflict resolution saw a transient package-JSON conflict marker and failed; no settled-tree build success is inferred from that attempt.
- Supervisor pauses repository ledger writes after this handoff so root can commit/stage the initial ledger cleanly before PR. Later review/gate/QA notes stay in supervisor scratch and mailbox until root requests the final append.

## Commit boundaries

| Commit | Purpose | Evidence |
|---|---|---|
| `5bd8e5c` | Begin chapter investigation when opening AI planning | Red UI reproduction then 8 of 8 focused tests passed |
| `feadc4b` | Repair overview-history tool settling, safe overview inputs and regression | Expanded duplicate-allowlist bug coverage before fix |
| `cc4be77` | Preserve complete author declarations and source authority | Initial author/prompt failures plus empty-author-preference failure before fixes |

- The approved design/contracts now distinguish the delivered first unit from remaining long-term API sketches; they no longer claim that all app behavior is unchanged.

## Review and ship state

```text
verification: local authorized; first gate pending
pr: pending
rounds: 0/5, min 3
must-fix: not yet reviewed
simplify: pending
merge: pending exact-commit gate and clean review exit
qa: pending real-data application proof
deck: pending HTML under docs/slides, with surviving copy in the original checkout
```

- Review rounds operate on the pushed diff. Each requires all review angles, adversarial reconciliation and a verdict block.
- Review exits after an APPROVE at round 3 or later, or stops at round 5. A BLOCK or an uncovered design change escalates immediately.
- Simplification runs once after clean review exit, followed by verification in the chosen mode; it does not create another review round.
- Main merges automatically publish a signed release after required CI succeeds. The accepted pipeline authorizes merge when its gates pass.
- QA is mandatory and must exercise real changed behavior. An HTML deck follows the repository convention in `docs/slides/` and is copied out before cleanup.

## QA readiness

- Read-only readiness investigation found configured native inference and both provider key entries. Selected model is `openai/gpt-6-luna`; secret values were not emitted or recorded.
- The real project (kept private) contains the screenshot's Dad and Bagel chapter source. QA should use an owned copy rather than mutate the user's original project.
- The repository has a prior native macOS proof workflow with real provider requests. Existing Playwright setup proves isolated browser fixtures; it is not a full-app Tauri bridge.
- Planned proof target is an isolated native app/configuration and copied real project. No live mutation, fabricated inference, or mock screenshot has occurred in readiness work.
- QA worker `/root/specialist_implementation` owns local deck `docs/slides/agentic-editorial-2026-10-07.html`. Captures of the unpublished real manuscript remain in owned scratch during QA and are never committed or pushed to GitHub. Final self-contained HTML embeds screenshot bytes and is copied locally to `/Users/jarredparr/.codex/worktrees/bd7d/aproprose/docs/slides/agentic-editorial-2026-10-07.html` after merge. This retains the repository location convention without publishing private prose.
- Owned QA scratch is `/Users/jarredparr/.config/jp-skills/tmp/pipeline/aproprose-agentic-qa`; isolated native configuration is `~/Library/Application Support/com.jsp.aproprose.agenticqa`. Key copies are protected, never logged, and must be removed by their owner during cleanup. Original book/configuration remain untouched.
- Native proof waits for root's frontend/Rust launch handoff; setup alone is not QA success.
- Native interaction/capture is held while root merges `e4c323c` and resolves HMR integration. The QA worker resumes only on root's explicit handoff.
- Native QA launch session `25900` reached Vite on port `1445`; Cargo was waiting on the shared target artifact lock. Tauri CLI reported `tauri v2.12.1` versus `@tauri-apps/api v2.11.0` version mismatch but continued. No dependency change/workaround was applied; root owns its disposition. This launch is pending, not a passing proof.


## Superseding pipeline state - 2026-10-08

This section supersedes the earlier pending status blocks, transient integration failures and QA launch notes. Those entries remain as history; they are not current completion claims.

- PR: [Agentic editorial implementation, PR 75](https://github.com/jparr721/aproprose/pull/75), target `main`, dedicated branch `codex/agentic-editorial`.
- Verification mode: local, explicitly authorized by the user for the entire pipeline. The supervisor owns coordination and this ledger only; root owns integration, verdicts and commits.
- Review: five complete rounds, minimum three and cap five. Every round used five fresh read-only angles on the whole pushed diff. Final verdict is `FIX-THEN-SHIP`, four findings; no `APPROVE` occurred.
- Cap disposition: repair the four accepted findings, verify, push and stop. No sixth round and no merge. The last repairs are explicitly unreviewed by a subsequent adversarial round. Simplifier was not reached because its clean-approval prerequisite was not met.
- Latest reviewed/pushed head: `03f913a9e3a7f566e90a7c20d9277e12e5790761`. Final repaired application head: `4de9c7c1cc81021d45c0a2aeda98144c15e849ba`. Final exact Gate 9 must run after this document commit; final native QA remains pending.
- Keep the dedicated worktree and ready PR for continuation. Do not archive or claim delivery to `main`.

### First coherent implementation unit

- Instantiated Book/content read boundary with injected loaders, immutable semantic projections, on-demand discovery/search/range reads and the same Book instance behind the tool catalog. Complete dialogue, scene, lore and citation semantics remain accessible.
- Author declarations and current settings govern specialist instructions; writing, literary editing, chapter planning, cleanup, structure, continuity, character work, preference refinement, compaction and background knowledge use their specific purpose contracts.
- Plan with AI hydrates existing chapter/cards, begins source-grounded investigation automatically, asks the author focused questions, and stages linked-card or supported manuscript/overview changes through existing review decisions. Tool-only questions persist and render after reopening.
- The first unit does not deliver generalized whole-book write commands, native command journal, full editorial issue/workspace migration or all future domain/UI migrations. The approved architecture retains those subsequent slices. Canonical fingerprint helper relocation remains deferred rather than duplicated.

### Source integration and release boundary

- The plan was grounded at `c411d43`; implementation began on `28afd5d`. Incoming `e4c323c`/PR 71 persistent Changes behavior was merged and preserved.
- Incoming `827e65a`/PR 74 resolved Tauri dependency parity; retained upstream API `~2.12.1` and CLI `2.11.2` without additional upgrades. Final local gates retain that base until explicitly changed.
- Version `0.19.0` is synchronized across the four version files and changelog. Native production proof is `tauri build --no-bundle`; it does not establish signing, installer packaging or a published release.

### Complete review history

| Round | Whole pushed head | Verdict | Accepted findings and disposition |
|---|---|---|---|
| 1 | `a25fb0a` | FIX-THEN-SHIP, 4 | Unauthorized bundled overview, hydration transition, uncaptured unsaved active reads and lossy planner semantics. Separate fixes `8ccce16`, `c801809`, `8ec57eb`, `8ca499a`. |
| 2 | `8ca499a` | FIX-THEN-SHIP, 3 | Mixed end insertion order `09bd043`; stale scoped StoreApi subscription `bbd4195`; successful storage Retry does not auto-start `413734c`. Cheap truthful planner mission correction `1a1fda1`; whitespace-only `c654ec2`. |
| 3 | `413734c` | FIX-THEN-SHIP, 2 | Rejected Book load cached forever `dac47ef`; empty preflight error prevents planner recovery `8348304`. |
| 4 | `8348304` | FIX-THEN-SHIP, 2 | Null-anchor bridge displaces non-prose prefix `3f173c4`; follow-up loses original specialist purpose/scope `097d754`, with exact persisted-origin test expectation correction `03f913a`. |
| 5 | `03f913a` | FIX-THEN-SHIP, 4; cap reached | Same-run supersession `8725df6`; guessed historic mode authority `dfc2fff`; valid non-prose selection rejection `485c034`; duplicate selection identity `4de9c7c`. These repairs have no later review round. |

- Root acted Level/Splinter and issued every formal verdict. Each surviving candidate received exactly one defense; duplicate findings were deduplicated, with no dissent or waived must-fix. No code edits occurred during review.
- Round 1 reverse outline-add ordering was conceded under existing append-at-approval semantics. Round 3 duplicate-card locator hypothesis was pre-existing without new-diff proof. Round 4 universal mixed move/insert commutativity was conceded because current preview exposes approval-time placement. These were not silently counted as fixed defects.
- Fresh sessions were preserved despite definitive `agent thread limit reached` dispatch failures. Round 2 used supervisor children; later rounds used a coordination-only specialist dispatcher with unused child capacity. Implementation reuse never counted as fresh review. Resource waves respected four active slots.
- Exact Round 5 reviewers were `/root/specialist_implementation/r5_spec`, `r5_breaker`, `r5_failure`, `r5_proof`, `r5_shape`, all fresh `fork_turns: none`, no model override, resource waves 2+2+1. FAILURE returned zero findings after 12 focused files/922 tests.

### Round 5 accepted findings and unreviewed repairs

Locations below refer to reviewed head `03f913a`, before repairs.

| Finding | Concrete proof and sole-defense result | Repair and regression receipt |
|---|---|---|
| P2 historic mode authority, `src/lib/ai/proposal-origin.ts:155` | Actual SDK old-v4 Writing record followed by Edit pins guessed Edit; JSON reopen then Writing still uses literary-editor. Defense separated old first-turn behavior from newly persisted second-turn authority. | `dfc2fff`: recover known original metadata; persist explicit legacy mode when unknown; reject conflicting metadata before provider. RED 3; GREEN 5 files/298; typecheck/diff exit 0. |
| P2 same-run supersession, `src/lib/ai/agent-controller.ts:1748` | Actual SDK stages Draft 1, reads pending, stages same-kind Draft 2; JSON reopen leaves both actionable and obsolete Apply stales intended Draft 2. Defense proved this is exposed by the new multi-step run. | `8725df6`: supersede pending same-run/same-kind/same-chapter predecessor through existing lineage; preserve history. RED 5 failed/2 passed; GREEN 4 files/513; typecheck/diff exit 0. Three real SDK proposal kinds cover read/stage/reopen, old Apply refusal and final Apply success. |
| P2 valid selected types, `src/lib/ai/proposal-origin.ts:66` | Actual controller/SDK base-versus-head initial and JSON/reparse LaTeX Structure/mixed Clean: head refuses pre-provider while public UI/base succeed. | `485c034`: actual selected block type with strict resolved type equality for all six block types; Bridge remains prose-only. RED 2; targeted GREEN 2; compatibility 6 files/342; typecheck/diff exit 0. |
| P2 duplicate identity, `src/lib/ai/proposal-origin.ts:46` | Real deletion of selected duplicate followed by controller/SDK rewrites the surviving unselected identical block. Defense distinguished live deletion from true regenerated parse IDs. | `4de9c7c`: stable generation across all saves, live mutations and history; renew only on published native chapter parse; refresh strict locator mapping after legitimate parse. Old identityless missing IDs and count-reminted save IDs require restart. RED 4 actual SDK cases plus separate save-count RED 1; GREEN 8 files/513; typecheck/diff exit 0. |

- Repair ownership was cross-reviewed before production edits. Root owned only same-run replacement store/test/flow paths; specialist repaired three origin bugs sequentially and stopped for each standalone root commit. The last identity repair additionally owns only project-store implementation/test beyond the origin files, explicitly approved.
- No broader generic scope, speculative mixed-operation ordering rule or generalized book-write feature was added to resolve these findings.

### Aggregate verification and CI

| Gate | Exact head | Result |
|---|---|---|
| 5 | `413734c` | All 12 lanes exit 0: 2147 frontend, 24 browser, 54 Rust and all type/lint/format/web/native/release/diff lanes. |
| 6 | `8348304` | All 12 exit 0: 2162 frontend, 24 browser, 54 Rust; clean head before/after. CI run 37739437665 all required green. |
| 7 | `097d754` | Exit 1: 11 lanes green, frontend 2294 passed/1 failed. Sole failure was exact stopped-project persisted-origin expectation at agent-flow.test.ts:2262. |
| 8 | `03f913a` | All 12 exit 0: 138 frontend files/2295 tests, 24 Chromium/WebKit, Rust 53 plus separately ignored DNS 1; clean exact head/base before/after. CI run 37743221719 success on verified pushed head. |
| Final Gate 9 | Pending final document commit | Must run after all repairs and this final ledger update are committed, writers stopped, exact HEAD/base and clean tree verified. No result claimed. |

- Gate 7's standalone test correction `03f913a` added only five expected source.origin lines. Usage, transcript, proposal and ordering assertions were preserved; whole agent-flow 11 tests passed before full Gate 8.
- Every full runner collects typecheck, full frontend suite, Chromium/WebKit, web build, Rust, separate ignored DNS, Clippy with `-D warnings`, Rust formatting, native production, version validation, release body and whole-branch whitespace check. No focused pass substitutes for the final exact gate.
- Existing nonfatal Vite chunk-size and STATIC_VCRUNTIME warnings did not fail lanes. No compiler failure was ignored.

### Native QA, private proof and stop state

- Historical pre-cap native QA used a disposable real-project copy, isolated native app/config and actual provider requests. It demonstrated automatic chapter question, real author answer, staged cards, partial Apply, native restart, restored question/proposal/decision and remaining-card Apply. Settings AI help retained long declarations and Cancel left settings unchanged. Original source/meta hashes remained unchanged; only intended copied-card metadata was applied.
- That historical proof does not validate the final repaired head. Final native QA on the final worktree head is still mandatory and pending: automatic semantic question plus real right-sidebar Writer and Editor flows, distinct specialist behavior and key persisted/review states.
- Screenshots and deck contain unpublished source and remain local only. Do not commit or push private manuscript identity/path/prose or provider keys.
- Final self-contained HTML is copied to original checkout `docs/slides/agentic-editorial-2026-10-07.html` and `qa-decks/agentic-editorial/` before owned scratch/config/key cleanup. Common Git excludes protect these local artifact paths.
- Keep the worktree and open PR after cap-stop. Merge, signed release and final QA completion are not claimed.
