# Specialist prompts and planner implementation slices

- Source: approved agentic editorial design/contracts, existing Settings assistant and background authoring audit.
- Gate status: local verification explicitly authorized by the user. Regression tests reproduce the prior defects before fixes; root owns the aggregate full gate.
- Root owns final assignments. File sets below are disjoint within each wave; controller integration follows foundation work.
- Assigned foundation additions: `src/agents/action-contracts.ts`, `src/agents/purpose-agent.ts`, `src/agents/index.ts`, `src/agents/action-contracts.test.ts`, `src/author/author-profile.ts`, `src/author/index.ts`, `src/author/author-profile.test.ts`, `src/lib/story-knowledge/prompts.ts`. Existing P1/P2 files and compaction belong to this worker; P3/P4 remain proposals owned by root/Book/Editorial workers.

## Grounded findings

| Existing seam | Source | Consequence |
|---|---|---|
| Plan opens a scoped session, but performs no inference | `src/components/app/outline/chapter-subview.tsx:62` | Start after hydration, once per new session; reopening resumes existing work |
| Planner explicitly waits for author prompt | `src/lib/ai/agent-prompts.ts:102` | Planner mission starts from complete target and asks one consequential question |
| Editor globally minimizes changes | `src/lib/ai/agent-prompts.ts:72` | Restrict conservative editing to Clean; master editor can propose substantial justified revisions |
| Preference labels subordinate author to generic craft guidance | `src/lib/ai/author-preferences.ts:22` | Declare author preferences above specialist heuristics, below application integrity |
| Critique/continuity include voice only | `src/lib/ai/operations.ts:129` | Include editing intent as evaluation context, without altering factual evidence |
| Background run captures no preferences | `src/stores/story-refresh-store.ts:330` | Freeze both preference fields for all five background operations |
| Whole target and neighbors share a truncated budget | `src/lib/outline/planner-grounding.ts:107` | Target-first grounding; explicit uninspected coverage; on-demand neighboring reads |
| Every action sees all 11 tools | `src/lib/ai/agent-tools.ts:361` | Registry declares action capabilities; validate availability at host boundary |
| First stage call ends runtime | `src/lib/ai/agent-runtime.ts:155` | Planning must continue to explain changes and ask the next question; explicit author/budget outcomes |
| Settings assistant already keeps review/apply/stale guards | `src/components/app/settings/preference-assistant.tsx:95` | Preserve UI flow; give each field its own prompt contract and use shared authority language |

## Exact slice proposals

| Slice | Behavior | Exact write set | Dependencies |
|---|---|---|---|
| P1 - Action registry and preferences | Versioned missions for planner, writer, literary editor, Clean, Structure, Bridge, next-beat, Critique, Continuity, character Describe, two Settings fields and five background tasks; one authority renderer | `src/agents/action-contracts.ts`, `src/agents/action-contracts.test.ts`, `src/lib/ai/agent-prompts.ts`, `src/lib/ai/agent-prompts.test.ts`, `src/lib/ai/author-preferences.ts`, `src/lib/ai/author-preferences.test.ts`, `src/lib/ai/refine-preference.ts`, `src/lib/ai/refine-preference.test.ts`, `src/lib/ai/operations.ts`, `src/lib/ai/operations.findings.test.ts`, `src/lib/ai/agent-compaction.ts`, `src/lib/ai/agent-compaction.test.ts` | None; may consume public Author contract once agreed |
| P2 - Frozen background intent | Background captures style/editing rules once; passes same preferences to all five calls; extraction preserves contradictory source facts rather than making prose obey preferences | `src/lib/story-knowledge/operations.ts`, `src/lib/story-knowledge/operations.test.ts`, `src/lib/story-knowledge/refresh.ts`, `src/lib/story-knowledge/refresh.test.ts`, `src/stores/story-refresh-store.ts`, `src/stores/story-refresh-store.test.ts` | P1 registry and authority renderer |
| P3 - Automatic planner and Q&A | New planner hydrates then diagnoses without draft text; one current question persists; actual author answer resumes; reopen does not rerun; existing proposal remains reviewable | `src/lib/ai/agent-controller.ts`, `src/lib/ai/agent-controller.test.ts`, `src/lib/ai/agent-flow.test.ts`, `src/lib/ai/agent-runtime.ts`, `src/lib/ai/agent-runtime.test.ts`, `src/lib/ai/agent-tools.ts`, `src/lib/ai/agent-tools.test.ts`, `src/lib/ai/agent-types.ts`, `src/stores/agent-console-store.ts`, `src/stores/agent-console-store.test.ts`, `src/stores/agent-persistence.ts`, `src/stores/agent-persistence.test.ts`, `src/components/app/outline/chapter-subview.tsx`, `src/components/app/outline/chapter-subview.test.tsx`, `src/components/app/agent-console/agent-message.tsx`, `src/components/app/agent-console/agent-message.test.tsx` | P1; Book/tool foundation; Editorial event/persistence owner |
| P4 - Target-first grounding | Complete canonical target blocks and notes precede context discovery; preserve speakers, dialogue tails and literal source; no eager neighbor reads | `src/lib/outline/planner-grounding.ts`, `src/lib/outline/planner-grounding.test.ts` | Book projection and P3 controller integration |

- P3 is too large for one parallel worker if Book and Editorial are being introduced in this PR. Preferred re-slice: Editorial owner takes types/store/persistence/question tool, runtime owner takes controller/runtime/tools integration, UI owner takes planner and question rendering. Their exact sets must be fixed before any write.
- Prompt catalog belongs to `src/agents`, not a second switch in every button. Existing `buildAgentInstructions` becomes a compatibility adapter that resolves one action and delegates instruction compilation.
- Capability names should come from the actual typed tool registry. Do not repeat an independent string catalog or reflect arbitrary public class methods.
- No mandatory DI package. Inject the selected action contract, frozen author contract and typed runtime ports into the existing execution adapter.

## Regression-first checks

1. Before prompt changes, add table-driven cases proving all task/session combinations resolve to exactly one distinct action, that only Clean inherits conservative defaults, and that author rules outrank craft defaults without overriding source identity or frozen write boundaries.
2. Add a preference above the old maximum and prove prompt compilation does not silently slice it. Existing persisted limits remain input validation; exact loaded declarations remain intact.
3. Capture Critique and Continuity generation options and assert both preference fields are present; unsupported IDs remain rejected/sanitized by the existing contract.
4. Capture all five background inference calls and verify identical frozen preferences survive settings changes midway through a run. Verify extraction instructions explicitly retain source contradictions and distinguish inferred observations from author wishes.
5. Add a deferred hydration UI regression: no run before hydration, exactly one start after hydration, duplicate mount/reopen resumes, switched project never starts an old chapter, existing session never loses its pending proposal.
6. Add planner-flow tests with genuine user submissions: automatic diagnosis, persisted question, answer, second question, card proposal, apply/reject. No model tool can fabricate an author answer or confirm a decision.
7. Add target grounding with a long chapter, repeated dialogue tails, scratch/lore blocks and a failing neighboring file. Complete target remains available; a neighbor is read only when the agent requests it.
8. Add runtime tests proving planner staging does not terminate before explanation/question, stop/cancel still aborts, and explicit budget exhaustion remains resumable.

## Existing contracts to preserve

- `submitAgentRequest(request, sessionId)` already supports programmatic nonempty requests and captures frozen settings/source. Add a dedicated idempotent planner start through the Editorial owner rather than writing synthetic text into the user's draft.
- `agentSessionStore(sessionId)` scopes persistence and ownership; `hydrateAgentOutlineSession(root, chapterId)` must complete before access. Preserve errors and recovery banners.
- Current manuscript/outline proposal preconditions and Apply/Reject remain the reviewed-write boundary until the shared Book workspace replaces them.
- `refinePreference(input, options)` already uses a validated structured output, configured model, retries, abort checks and explicit UI Apply. Reuse those mechanics.
- Background refresh input fingerprints and stale commit checks stay authoritative; adding intent must not silently bypass stale source or profile guards.

## Proof to collect

- Use a real draft with deliberate contradictions and an explicit nonstandard voice preference. Capture planner's automatic first diagnosis, first question, actual answer, refined cards, unchanged source before Apply, and reopened unanswered question.
- Capture writer/editor distinct behavior on the same passage; Clean keeps its narrow selected scope.
- Capture Settings refinement review and stale protection, and background operation preservation of author intent where native configured inference is available.
- Save captured evidence to the repository-required HTML deck under `docs/slides/`; mocked model tests alone do not prove live literary quality.
