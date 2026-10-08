# Audit remediation task

One PR addressing all 25 findings from the 2026-10-07 audit. Target main.
Use existing shadcn primitives, semantic tokens, strict types, functional modules, and just recipes.
Write failing regression tests before each bug fix. Commit bug fixes separately.
No unrelated features, secret access, or external backup pushes during QA.
Verification mode is local, explicitly authorized by the user: "hammer local that's fine".

## Acceptance mapping

| ID | Finding | Required outcome and evidence |
| --- | --- | --- |
| 01 | Save replaces newer live edits | Owned project/chapter/revision persistence; delayed writes preserve new edits and other documents; dirty/history reflect durable revision. |
| 02 | Add chapter bypasses unsaved guard | Every document-changing entry point shares transition guard; add preserves or explicitly resolves dirty drafts. |
| 03 | Late chapter/project loads overwrite current state | Request ownership prevents obsolete completion installing or clearing current drafts; reordered-load tests. |
| 04 | Remote pull leaves stale editor | Native sync reports changed project files; coordinator reconciles clean snapshots and protects edits/load races before another save. |
| 05 | Backup stages ancestor repository | Explicit repository-root ownership for init/status/sync; nested-project tests never stage parent files. |
| 06 | Failed truncating writes destroy saved files | Shared durable writer preserves old content on pre-replacement failure; post-replacement synchronization failure reports durability uncertainty. Skeleton operation failures identify committed paths and preserve originals at failed paths. |
| 07 | Hidden editor steals outline undo | Active surface owns shortcuts; actual keybinding/focused outline integration coverage. |
| 08 | Old sync mutates new project | Root/lifecycle ownership covers init/sync/prefs; deferred A-to-B tests. |
| 09 | Compile proceeds after failed save | Explicit save outcome stops compile on failure; tests for rejected write. |
| 10 | Git quotes filenames | Lossless NUL-delimited path handling for status/conflicts/renames; real fixtures with spaces, quotes, tabs. |
| 11 | Metadata breaks LaTeX | Explicit plain-text serialization and parsing contract for all metadata/chapter titles; reserved-character round trips and compilation evidence. |
| 12 | Required read errors become empty project | Required files produce actionable errors; corrupt/unreadable files retain originals. |
| 13 | Storage swallows errors | Explicit preview/native adapters; native failures observable and tested through real adapter. |
| 14 | Pane layout collapses editor/find crosses pane | Supported 960px window and panel combinations retain usable authoring geometry; real browser assertions. |
| 15 | AI failure spins forever/overlaps action | Explicit load/error/recovery presentations using shared primitives; narrow-pane error-state coverage. |
| 16 | Settings field lacks label semantics | Existing Field/FieldLabel/FieldDescription; every control accessible by name. |
| 17 | Repeated bespoke cards/type | Repeated settings/backup/changelog/PDF surfaces use shared Card and Typography conventions. |
| 18 | Backup schedule UI duplicated | Shared stateless fields; caller-specific availability retained; labels/focus consistent. |
| 19 | Find toggle duplicated | Reuse existing FindOptionToggle in editor and PDF. |
| 20 | Editor/controller mix responsibilities | Extract coherent interactions/rendering and controller lifecycle/submission/tool environment seams without losing guards; behavior tests. |
| 21 | Agent persistence implicit protocol | Explicit typed coordinator state and named transition operations; preserve existing ordering and recovery tests. |
| 22 | Native process executor duplicated | One structured process runner with explicit timeout; domain adapters preserve diagnostics. |
| 23 | Compiler backend untested | Pure diagnostic/path tests and deterministic controlled process tests for discovery, passes, errors, timeout, missing/empty PDF. |
| 24 | Tests mock failing boundaries | Small real browser layout/focus/theme suite and native adapter contracts; meaningful tests against changed code. |
| 25 | Release skips commit gates/runtime proof | Reusable validation required before release; platform native tests, supported artifact launch smoke, updater metadata/version/URL/signature validation before publication. |

## Pipeline obligations

- Fresh party personas: Architect, QA/UX, Wildcard, Level, Killjoy, Splinter, topic-research. At most two debate rounds; cross-review exact file sets before implementation.
- File-disjoint implementation waves; no worker writes beyond assigned files.
- At least three, at most five pushed-diff adversarial review rounds; full simplify pass after clean review.
- Exact-commit mode gate and CI green before gated merge.
- Real-data native/browser QA. Self-contained screenshot deck at docs/slides/audit-remediation-YYYY-MM-DD.html; deliver copy to starting checkout before cleanup.
