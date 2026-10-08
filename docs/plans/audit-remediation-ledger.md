# Audit remediation pipeline ledger

- Task: resolve all 25 findings from the code-quality audit in one PR.
- Acceptance source: `docs/plans/audit-remediation-task.md` and the audit in the initiating conversation.
- Target: `main`; intake commit `d49a55b`, intermediate fetch `0892020`, actual integrated baseline `7e80500` (target advanced again during fetch).
- Branch: `codex/audit-remediation`.
- Worktree: `/Users/jarredparr/.config/jp-skills/worktrees/aproprose/codex/audit-remediation` (created, dedicated).
- Starting checkout: `/Users/jarredparr/.codex/worktrees/385b/aproprose` (application files untouched).
- Supervisor: `/root/pipeline_supervisor`; coordinates only, never implements, reviews, or proves QA.
- Communication: collaboration messages provide the available hub equivalent; worker questions route through the supervisor.
- Planning: party required; audit findings describe acceptance but do not provide a complete file-disjoint implementation plan.
- Verify mode: `local`, explicitly authorized by user: "hammer local that's fine". This covers full local typechecks, lint/format, tests, builds, and generators. Step 4 is active.
- Merge: pipeline default gated merge authorized by explicit invocation; no separate merge permission question.
- Merge convention: merge commits, based on recent `Merge pull request` history.

## Verification surface at intake

| Surface | Commands | CI coverage / requirements |
| --- | --- | --- |
| Frontend typecheck | `just typecheck` / `bun x tsc --noEmit` | CI frontend job |
| Frontend tests | `bun x vitest run` | CI frontend job; all `src/**/*.test.{ts,tsx}` and `scripts/**/*.test.ts` |
| Frontend production build | `just build` / `bun run build` | CI Rust job builds frontend before native checks |
| Native tests | `cargo test` in `src-tauri` | CI Rust job; `just test` combines frontend and native suites |
| Native ignored network lane | `cargo test -- --ignored` in `src-tauri` | CI skips ignored NXDOMAIN `.invalid` network test; must be named and executed in authorized local mode or reported unrun |
| Native lint | `cargo clippy --all-targets -- -D warnings` in `src-tauri` | CI Rust job; `just fmt` runs formatting plus less strict Clippy |
| Native format | `cargo fmt --check` in `src-tauri` | Not currently in CI |
| Native production bundle | `just bundle` | Release tag workflow only; affects app and updater artifacts |
| Linux Arch package | `just arch-package` | Release Linux build only; requires Linux packaging tools |
| Native single-instance smoke | `bun run scripts/smoke-single-instance.ts <binary>` | Not in CI/justfile; requires Linux, Wayland, Hyprland, private DBus, built native binary |
| Generators | `scripts/set-version.ts`, `scripts/generate-changelog.ts` | Release mutators, not idempotent generators; no release/version bump authorized |

- Dependency setup: `just setup` completed (Bun dependencies and Rust graph). Remaining requirements: macOS native SDK; browser automation for UI integration; LaTeX tools for actual compilation proof when available.
- No nested JS workspaces or additional package manifests found in the repository verification surface.
- Release currently guards version, builds macOS/Linux/Windows, checks updater platform keys/notes and Arch assets, then publishes independently of current-SHA CI validation. Finding 25 changes this contract.

## Party and slices

- Party completed two substantive rounds. Fresh initial personas: Architect, topic-research, QA/UX, Wildcard, Level, Killjoy, Splinter. Killjoy ended debate after concrete objections resolved.
- Consensus contract: `docs/plans/audit-remediation-plan.md`, including its cross-review corrections, is the exact slice/write-set authority.
- Prior art accepted: existing tempfile/std for same-directory durable writes, explicit pre-replacement preservation and post-replacement uncertainty; existing Git CLI with NUL machine protocols; existing shadcn Field/Card/Typography/FindOptionToggle and resizable panels; portable `@playwright/test` devDependency for finding 24. Playwright fills missing real-browser automation, has maintained upstream tooling, and avoids nonportable absolute Codex runtime paths. No other dependency requested.
- Native sync wire frozen: `{ outcome: SyncOutcome, changedFiles: string[] }`; terminal failures after pull include `{ kind: "error", message: string }` so changed paths survive.
- Wildcard/Level corrections accepted: lifecycle generation handles A-B-A; dirty remote divergence blocks blind save/build; changed paths survive failed push after successful pull; skeleton mutation models derive from current owned state at execution; 960px cannot fit all panes horizontally, so narrow editor/PDF panels stack while preserving flags/state; outline+AI and editor+PDF+AI are separate supported combinations.
- Killjoy acceptance correction: complete old bytes are guaranteed for pre-replacement write failure, while post-replacement synchronization failure reports uncertainty; multi-file operations report exact partial outcomes without a generic transaction engine.
- QA/UX corrections accepted: real focus/keybinding tests, existing semantic Field labels, shared stateless backup schedule fields, actual native disposable-project proof under isolated app identity, and actual-provider/other-platform proof marked unrun unless executed.
- Splinter's exit-guard dependency objection resolved: P owns `src/lib/exit-guard.ts` and its test; U owns update-checker component and test. P also owns backup message formatting and its test. These ownership additions amend the plan table.

| Wave | Slice / owner | Findings | Boundary |
| --- | --- | --- | --- |
| 1 | N / `/root/party_killjoy` | 04 native, 05, 06, 10, 11, 12, 22, 23 | Eight Rust files from consensus table, including sole ownership of `lib.rs` integration |
| 1 | P / `/root/party_splinter` | 01, 02, 03, 04 frontend, 08, 09, 13, 24 adapter | Project/sync/storage lifecycle, bridge/types, chapter transition callers, exit guard, backup messages; exact plan set plus recorded additions |
| 1 | U / root | 07, 14, 15, 16, 17, 18, 19, 20 editor | Authoring/settings/backup/AI UI and editor interactions; exact plan set plus update-checker |
| 2 | C / root-dispatched worker | 20 controller | Controller composition files only; source complete, execution verification pending |
| 2 | H / root-dispatched worker | 21 | Agent persistence protocol files only; source complete with coordinator characterization regressions and existing exports preserved |
| 2 / integration | A release / `/root/party_splinter` | 25 | CI/validate/release workflows, release asset validator and tests, artifact smoke script, justfile, package/bun dependency setup if needed |
| 2 / integration | A browser / root | 24 browser, QA deck | Browser/workshop files, `tsconfig.browser`, isolated QA config and deck; disjoint from A release |

- Cross-review: N signed off the frozen native/frontend boundary; N/P cross-review underway. Root schedules only disjoint write sets concurrently.
- Worker instruction: regression tests precede bug fixes, but execution remains prohibited until verification mode is answered. No local gate has run.

### Implementation checkpoint

- N, P, and root U are implementing their disjoint assigned files; C/H wait for stable P contracts.
- N/P/UI regression tests were written before fixes. They cover delayed saves and new edits, changed document ownership, compile-after-save-failure, reordered and edited-during-load reads, corrupt project metadata, current skeleton model, dirty remote write gates, sync initialization/A-B-A/finalizers, failed-push reconciliation, native adapter/Zustand failures, exit ownership, accessible labels, hidden shortcuts, AI failure, and shared backup scheduling.
- Root reports shared Field/Card/FindOptionToggle adoption, extracted editor interactions, and container-based editor/PDF stacking below 720px main-panel width.
- No local tests, typechecks, builds, or generators have executed; verification mode is still pending. Written tests are not yet claimed as passing or observed failing in this pipeline.
- P reported an authoritative existing outline regression requiring queued acknowledged metadata writes to drain at their captured root across close/reopen. Resolution sent to root and subsequently ratified below: captured-root durable writes may finish under the shared queue, while lifecycle generation gates every UI side effect; remote-change epochs invalidate stale queued writers and project load waits for the root queue. No existing test weakened.

### Source completion checkpoint

- Root reports N, P, and C source changes and regression tests complete. This is implementation status only, not a correctness or passing-test claim.
- H persistence protocol implementation remains in progress.
- Root ratified the narrow metadata-write compatibility contract: captured durable metadata drains at its captured root; remote revisions invalidate old queued writes; loads wait for the shared root queue. Existing close/reopen expectations remain authoritative.
- `/root/party_splinter` moved from completed P source work to the disjoint A release write set. Root retains U plus browser/workshop/`tsconfig.browser` and isolated QA configuration.
- U integration now includes remote-divergence banner and exit protection, shared Field/Card/Slider semantics, responsive Find, and extracted editor interactions.
- Reusable frontend/browser validation and platform-native matrix are drafted. Playwright and Minisign installed as dependency setup; installation is not verification and does not imply runtime/package proof.
- User has not answered the required local-versus-CI async question. No approval inferred; no local checks run. Gate, PR, review rounds, simplification, merge, and real-data QA/deck remain pending.

### Integration contract correction

- Root identified a finding 04 race during source integration: post-pull metadata capture cannot distinguish optimistic metadata edits made during native sync. The remote epoch invalidates an older queued write, but a post-pull-only capture can then reload remote metadata over the live edit.
- Accepted within existing scope: regression first, then typed `ProjectSyncSnapshot` containing lifecycle generation, edit revision, and metadata captured immediately before native sync; reconciliation receives that snapshot and checks all three after completion. Concurrent live edits retain divergence protection instead of being replaced.
- This is an integration implementation amendment, not a review-loop round or additional feature. No local verification executed while mode remains pending.

### Pre-verification handoff

- H source complete with coordinator characterization regressions and preserved exports.
- U, browser workshop/regression suite, and isolated native QA configuration source complete.
- A release nearly complete: tagged-SHA reusable validation, platform-native artifact smoke, and Minisign verification before publication are wired; final worker handoff pending.
- Root fixed the pre-pull metadata race with the required third `ProjectSyncSnapshot` reconciliation argument after writing two regressions. Additional canceled queued-compile and remote-invalidation idle-settlement regressions preceded the stale-spinner fix.
- All source remains unverified. No local typecheck, test, build, format, or generator executed; no commits, push, or PR created.
- Required first gate is waiting for explicit local-versus-CI choice. The pending question remains authoritative; elapsed time is not approval.
- `commit-and-push` skill is absent from searched local catalogs. After the chosen gate is green, use equivalent logical standalone bug-fix commits, normal hooks, push, one ready `gh` PR, and artifact attachment; do not bypass hooks or imply a missing skill ran.
- Full gate must account for ignored Rust network test using NXDOMAIN `.invalid`; the Hyprland/Wayland/private-DBus smoke is platform-specific and cannot execute on this macOS host. Report that lane explicitly rather than silently dropping it.
- Exact next required action: obtain the pending verification-mode answer, then execute the chosen Step 4 gate before any commit/push/PR. Independent final A source handoff may complete while waiting.
- Preserve dedicated worktree and all source while waiting. No worktree removal or proof-deck cleanup is permitted before QA delivery.

### Final source checkpoint before user verification choice

- All N/P/U/C/H/A source implementation is drafted; A final handoff complete. Completion here means source work only, with no claim of passing checks or runtime correctness.
- A reports exact `github.sha` reusable validation, release-ID-scoped updater downloads, configured-key Minisign verification, installable `.deb`/`.app`/NSIS visible-window smoke, and observer/signature regression coverage.
- None of the checks, builds, native launches, runtime proofs, or CI jobs have run in this pipeline. No commits, push, or PR exists.
- Step 4 remains blocked solely on the explicit verification-mode choice. Root is yielding with that question pending; its answer is the next required action.
- Worktree retained intact at `/Users/jarredparr/.config/jp-skills/worktrees/aproprose/codex/audit-remediation`. Reviews (0/5), simplification, exact-commit CI gate, merge, real-data QA, screenshot deck, and delivery all remain outstanding.

### Local verification authorized

- User answer: "hammer local that's fine". Recorded `verify-mode: local`; the earlier pending-choice restriction is resolved.
- Step 4 active: root owns frontend/browser/release-script verification; native worker owns formatting, strict Clippy, native tests including the ignored network lane, and host-platform bundle when possible.
- Do not narrow failing suites, bypass hooks, or claim unsupported-platform proof. Record exact commands/results and explicit not-run reasons.
- No PR yet. Pushed-diff review minimum 3/cap 5, whole-diff simplification, final exact-commit full gate plus CI, gated merge, and real-data QA/deck remain required.

### Remaining obligations

- Complete and cross-review C/H exact plans after P stability; confirm each wave remains within assigned write sets.
- Finish A browser integration, native isolated QA identity, tagged-SHA reusable validation, artifact smoke, and updater validation.
- Execute the selected verification mode only after explicit answer; report unsupported platform lanes honestly. Regression execution and all affected builds remain unverified.
- Commit bug fixes as standalone logical commits; open one ready PR and attach it to the chat.
- Run 3-5 adversarial pushed-diff review rounds with verdict blocks; then run whole-diff simplification once and re-verify as required.
- Require exact-final-commit mode gate and CI green for gated merge.
- Complete real-data isolated native/browser QA, HTML screenshot deck under `docs/slides`, copy-out delivery, then eligible cleanup.

## Gate and review records

- Initial full gate: active in authorized local mode; frontend/browser and native debug checks passed, isolated native bundle/smoke pending.
- PR: pending.
- Review rounds: 0/5; minimum 3, no sixth round without explicit user override.
- Simplification: pending; once over the whole PR diff after clean review exit.
- Final exact-commit gate and CI: pending.

### First local gate results

| Command | Result | Evidence / correction |
| --- | --- | --- |
| `just typecheck` | PASS | Root and browser configurations; initial unused import and missing browser declaration include corrected |
| `just test-frontend` | PASS | 127 files, 1503 tests; initial 18 failures corrected without narrowing assertions |
| `just build` | PASS | Frontend production bundle |
| `just test-browser` | PASS | 5 real-browser tests; initial server IPv4/IPv6 mismatch and injected Windows-UA/macOS-modifier fixture mismatch corrected |
| `cargo fmt` in `src-tauri` | PASS | Formatting preparation, exit 0 |
| `just lint` | PASS | Native format check and `cargo clippy --all-targets -- -D warnings`; initial test-only `io_other_error` corrected to equivalent `io::Error::other` |
| `just test-native` | PASS | 79 passed, 0 failed, 2 ignored |
| `cargo test -- --ignored` in `src-tauri` | PASS | 2 passed, 0 failed: real DNS NXDOMAIN and real latexmk reserved metadata/chapter-title compilation |
| Isolated native QA bundle | RUNNING | Separate QA identity required because user's production app is running; bundle/smoke not yet claimed |
| Linux Hyprland single-instance smoke / Arch package | NOT RUN locally | Host is macOS; Linux-specific dependencies unavailable here |
| Windows native package/launch | NOT RUN locally | Host is macOS; planned CI platform matrix supplies platform lane |
| Generator idempotency | NOT APPLICABLE | Version/changelog scripts mutate release state; no idempotent generator documented and no release bump requested |

- First frontend run: 127 files, 1503 tests, 18 failures / 1485 passes. Corrections covered test `act` promise handling, spy cleanup, observable queue settlement, transient retry fixture, and Slider Thumb disabled semantics. A distinct Color theme group name preserves accessible targeting. Final complete suite passed.
- Browser proof uses native Chromium user agent with explicit native-OS bridge fixture and actual focused prose entry before Undo; test conditions now match platform shortcut semantics.
- Native compilation used two build jobs and reused target artifacts to limit resource contention. Debug checks are complete; production packaging remains separate evidence.
- Production app at `/Applications/aproprose.app` (reported PID 78365) remains untouched. Local artifact/QA proof uses the isolated QA identifier rather than claiming a production-identity launch. Rust macOS configuration derives from HOME, so CFFIXED_USER_HOME/XDG/APPDATA alone do not isolate production state; HOME is not repurposed.
- No commits, push, or PR yet; first gate waits for bundle and smoke completion. The gate is not a substitute for later pushed-diff reviews or final exact-commit verification.

### Target refresh and required reintegration

- Fresh fetch advanced `origin/main` from `d49a55b` to `0892020`, adding 36 commits and version 0.17.8. The first local gate above covers the older intake baseline only and is not evidence for the refreshed integration.
- Incoming behavior must be preserved: required version/changelog gate, notifications, animated/reopenable dock, chapter reordering, and Chromium/WebKit scroll coverage.
- Root waits for current native release build completion, then stashes only owned pipeline drafts, fast-forwards to the refreshed target, restores drafts, and resolves file-disjoint integration ownership: P worker owns store conflicts, C/H integration worker owns its seams, root owns UI/CI integration.
- Repository-mandatory CI now requires synchronized version/changelog advancement to 0.17.9. This supersedes the earlier no-version-bump assumption; no release tag or publication is authorized or planned.
- Expanded local gate must include new WebKit and existing scroll tests plus the new release/version guard. Rerun the full integration gate on the refreshed source before the first PR/push.
- No pushed-diff review round has run; count remains 0/5. Native isolated QA production build is currently release-compiling under `com.jsp.aproprose.auditqa`, with frontend beforeBuild passed; production-identity launch remains separate CI proof.

## QA and delivery

- Integration checkpoint: owned drafts restored after fast-forward to `7e80500`; all conflicts resolved, no unmerged files. Safety stash retained as `stash@{0}`.
- Preserved incoming reorder, metadata notifications, AI reporting, collection-save reporting, quiet notification actions, animated dock, both browser engines, port 1432, and upstream Playwright 1.64.0. Version/changelog synchronized to 0.17.10; `check-release HEAD` passed. Earlier planned 0.17.9 is superseded by the newer target version.
- Pre-integration QA bundle and `just smoke-artifact /Users/jarredparr/.codex/worktrees/385b/aproprose/src-tauri/target/release/bundle` passed: isolated `com.jsp.aproprose.auditqa` 0.17.1 packaged app remained visible through a 3-second settle. This proves the older source only; user's production app remained untouched. No local Linux/Windows native execution.
- Refreshed full integration gate active, starting with `just typecheck`; results pending. No pushed-diff review round yet.

### Refreshed integration gate checkpoint

| Command | Result | Evidence |
| --- | --- | --- |
| `just typecheck` | PASS | Consolidated upstream root tsconfig includes all tests and workshop globals; redundant browser tsconfig/second tsc removed |
| `just build` | PASS | Integrated frontend production build |
| `just test-browser` | PASS | 34 tests across Chromium and WebKit, including incoming scroll coverage |
| `just test-frontend` | PASS | 130 files, 1577 tests; corrected a newly misplaced reporter assertion and retained the active-run assertion in its owning case |
| `set-version` for 0.17.10 | COMPLETE | Required synchronized version/changelog change; no tag or publication |
| `check-release HEAD` | PASS | Repository mandatory release/version gate |
| `just lint` | PASS | Integrated 0.17.10 source; format check and strict all-target Clippy |
| `just test-native` | PASS | Integrated source: 79 passed, 0 failed, 2 ignored |
| `cargo test -- --ignored` in `src-tauri` | PASS | 2 passed, 0 failed, including actual LaTeX compilation |
| Isolated native QA 0.17.10 release bundle | PASS | Native release compilation 38.93 seconds; identifier/version verified |
| `just smoke-artifact <actual-target>/release/bundle` | PASS | Packaged QA app visibly settled for 3 seconds; production app untouched |

- Step 5 readiness: once native gate/bundle/smoke is green, create logical standalone bug-fix commits with normal hooks, verify committed tree, push one branch, open one ready PR, confirm base/head/URL, and attach artifact.
- Review plan: five fresh angles per pushed-diff round in capacity-limited waves (four total agent slots), then required club deliberation and verdict. Minimum 3, cap 5; no round has run yet.
- No PR exists at this checkpoint. Final exact-commit full gate, CI, simplification, merge, real-data QA, and deck delivery remain required.

### Step 5 ready

- Full refreshed local gate green. Root now owns logical standalone commits, normal hooks, exact committed-tree verification, branch push, one ready PR, base/head/URL confirmation, and attachment.
- Supervisor has read the full pr-review-toolkit skill and will coordinate only; it will not implement, review, or QA-prove.
- No review agents dispatch until branch is pushed. Every review prompt must carry pushed SHA/range and PR URL, task/consensus sources, dedicated worktree path, read-only scope, and supervisor question routing.
- Each of five fresh independent angles (`spec`, `breaker`, `failure`, `proof`, `shape`) must return only scoped findings with file/line, claim, concrete proof, user impact, and fix. No proof means no finding. Capacity limit requires waves while retaining independent fresh sessions.
- Fight merges/deduplicates findings, then fresh Level checks proofs and Splinter challenges consensus; Killjoy limits debate to two rounds. Owners get exactly one defense/concession round. Unsupported claims are dropped with reasons; unresolved disagreement is dissent.
- Each round must end in the exact REVIEW VERDICT block (`APPROVE`, `FIX-THEN-SHIP`, or `BLOCK`), preserving surviving must-fix locations/proof/fix and dissent. A missing block is not a round. BLOCK stops; must-fix is fixed, fully verified as required, pushed, and included in the next round's new pushed scope.
- Round counter remains 0/5, minimum 3. Green rounds before round 3 do not end the loop. No sixth round or confirming simplification review is authorized.

- QA target: post-merge commit by pipeline default, or preview if user explicitly requests PR left open.
- Proof: real changed app/components plus real filesystem/Git/LaTeX fixtures, no fabricated live-service proof.
- Deck convention: self-contained HTML with screenshots in `docs/slides/<topic>-YYYY-MM-DD.html`; one screenshot per captioned slide, assets embedded or under `docs/slides`.
- Deck copy-out: starting checkout `qa-decks/audit-remediation/` before any worktree removal.
- QA, deck, and cleanup: pending.
