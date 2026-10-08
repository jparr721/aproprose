# Background AI authoring audit

- Date: 2026-10-07.
- Finding: aproprose refreshes story and character knowledge after successful chapter saves and chapter topology changes. It does not infer from unsaved typing, fill chapter outline fields/cards automatically, or request manuscript updates when the author edits the outline.
- Scope: source-backed analysis of the existing system and a proposed contract for live, bidirectional authoring. The proposed synchronization below is not implemented by the preference-assistant change.
- Evidence: source inspection, including existing test definitions. This document does not assert that those tests or native AI flows were executed during the audit.

## 1. Data ownership and terminology

| Surface | Stored representation | Current ownership and behavior |
| --- | --- | --- |
| Manuscript | Chapter `.tex` files and the active editor's `blocks` | The editor holds unsaved changes separately from disk. Background refresh reads the files on disk. |
| Global story outline | `meta.outline.premise` and `meta.outline.overview` | Author-editable logline and living overview. Background refresh can replace them after validating its captured inputs. |
| Chapter outline | `meta.chapters[chapterId]` | Authored act, structural beat, premise, goal, conflict, turn, cast assignments, and ordered plot-element cards. Manual actions and accepted planner proposals change it. Background refresh does not. |
| Derived chapter knowledge | `meta.knowledge.chapters[chapterId]` | Semantic source fingerprint, summary, story signals, and evidence-linked character observations. This is analysis data, separate from the authored chapter outline. |
| Character profiles | `meta.characters` | Six profile fields. Background evidence can add or correct details; a dedicated Describe session can update the selected character directly. |
| New-character candidates | `meta.knowledge.characterCandidates` | Suggestions with evidence. The author explicitly accepts or dismisses them. |
| Standing AI guidance | `settings.styleGuide` and `settings.editingRules` | Global writing voice and editing instructions. The interactive agent receives both. The background extraction calls use their own factual-analysis contracts. |
| Task notes | No corresponding domain in `ProjectMeta` or `ProjectKnowledge` | Existing story summaries, signals, character observations, and authored outline fields are the relevant equivalents. There is no general task-note updater to connect. |

- Sources: [story/character knowledge types](../../src/lib/types.ts#L119-L201), [chapter outline types](../../src/lib/types.ts#L225-L278), [project metadata](../../src/lib/types.ts#L306-L319), [settings](../../src/lib/types.ts#L339-L363), [interactive preference injection](../../src/lib/ai/agent-prompts.ts#L116-L148), [background contracts](../../src/lib/story-knowledge/operations.ts#L32-L67).
- Persistence distinction: project metadata now lives in `<project>/.aproprose/meta.json`; global settings use the Rust-backed app-config storage adapter. The older `ProjectMeta` type comment describes app-config metadata, but the current load path and Rust commands establish the actual project-local location. Sources: [current metadata load](../../src/stores/project-store.ts#L653-L678), [Rust metadata commands](../../src-tauri/src/lib.rs#L68-L78), [settings persistence](../../src/stores/settings-store.ts#L83-L107), [storage adapter](../../src/lib/storage.ts#L8-L33).

## 2. Trigger and field matrix

| Author/application event | Background knowledge request | Resulting behavior | Source |
| --- | --- | --- | --- |
| Type or revise prose without saving | None | Editor changes remain in memory; current background refresh sees saved prose only | [save integration](../../src/stores/project-store.ts#L1562-L1628), [disk reads](../../src/lib/story-knowledge/refresh.ts#L250-L263) |
| Successfully save a dirty chapter | `enqueueSavedChapter(root, chapterId, fingerprint)` | Refresh starts asynchronously after the disk write and reparse | [save integration](../../src/stores/project-store.ts#L1562-L1628) |
| Failed chapter save | None from that save | Save error is recorded; failed content is not submitted as saved knowledge | [save failure](../../src/stores/project-store.ts#L1624-L1632) |
| Add, rename, reorder, or delete a chapter | `enqueueChapterTopology(root)` | Refresh reconciles ordered story knowledge and removed chapters | [topology actions](../../src/stores/project-store.ts#L874-L956) |
| Open an existing project | No refresh enqueue in `finishLoad` | Persisted metadata is loaded; opening alone does not start a knowledge rebuild | [load path](../../src/stores/project-store.ts#L655-L709) |
| Change the global logline or overview | Metadata persistence only | No reverse manuscript request; an in-flight background result is checked against the new values | [global setters](../../src/stores/project-store.ts#L2010-L2022), [stale story guard](../../src/stores/project-store.ts#L1710-L1718) |
| Change chapter spine, act, structural beat, cards, cast, or lore assignments | Metadata persistence only | No automatic agent turn or manuscript rewrite | [outline setters](../../src/stores/project-store.ts#L2024-L2133) |
| Use Plan with AI and submit a request | Interactive outline session | Agent can stage chapter card changes and an optional overview replacement for review | [planner UI](../../src/components/app/outline/chapter-subview.tsx#L115-L128), [proposal creation](../../src/lib/ai/agent-controller.ts#L1450-L1475) |
| Accept a proposal | Shared proposal-decision lifecycle | Selected, still-valid changes apply; rejection leaves source unchanged | [decisions](../../src/lib/ai/proposal-decisions.ts#L244-L333) |
| Retry failed refresh | Retry the remembered project | Remaining or unapplied work is retried against a new capture | [retry](../../src/stores/story-refresh-store.ts#L320-L323) |
| Close/switch/create project | Cancel and reset refresh runtime | Abort signal and generation invalidate old refresh work | [project lifecycle](../../src/stores/project-store.ts#L758-L792), [create](../../src/stores/project-store.ts#L855-L867), [runtime cancel](../../src/stores/story-refresh-store.ts#L266-L279) |

- The project subscription in the interactive controller updates already-attached draft source previews when blocks or metadata change. It does not submit a new inference turn or provide live outline synchronization: [subscription](../../src/lib/ai/agent-controller.ts#L2522-L2530), [source resolution](../../src/lib/ai/agent-controller.ts#L2488-L2507).

| Field/output | Automatically updated after a refresh? | Approval boundary |
| --- | --- | --- |
| Chapter summary and story signals in `knowledge` | Yes | Guarded background metadata commit |
| Global logline and overview | Yes, when story knowledge/topology changes | Guarded background commit; no proposal tray |
| Existing character profile details | Yes, additions/exact corrections with valid observations | Guarded background commit; no proposal tray |
| New character in the cast | No | Explicit candidate acceptance |
| Chapter premise/goal/conflict/turn | No | Manual editing only in this background flow |
| Chapter act/structural beat/cast/cards | No | Manual editing or relevant accepted outline-card proposals |
| Manuscript text | No | Author acceptance of a manuscript proposal |

- Sources: [refresh output composition](../../src/lib/story-knowledge/refresh.ts#L371-L519), [commit fields](../../src/stores/project-store.ts#L1854-L1864), [candidate acceptance](../../src/stores/project-store.ts#L1895-L1932), [manual chapter fields](../../src/components/app/outline/chapter-subview.tsx#L181-L218), [proposal application](../../src/lib/ai/proposal-decisions.ts#L148-L181).

## 3. Existing forward flow

```text
Author saves chapter / changes chapter topology
  -> enqueue newest saved fingerprint / topology revision
  -> capture project, metadata, selected provider and model
  -> read and parse every chapter from disk
  -> select chapters with changed/missing semantic fingerprints
  -> map eligible prose chunks to story signals and observations
  -> reduce each selected chapter's knowledge
  -> reduce ordered chapter knowledge to global logline/overview
  -> reduce affected known-character profiles, at most 3 concurrently
  -> reduce eligible unknown-character groups to review candidates
  -> validate source/metadata fingerprints against current state
  -> persist permitted metadata; queue follow-up reconciliation if stale
```

### Capture and queue

- Enqueueing returns without awaiting inference. An active run holds an `AbortController`, generation number, and project root. New saves replace the pending fingerprint for that chapter; topology changes increment a revision. The active job finishes before pending work is processed by a new capture. Sources: [run capture](../../src/stores/story-refresh-store.ts#L143-L173), [pending work](../../src/stores/story-refresh-store.ts#L205-L252), [enqueue methods](../../src/stores/story-refresh-store.ts#L290-L318).
- Provider/model are captured from settings and supplied explicitly to `getModel`. A missing model fails before building the refresh. Existing provider factories read the stored key through a Rust command and route SDK HTTP through Tauri's HTTP plugin. Sources: [settings capture](../../src/stores/story-refresh-store.ts#L330-L342), [missing model](../../src/stores/story-refresh-store.ts#L153-L173), [provider factories](../../src/lib/ai/model.ts#L19-L69), [Rust stored-key lookup](../../src-tauri/src/lib.rs#L229-L285).
- There is no implicit model selection or environment-key fallback in this path. Stored provider keys resolve from app-config files: [Rust key lookup](../../src-tauri/src/lib.rs#L229-L285).

### Semantic selection and evidence

- Every run reads every chapter file and computes semantic fingerprints; only chapters whose derived record is missing or has a different source fingerprint are selected for mapping. The first triggered run therefore indexes all missing chapters, even if one save initiated it. Source: [selection](../../src/lib/story-knowledge/refresh.ts#L250-L284).
- Eligible content consists of narration, dialogue, and chapter headings other than break headings. Scratch, AI, and lore blocks are excluded from background story analysis. Source: [eligible block predicate](../../src/lib/story-knowledge/chunking.ts#L24-L31).
- Fingerprints describe type, text, speaker, dialogue tail, title, and level rather than transient block IDs. Evidence identity combines chapter ID, content fingerprint, and duplicate occurrence so a reparse can retain durable evidence identity. Sources: [block fingerprint](../../src/lib/ai/agent-context.ts#L40-L50), [chapter fingerprint](../../src/lib/story-knowledge/chunking.ts#L65-L69), [durable evidence identity](../../src/lib/story-knowledge/chunking.ts#L57-L62).
- Chunks target 12,000 characters and preserve block boundaries. A single larger block is not split, so this is not a hard request-size ceiling. Sources: [chunk budget](../../src/lib/story-knowledge/chunking.ts#L8-L9), [chunk construction](../../src/lib/story-knowledge/chunking.ts#L94-L115).
- Mapping receives global story intent, chapter outline, the character roster, and relevant complete profiles. Profile relevance uses chapter/card assignments, speakers, and exact name mentions. Source: [relevance](../../src/lib/story-knowledge/refresh.ts#L152-L190), [map input](../../src/lib/story-knowledge/refresh.ts#L304-L337).
- Structured output uses Zod schemas through `generateText` and `Output.object`. Known-character observations require an offered character ID and cited offered source IDs. Unknown-character observations also require valid evidence. Invalid observations are filtered from retained output. Sources: [schemas](../../src/lib/story-knowledge/operations.ts#L89-L157), [map validation](../../src/lib/story-knowledge/operations.ts#L265-L345).
- Chapter reduction can retain only observation IDs offered by its map results. Story signals themselves are model-generated strings; evidence validation for character observations does not prove every summary or signal is semantically correct. Source: [chapter reduction](../../src/lib/story-knowledge/operations.ts#L349-L403).

### Reduction and merge

- The global story reducer receives ordered chapter knowledge plus current author logline/overview. Its prompt says existing author fields are authoritative and changes require material evidence. The overview has a 2,000-character limit; a nonempty current logline/overview cannot be replaced by blank output. Sources: [story contract](../../src/lib/story-knowledge/operations.ts#L48-L54), [story validation](../../src/lib/story-knowledge/operations.ts#L406-L450).
- That prompt is guidance rather than permanent author ownership. A valid later refresh may replace a manually edited global field when its current value still matches the run's captured input. The hard guard protects concurrent edits; it does not lock an authored field against future synthesis. Source: [story freshness and commit](../../src/stores/project-store.ts#L1710-L1718), [outline replacement](../../src/stores/project-store.ts#L1854-L1864).
- Known-character reducers receive deduplicated observations and applied observation IDs. The merger appends additions and replaces exact matching text for corrections, while recording processed observation IDs. Sources: [affected characters](../../src/lib/story-knowledge/refresh.ts#L207-L230), [character reduction input](../../src/lib/story-knowledge/refresh.ts#L391-L421), [patch merger](../../src/lib/story-knowledge/merge.ts#L151-L197).
- Unknown people are grouped by normalized name. Eligibility requires at least two distinct evidence entries or at least two supported profile fields. Accepted/dismissed evidence fingerprints suppress regeneration from that same evidence. Sources: [candidate eligibility](../../src/lib/story-knowledge/merge.ts#L210-L260), [candidate reduction](../../src/lib/story-knowledge/refresh.ts#L471-L507), [candidate decisions](../../src/stores/project-store.ts#L1895-L1962).
- A changed evidence fingerprint can form a later candidate; suppression is tied to evidence, not a permanent ban on a character name. Sources: [fingerprint](../../src/lib/story-knowledge/merge.ts#L200-L207), [suppression](../../src/lib/story-knowledge/merge.ts#L235-L248).

## 4. Concurrency, persistence, and approval safeguards

| Safeguard | Actual boundary | Source |
| --- | --- | --- |
| Project ownership | Commit rejects results for another open project; lifecycle cancellation invalidates work | [project check](../../src/stores/project-store.ts#L1691-L1696), [cancel](../../src/stores/story-refresh-store.ts#L266-L279) |
| Run ownership | Generation and abort are checked after build and after commit before runtime state changes | [ownership checks](../../src/stores/story-refresh-store.ts#L187-L202) |
| Saved-content freshness | Analyzed fingerprints must agree with the newest saved fingerprints known to the runtime | [content guard](../../src/stores/project-store.ts#L1699-L1709) |
| Story intent freshness | Concurrent logline/overview edits prevent obsolete story-dependent output from landing | [story guard](../../src/stores/project-store.ts#L1710-L1712), [knowledge merge](../../src/stores/project-store.ts#L1729-L1747) |
| Topology freshness | Ordered chapter IDs/titles must match; removed chapters are pruned | [topology fingerprint](../../src/lib/ai/agent-context.ts#L91-L94), [merge](../../src/stores/project-store.ts#L1713-L1747) |
| Profile freshness | A concurrent profile edit skips that character patch and requests follow-up | [profile guard](../../src/stores/project-store.ts#L1783-L1797) |
| Evidence freshness | Commit retains character operations only when every cited observation belongs to current retained knowledge | [evidence guard](../../src/stores/project-store.ts#L1799-L1837) |
| Candidate decision freshness | Accepted/dismissed candidate decisions racing a refresh are preserved through candidate-input checks and reconciliation | [candidate guard](../../src/stores/project-store.ts#L1716-L1718), [candidate merge](../../src/stores/project-store.ts#L1749-L1776) |
| Serialized metadata writes | Per-project write promises preserve snapshot ordering; one failed write does not prevent a later queued write | [write queue](../../src/stores/project-store.ts#L182-L240) |
| Durable rollback | Failed optimistic writes restore the last durable metadata only when the failed snapshot still owns current state | [optimistic persistence](../../src/stores/project-store.ts#L625-L643) |
| Reviewable source changes | Interactive tools stage complete manuscript/outline proposals; acceptance validates current targets and applies selected changes | [staging](../../src/lib/ai/agent-tools.ts#L263-L315), [stale validation](../../src/lib/ai/proposal-decisions.ts#L184-L241), [acceptance](../../src/lib/ai/proposal-decisions.ts#L244-L299) |
| Outline Undo | Accepted outline edits return one token; Undo refuses to overwrite a later metadata mutation | [outline apply/Undo](../../src/stores/project-store.ts#L2218-L2272) |

- A stale story/topology/content result conservatively withholds new chapter knowledge, story fields, and related profile updates, then schedules follow-up. Candidate-only staleness can reconcile separately. Sources: [commit gates](../../src/stores/project-store.ts#L1729-L1782), [runtime follow-up](../../src/stores/story-refresh-store.ts#L205-L252).
- Current approval is field-specific: background knowledge, global synthesis, and supported existing-profile additions can write automatically; new cast members and interactive manuscript/outline proposals require author decisions. The dedicated Describe session is another direct profile-write path, limited to its frozen character. Sources: [background commit](../../src/stores/project-store.ts#L1854-L1864), [candidate UI](../../src/components/app/outline/character-candidates-dialog.tsx#L136-L159), [proposal instructions](../../src/lib/ai/agent-prompts.ts#L56-L66), [Describe boundary](../../src/lib/ai/agent-prompts.ts#L80-L86), [Describe tool](../../src/lib/ai/agent-tools.ts#L318-L343).

## 5. Costs, failure modes, and limits

| Case | Current behavior / implication | Source |
| --- | --- | --- |
| One changed chapter with `k` nonempty chunks | `k` map calls plus one chapter reduction; changed story/topology adds one global reduction; affected profiles add one reduction each; eligible unknown groups add one candidate-reduction call | [map/reduce loop](../../src/lib/story-knowledge/refresh.ts#L304-L389), [profiles](../../src/lib/story-knowledge/refresh.ts#L391-L469), [candidates](../../src/lib/story-knowledge/refresh.ts#L471-L488) |
| Large manuscript | Every run reads all chapter files. Map/chapter stages run sequentially; whole-story reduction receives all ordered chapter knowledge | [reads](../../src/lib/story-knowledge/refresh.ts#L250-L263), [loops](../../src/lib/story-knowledge/refresh.ts#L304-L369), [global input](../../src/lib/story-knowledge/refresh.ts#L375-L385) |
| Many affected characters | At most three character reductions run concurrently; results preserve character order | [limit](../../src/lib/story-knowledge/refresh.ts#L101), [workers](../../src/lib/story-knowledge/refresh.ts#L423-L469) |
| Repeated saves during inference | Intermediate pending fingerprints coalesce, but the active request is not restarted for each keystroke/save | [enqueue](../../src/stores/story-refresh-store.ts#L290-L307), [follow-up](../../src/stores/story-refresh-store.ts#L205-L252) |
| Transient AI failure | The wrapper classifies errors, warns and retries once for transient failures, and immediately rethrows aborts or non-retryable failures. Final failures show actionable toasts. This does not establish the SDK's total underlying HTTP-attempt count | [retry wrapper](../../src/lib/ai/errors.ts#L38-L59) |
| Missing model or provider failure | Runtime shows a provider-aware error toast with a Settings action where applicable, stores a failed status and error, and retains pending work for retry | [model check](../../src/stores/story-refresh-store.ts#L160-L163), [failure handling](../../src/stores/story-refresh-store.ts#L254-L263), [retry](../../src/stores/story-refresh-store.ts#L320-L323) |
| Map/chapter/story/candidate stage fails before a result returns | Refresh throws before commit; captured metadata remains a separate snapshot | [capture clone](../../src/stores/story-refresh-store.ts#L165-L173), [build then commit](../../src/stores/story-refresh-store.ts#L174-L197) |
| One character reduction fails | Other valid character updates can commit. Runtime reports failure; unapplied observations remain retryable | [isolated jobs](../../src/lib/story-knowledge/refresh.ts#L423-L469), [partial result handling](../../src/stores/story-refresh-store.ts#L194-L229) |
| Persistence fails | Refresh reports failure and uses guarded durable rollback; serialized writes preserve later snapshots | [persistence](../../src/stores/project-store.ts#L209-L240), [rollback](../../src/stores/project-store.ts#L625-L643) |
| Unsaved prose changes during background work | Saved-fingerprint checks do not observe those changes. The result describes saved prose, not the latest editor buffer | [disk reads](../../src/lib/story-knowledge/refresh.ts#L250-L263), [saved-only guard](../../src/stores/project-store.ts#L1699-L1709) |
| Persisted knowledge on reopen | Status considers a chapter refreshed when knowledge exists and there is no newer current-session saved fingerprint. "Up to date" is not an independent fresh disk/editor comparison | [coverage calculation](../../src/components/app/outline/story-refresh-status.tsx#L9-L26) |
| Manual chapter-outline change | It is persisted, but does not invalidate/recompute chapter mapping by itself; selection is based on prose fingerprints | [setters](../../src/stores/project-store.ts#L2024-L2133), [selection](../../src/lib/story-knowledge/refresh.ts#L278-L284) |

- Progress counts completed selected chapters. Profile reductions and final synthesis can continue after that chapter counter reaches its total; an active status still indicates the refresh has not finished. Sources: [chapter progress](../../src/lib/story-knowledge/refresh.ts#L362-L368), [later stages](../../src/lib/story-knowledge/refresh.ts#L371-L509), [status UI](../../src/components/app/outline/story-refresh-status.tsx#L42-L67).
- The background mapper is a fact extractor, not the interactive writing agent. Standing voice/editing guidance reaches interactive runs, while background calls use fixed extraction/reduction contracts. This separation should be an explicit design decision if synchronization is extended. Sources: [interactive instructions](../../src/lib/ai/agent-prompts.ts#L116-L148), [background calls](../../src/lib/story-knowledge/operations.ts#L265-L278), [story reducer](../../src/lib/story-knowledge/operations.ts#L406-L427).

### Unproven source-visible save race

- Observation: `saveChapter` captures `blocks` and the target chapter before awaiting a disk write. On completion it reparses that captured source, replaces live editor blocks, clears dirty state, and resets undo/redo. It does not visibly compare an editor revision before replacement. Source: [save implementation](../../src/stores/project-store.ts#L1562-L1609).
- Risk hypothesis: an edit or chapter/project transition during the write could make that completion stale. This audit has not reproduced that interleaving and does not claim a confirmed defect.
- Required first step before any fix: a focused deferred-write regression test that saves A, changes the editor to B before write completion, and proves whether B/dirty state/undo are preserved. Repeat for chapter/project transitions if the first test exposes the broader case.
- Scope: no save behavior is changed here. Live inference should capture memory directly instead of adding automatic calls to `saveChapter`; inference scheduling and manuscript persistence are separate concerns.

## 6. Proposed live and bidirectional contract

- Status: design only. Implementation scope and the phrase "the agent should approve first" require a product decision before building synchronization.
- Recommended approval contract: the agent evaluates an outline change and stages the resulting manuscript update; the author reviews and accepts it before manuscript text changes. Current proposal tools already implement author-controlled application. If agent self-approval was intended instead, that is a different permission policy and should be stated explicitly. Source for the current boundary: [base agent instructions](../../src/lib/ai/agent-prompts.ts#L56-L66).

```text
Forward, proposed:
  Author types -> idle semantic snapshot -> derived knowledge/outline update
  -> compare captured revision and ownership -> commit eligible derived fields

Reverse, proposed:
  Author changes outline -> idle outline revision -> agent assesses prose impact
  -> stage reviewable manuscript proposal -> author accepts -> apply guarded edit
```

| Proposed slice | Smallest architectural change | Required boundary |
| --- | --- | --- |
| Live prose capture | Extend refresh capture with an explicit immutable active-chapter snapshot; debounce semantic editor changes; overlay that snapshot over the existing disk-loading path | Do not save manuscript files, clear dirty state, replace editor blocks, or alter undo history |
| Live freshness | Track newest observed semantic revisions independently from newest saved fingerprints; validate the active buffer as well as captured topology/story context before commit | A late result cannot overwrite knowledge for a newer editor revision or another project |
| Derived chapter outline | Add structured chapter-spine/card derivation and persisted ownership/provenance using existing metadata/schema/migration conventions | Distinguish authored intent from inferred description; preserve manually authored fields and stable card IDs |
| Reverse outline trigger | Capture the author-origin outline delta and relevant chapter; reuse the project agent and manuscript-proposal lifecycle | Only author-origin edits trigger reconciliation; AI-derived metadata changes do not recursively trigger new requests |
| Approval/revision validation | Associate the proposal with the source outline revision as well as existing manuscript preconditions; reuse review and acceptance UI | Later outline edits make an earlier reconciliation proposal stale; acceptance never applies an obsolete intent |

- Existing extension points: [capture/dependencies](../../src/lib/story-knowledge/refresh.ts#L45-L99), [runtime capture](../../src/stores/story-refresh-store.ts#L330-L349), [metadata merge](../../src/stores/project-store.ts#L1691-L1864), [metadata schemas](../../src/lib/migration/schema.ts#L25-L118), [agent request](../../src/lib/ai/agent-controller.ts#L2094-L2150), [manuscript proposal builder](../../src/lib/ai/agent-controller.ts#L1421-L1445), [proposal stale checks](../../src/lib/ai/proposal-decisions.ts#L184-L241).
- Ownership rule: store the previous AI-derived value/revision. A blank or unchanged AI-owned field can update; a divergent manual value remains authored. Comparing only the whole captured outline prevents an in-flight overwrite but cannot identify durable author ownership across later runs.
- Card rule: derived cards need stable identity and evidence matching. Replacing the whole card array would discard authored cards, cast/lore assignments, and pending proposal anchors. Those fields already belong to each card: [card type](../../src/lib/types.ts#L244-L257), [card fingerprint](../../src/lib/ai/agent-context.ts#L57-L72).
- Queue rule: preserve an existing active user run or pending proposal. Coalesce newer outline revisions for later assessment rather than silently replacing reviewed work. Current tools replace one complete pending proposal, so automatic reverse triggers need an explicit scheduling boundary around that behavior: [stage handlers](../../src/lib/ai/agent-tools.ts#L242-L315).
- Global outline rule: logline/overview changes may affect several chapters, while current manuscript requests/proposals target one chapter. A global change needs a chapter-scope decision or bounded sequence; it cannot be treated as an existing whole-book atomic rewrite. Sources: [task targets](../../src/lib/ai/agent-types.ts#L103-L124), [frozen manuscript target](../../src/lib/ai/agent-controller.ts#L1421-L1445).
- Persistence rule: a derived record based on unsaved prose must carry its source fingerprint. Discarding edits or reopening older disk content must invalidate/recompute that record rather than reporting it current. The existing persisted source fingerprint and metadata write queue are the starting points: [knowledge type](../../src/lib/types.ts#L155-L165), [write queue](../../src/stores/project-store.ts#L182-L240).
- Dependency decision: retain the installed AI SDK, provider factories, Zod schemas, refresh runtime, and proposal-review lifecycle. This design does not require an SDK upgrade, a new dependency, or a second approval state machine.

## 7. Acceptance and proof matrix for a future implementation

| Scenario | Required observable result | Test/proof level |
| --- | --- | --- |
| Pause while typing unsaved prose | Derived knowledge/eligible outline fields update without a save; editor remains dirty and undo works | Scheduler/refresh unit tests plus native UI proof |
| Keep typing during inference | Intermediate snapshots coalesce; late output is rejected; newest snapshot eventually wins | Deferred-promise unit tests |
| Change only selection/UI state or excluded scratch content | No unnecessary prose inference | Semantic-scheduling unit tests |
| Switch chapter/project while waiting | Old result cannot land on the new chapter/project; pending timers/controllers stop | Runtime/commit unit tests plus UI proof |
| Edit a generated chapter field manually | Later inference preserves that field while updating still-owned derived fields | Pure ownership-merge tests |
| Manually add/reorder/assign a card | Derived refresh preserves card IDs, order/ownership, cast/lore, and valid proposal anchors | Card merge and proposal tests |
| Change chapter outline | Agent stages a targeted manuscript proposal; prose remains unchanged before acceptance | Controller integration plus native UI proof |
| Accept or reject reverse proposal | Acceptance applies one guarded editor change/undo step; rejection preserves prose | Existing decision lifecycle tests extended |
| Edit outline again while a proposal is pending | Prior proposal is stale or explicitly regenerated for the new outline revision | Proposal freshness tests |
| Background derived outline updates | No reverse feedback loop and no surprise user chat turn | Origin/scheduler tests |
| User already has an active run/proposal | Automatic work queues without replacing it | Scheduling integration tests |
| Save, discard, undo, or reopen after live inference | Derived source fingerprints match the relevant live/disk state; stale records do not claim freshness | Lifecycle/persistence tests |
| Model/key/provider error or invalid structured output | Actionable failure; no blank/corrupt writes; original author data survives | Provider/schema/runtime tests and rendered error-state proof |
| One reducer or metadata write fails | Existing atomic/partial-result contract is preserved; retry is idempotent | Deferred failure and durable rollback tests |
| Delete/reorder/rename chapter during work | No resurrected data; ordered synthesis reflects newest topology | Existing topology tests extended |
| Whole-story outline change | Impacted chapter scope is explicit; no unsupported multi-chapter auto-apply | Controller and proposal tests |

- Existing source-reviewed coverage to retain: [queue coalescing/cancellation/failure](../../src/stores/story-refresh-store.test.ts#L187-L255), [unapplied-character retry](../../src/stores/story-refresh-store.test.ts#L343-L410), [initial/incremental indexing](../../src/lib/story-knowledge/refresh.test.ts#L259-L331), [map failure isolation](../../src/lib/story-knowledge/refresh.test.ts#L637-L664), [partial character failure](../../src/lib/story-knowledge/refresh.test.ts#L667-L707), [stale inputs/rollback](../../src/stores/project-store.test.ts#L1900-L1996), [topology races](../../src/stores/project-store.test.ts#L2072-L2143), [overlapping writes](../../src/stores/project-store.test.ts#L2431-L2504).
- Future proof must exercise a running native app with actual configured AI requests for reachable flows. Screenshots must show typing, derived state, staged proposal, pre-accept unchanged prose, and post-accept behavior. Deterministic tests supplement that proof; they do not establish a live inference path.
