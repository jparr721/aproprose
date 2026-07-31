# Agentic AI Console Design

Date: 2026-07-30

Status: Approved

## Summary

Replace the right-panel collection of independent AI screens with one persistent,
agentic conversation console. Every in-app AI action opens or targets this console.
The author works in one project-scoped conversation, switches between Writing and
Edit modes, collects manuscript context as attachments, watches tool activity, and
reviews proposed changes in a sticky tray before anything changes.

The console always docks on the right. It remains independent of the existing left
navigation sidebar and can stay open beside both the editor and PDF viewer. It never
becomes a bottom sheet or overlay.

The implementation uses the Vercel AI SDK and the existing AI Elements components.
OpenAI is the only supported inference provider. The in-app Codex and Claude CLI
provider integrations are removed.

## Goals

- Put every in-app AI interaction in one right-side operation console.
- Keep one durable conversation per project.
- Let the author collect any number of blocks before submitting a prompt.
- Make "Pick Up From Here" bridge into existing later prose instead of blindly
  appending.
- Show tool progress without exposing raw chain-of-thought.
- Keep generated manuscript and outline changes reviewable and reversible.
- Let the author read changes in the editor, collect more context, and follow up
  without leaving the conversation.
- Apply exactly one current mode prompt to each submitted run.
- Keep the editor, PDF, and AI console visible together.
- Remove the legacy AI tabs, caches, handoffs, and provider branches.

## Non-goals

- Multiple conversations, a conversation selector, or historical chat navigation.
- A bottom dock, floating window, modal chat, or overlay layout.
- Direct model writes to the manuscript or outline.
- Raw chain-of-thought or hidden reasoning display.
- More than one active agent run per project.
- Preserving legacy Suggest, Edit, Critique, Brainstorm, Continuity, or Muse results.
- Preserving the in-app Codex or Claude CLI provider integrations.

## Experience Model

### Right-side shell

The existing app shell remains:

```text
SidebarProvider
  AppSidebar                    existing left navigation
  SidebarInset
    TopBar
    ResizablePanelGroup
      Editor and optional PDF
      ResizableHandle
      AgentConsole              independent right dock
```

The console continues to use the existing right `ResizablePanel`. It does not use a
second shadcn `SidebarProvider`, because the current provider owns a single collapse
state and Command+B behavior for the left sidebar. The right panel keeps its own
`aiOpen` state and persisted width.

The current far-right icon rail is removed. Clicking the console X sets `aiOpen` to
false and changes no conversation state. The existing top-bar AI action reopens the
same console. Reopening restores the transcript, draft, mode, and pending proposal.

No responsive breakpoint changes the console into an overlay or bottom panel.
When the editor, PDF, and AI are all open, the resizable panels share the available
horizontal space.

### Console anatomy

The console has four stable regions:

1. Header
   - Console title.
   - Current project or chapter context label.
   - Close button.
2. Conversation
   - User and assistant messages.
   - Context attachments.
   - Expandable tool rows.
   - Inline errors and retry actions.
3. Sticky review tray
   - Present only while a proposal exists.
   - Pinned above the composer.
   - Expands in place without opening a separate screen.
4. Composer
   - Writing or Edit mode selector.
   - Draft context attachments.
   - Prompt input.
   - Context usage indicator.
   - Submit or stop action.

The implementation composes the existing AI Elements components:

- `Conversation`, `ConversationContent`, and `ConversationScrollButton`
- `Message`, `MessageContent`, `MessageResponse`, and message actions
- `PromptInput` and its stock input controls
- `Attachments` and `Attachment`
- `Tool`, `ToolHeader`, `ToolContent`, and safe tool result projections
- `Context` and its usage details

The proposal tray remains an app-domain component because it must resolve changes
against the live manuscript and outline stores. It uses the existing shadcn card,
button, collapsible, alert, and typography primitives.

## Modes

### Mode definitions

The only modes are:

```ts
type AgentMode = "writing" | "edit";
```

Writing mode favors:

- Continuing prose.
- Bridging between existing sections.
- Expanding a scene.
- Exploring story possibilities.
- Preserving the author's voice and later chapter text.

Edit mode favors:

- Conservative revision.
- Critique and continuity analysis.
- Cleanup and restructuring.
- Minimal changes that satisfy the request.
- Explicit review before application.

Both modes can answer questions, read project context, analyze prose, and stage
reviewable changes. They are behavioral prompts, not separate tool permissions.

### Prompt isolation

Messages persisted in the conversation never contain system prompts. At submit time,
the controller freezes the current mode and creates a new agent instance with:

```text
shared base instructions
+ exactly one current mode prompt
+ current author voice preferences
+ current editing rules when applicable
```

The request contains the compacted conversation summary, recent messages, sent
context snapshots, and current pending-proposal state. Previous Writing or Edit
system prompts are never replayed.

Switching modes does not clear or fork the conversation. If the author switches
while a run is active, the active run keeps its frozen mode and the new mode applies
to the next submission.

The composer border communicates mode with existing theme tokens:

- Writing uses the purple AI tint and edge tokens.
- Edit uses a clay or light-red semantic tint and edge token.

No literal color values are added at component call sites.

## Conversation and Context Attachments

### Draft attachments

The editor exposes "Add to Chat" on each eligible block and selection action.
Invoking it:

- Opens the right console if hidden.
- Leaves the current mode unchanged.
- Adds a removable attachment chip to the unsent draft.
- Does not submit a message.
- Does not navigate away from the editor.

The author can repeat the action across chapters or blocks, then type one question
about the complete set. Adding the same live source twice keeps one draft attachment.

Draft attachments are live references:

```ts
type DraftContextRef =
  | {
      kind: "block";
      projectRoot: string;
      chapterId: string;
      blockId: string;
    }
  | {
      kind: "outline-card";
      projectRoot: string;
      chapterId: string;
      cardId: string;
    }
  | {
      kind: "finding";
      projectRoot: string;
      chapterId: string;
      findingId: string;
    };
```

Their labels and previews resolve against current project state while the draft is
unsent. A deleted source remains as an explicit unavailable chip until the author
removes it.

### Sent snapshots

Submission resolves every draft reference into an immutable snapshot:

```ts
interface ContextSnapshot {
  id: string;
  kind: "block" | "outline-card" | "finding";
  projectRoot: string;
  chapterId: string;
  sourceId: string;
  order: number;
  sourceType: string;
  label: string;
  exactText: string;
  sourceFingerprint: string;
}
```

The message keeps this snapshot even if the live source later changes or disappears.
Clicking a sent attachment navigates to the live source when it still exists.
Otherwise the attachment opens its saved snapshot without pretending that the live
source still exists.

The domain model remains strongly typed. A presentation adapter maps a
`DraftContextRef` or `ContextSnapshot` into AI Elements `SourceDocumentUIPart` data
for the stock attachment UI. Manuscript state is not coerced into `FileUIPart`, and
the AI Elements attachment components are not forked.

## Agent Runtime

### Run boundary

One run is active per project. Submission creates a frozen run descriptor:

```ts
interface AgentRun {
  id: string;
  projectRoot: string;
  mode: AgentMode;
  targetChapterId: string | null;
  userMessageId: string;
  attachments: ContextSnapshot[];
  startedAt: string;
}
```

Changing the active chapter does not redirect the run. Read tools use the frozen
project and explicit target IDs, never whichever chapter happens to be visible when
the tool executes.

The composer may continue accepting text and new draft attachments while a run is
active, but it cannot submit a second turn. Those edits prepare the next turn. The
submit control becomes Stop and aborts the active stream through `AbortController`.

### AI SDK agent

Each submission creates a Vercel AI SDK `ToolLoopAgent` with:

- The selected OpenAI model.
- Instructions built from the frozen mode.
- One shared tool set.
- A bounded step count.
- The run abort signal.

The initial bound remains eight tool-loop steps, matching the existing Muse safety
limit. Staging either proposal kind ends the mutating portion of a run.

The result is consumed as an AI SDK UI message stream so tool states and assistant
text render incrementally through AI Elements. No separate HTTP server or API route
is introduced. OpenAI requests continue through the Tauri HTTP transport and the
Rust-managed API key path.

### Shared tools

The shared tool set is:

| Tool | Purpose | Mutates project |
|---|---|---|
| `read_chapter` | Read ordered chapter blocks and their fingerprints | No |
| `read_outline` | Read outline chapters, cards, and fingerprints | No |
| `read_lore` | Read relevant lore and project context | No |
| `run_critique` | Produce structured, block-linked critique findings | No |
| `run_continuity` | Produce structured, block-linked continuity findings | No |
| `read_pending_proposal` | Read the complete current proposal workspace | No |
| `stage_manuscript_proposal` | Replace the pending manuscript proposal | Agent state only |
| `stage_outline_proposal` | Replace the pending outline proposal | Agent state only |

No agent tool accepts or applies a proposal. Project mutations occur only through
the deterministic review tray actions.

Tool rows show the operation name, status, target, and a compact result summary.
Full chapter bodies and other large raw tool payloads remain runtime-only and are
not rendered or persisted. Raw model reasoning is never requested or displayed.

## Proposal Workspace

### One pending workspace

The project has at most one pending proposal:

```ts
type PendingProposal =
  | ManuscriptPendingProposal
  | OutlinePendingProposal;
```

Both variants contain:

- Stable proposal ID.
- Project root and chapter ID.
- Summary.
- Ordered reviewable changes.
- Per-change source preconditions.
- Creation timestamp.
- Originating message ID.

Calling either stage tool replaces the complete pending workspace transactionally.
The old proposal remains visible until the new tool call succeeds. A failed follow-up
does not discard the last valid proposal.

When a follow-up asks to modify pending work, the agent calls
`read_pending_proposal`, considers any new attachments, and stages a complete
replacement. It never emits an unmergeable partial delta.

### Review tray

The collapsed tray shows:

- Proposal summary.
- Manuscript or Outline label.
- Number of remaining changes.
- Accept All and Reject All.

Expanding the tray shows one review card per change:

- Rewrite diff.
- Insert location and proposed text.
- Remove preview.
- Move source and destination.
- Reason.
- Accept and Reject.

Selecting a card navigates the editor or outline board to its live target and
highlights it. This does not close the tray or alter the conversation.

### Preconditions and stale changes

Every proposed change records the exact source assumptions needed to apply safely:

- Rewrite or remove: target content fingerprint.
- Insert: anchor fingerprint and expected following source ID.
- Move: target fingerprint and source ordering fingerprint.
- Outline rewrite or remove: target card fingerprint.
- Outline add or move: outline ordering fingerprint.

Accept validates the selected change against live state. Accept All validates the
complete set against one live snapshot, then applies it atomically. A failed
precondition disables the unsafe action and reports that regeneration is required.
No changed or deleted target is silently skipped.

Accepting one change removes it from the tray, records the proposal event in the
conversation, and revalidates the remaining changes. Dependencies made stale by the
accepted change become visibly unavailable.

Accept All creates one undo operation. Manuscript changes use one editor history
snapshot. Outline changes use one outline metadata history snapshot. Rejecting
changes performs no project write.

## "Pick Up From Here"

The block action dispatches an immediate Writing run with:

- The selected prose block as the anchor attachment.
- Its chapter ID as the frozen target.
- A standard bridging directive.

The agent calls `read_chapter` and receives the complete ordered chapter, including
all prose before and after the anchor.

If a later block exists:

- Treat the anchor as the left boundary.
- Treat the next existing block as the right boundary.
- Propose the minimum insertion needed to bridge into that later prose.
- Preserve the later block and the remainder of the chapter.
- Never interpret the action as permission to rewrite the existing later half.

If the anchor is the final prose block:

- Propose continuation blocks after it.
- Do not invent a right boundary.

The result is staged as a manuscript proposal between the anchor and its expected
successor. Nothing is inserted until the author accepts it.

## Entry-point Mapping

Every existing AI affordance dispatches one typed agent intent:

```ts
type AgentIntent =
  | { kind: "add-context"; refs: DraftContextRef[] }
  | {
      kind: "prefill";
      mode: AgentMode;
      text: string;
      refs: DraftContextRef[];
    }
  | {
      kind: "run";
      mode: AgentMode;
      text: string;
      refs: DraftContextRef[];
    }
  | { kind: "focus"; mode: AgentMode };
```

The discriminated union replaces the legacy tab target and `autoRun` flag.

| Existing entry point | Agent intent |
|---|---|
| Add to Chat | `add-context`, current mode, no submission |
| Pick Up From Here | `run`, Writing, anchor attachment |
| Suggest next | `run`, Writing, selected anchor |
| Clean up with AI | `run`, Edit, selected block |
| Structure with AI | `run`, Edit, selected block |
| Critique | `run`, Edit, current chapter |
| Continuity | `run`, Edit, current chapter |
| Outline Sculpt | `run`, Edit, selected outline chapter |
| Brainstorm | `focus`, Writing |
| Muse | Removed; Writing is the replacement |
| Send to Edit | Removed; follow up in the same conversation |

The command palette keeps:

- Open AI Console.
- Use Writing Mode.
- Use Edit Mode.
- Suggest From Context.
- Pick Up From Here.
- Critique Chapter.
- Check Continuity.

The full-page Outline board remains a non-AI workspace. Its Sculpt button opens the
console, runs the agent, and stages an outline proposal in the same sticky tray.
The right-panel Outline tab is removed.

## State and Persistence

### Stores

`view-store` keeps layout state only:

- `aiOpen`
- `rightPanelWidth`
- Existing PDF, Outline, focus, and guarded-navigation state

It removes:

- `AiTab`
- `aiTab`
- `aiCollapsed`
- `setAiTab`
- `setAiCollapsed`
- `openAiTab`

One `agent-console-store` owns project-shared AI state:

- Current mode.
- Persisted messages.
- Unsent draft text.
- Draft context references.
- Current context summary.
- Last usage details.
- Active run descriptor and abort controller metadata.
- Pending proposal.
- Persistence error.

The runtime service owns model construction, request conversion, tools, streaming,
and compaction. Store actions remain synchronous state transitions where possible.

The following legacy state is removed:

- `ai-intent-store`
- `ai-cache-store`
- `ai-activity-store`
- `brainstorm-store`
- `muse-store`
- Tab-specific `useAi` and intent hooks

### Persisted schema

The per-project AI blob becomes:

```ts
interface PersistedAgentState {
  v: 3;
  mode: AgentMode;
  messages: PersistedAgentMessage[];
  summary: {
    text: string;
    throughMessageId: string;
  } | null;
  draftText: string;
  draftContextRefs: DraftContextRef[];
  pendingProposal: PendingProposal | null;
  lastUsage: PersistedUsage | null;
  interruptedRun: InterruptedRun | null;
}
```

Transient streams, abort controllers, raw tool outputs, and system prompts are never
persisted.

Closing the dock changes no persisted field. Project switching flushes the current
state before loading the next project state. An in-flight run is aborted when its
project closes.

Legacy v1 and v2 AI blobs intentionally migrate to an empty v3 conversation because
the old tab caches and per-chapter chat threads have no truthful chronological merge.
This migration affects AI history only and never manuscript or outline data.

A missing blob initializes an empty conversation. A malformed or unreadable current
blob raises a typed persistence error, leaves the unreadable data untouched, and
shows Reset AI Conversation behind an `AlertDialog`. It is not silently replaced.
A save failure keeps the in-memory state, shows a persistent error with Retry, and
does not claim that the conversation was saved.

### Context compaction

The complete visible transcript remains persisted and renderable. The model request
does not replay it forever.

The runtime uses the existing `tokenlens` dependency:

- `Context` renders the latest usage and model context size.
- `shouldCompact` uses its default 85 percent threshold.
- `tokensToCompact` determines how much settled history must leave the next request.

Compaction selects the oldest complete user and assistant turns, excluding the most
recent turns and any active stream. A separate no-tool model call summarizes those
turns into neutral context containing:

- Author decisions.
- Referenced source identities.
- Important story and editing constraints.
- Proposal outcomes.
- Unresolved questions.

The summary excludes:

- Prior system or mode prompts.
- Raw tool payloads.
- Raw reasoning.
- Superseded proposal bodies.

The saved `throughMessageId` prevents the same turns from being summarized twice.
The full transcript remains visible; only the next model request substitutes the
summary for older turns. A visible context-compaction status row records the event.

If compaction fails, submission stops with an inline retryable error. It does not
silently drop history or submit an oversized request.

## Stop, Retry, and Failure Behavior

### Stop

Stopping a run:

- Aborts the model stream and active tool operations.
- Keeps the submitted user message.
- Keeps completed assistant text and tool rows.
- Marks the assistant turn as stopped.
- Keeps a proposal only if its stage tool completed successfully.
- Leaves the next draft untouched.

### Retry

Retry creates a new run from the failed turn's frozen:

- Mode.
- Project and target chapter.
- User text.
- Context snapshots.

It does not use the current composer mode or silently substitute current live source
text. The author can instead edit and submit a new turn when new context is desired.

### Error presentation

- OpenAI key or model configuration errors link to AI Settings.
- Model and transport errors render inline on the failed assistant turn.
- Tool failures render on the corresponding `Tool` row.
- Stale proposal failures render in the review tray.
- Persistence failures render as a persistent console banner.
- All retry actions retain the original error context.

Errors never trigger a provider fallback or direct project mutation.

## OpenAI-only Provider Cleanup

The product inference path becomes OpenAI-only.

Remove from frontend product code:

- `AiProvider` and `CliKind` product types.
- `aiProvider` settings state and setter.
- Provider selector and CLI status UI.
- `cli-provider.ts` and its tests.
- CLI invoke types and functions in `src/lib/tauri.ts`.
- `supportsTools` and provider branches in `src/lib/ai/model.ts`.
- Muse unsupported-provider UI and tests.
- Unused AI Elements Open in Chat provider menu if it is the remaining product
  reference to Claude.

Remove from the Rust product backend:

- `src-tauri/src/ai_cli.rs`.
- The `ai_cli` module export.
- `cli_provider_status` and `cli_generate` command registration.
- Dependencies used only by the removed module.
- Product comments and path diagnostics that claim Codex or Claude inference
  support.

AI Settings retain:

- OpenAI API key management.
- OpenAI model discovery and selection.
- Writing voice preferences.
- Editing rules, renamed to remove Muse terminology.

Persisted settings ignore and remove the obsolete `aiProvider` field during
hydration. Users without an OpenAI key or selected model see the standard OpenAI
configuration state.

## Component and File Direction

The implementation should converge on:

```text
src/components/app/agent-console/
  agent-console.tsx
  agent-conversation.tsx
  agent-composer.tsx
  agent-message.tsx
  context-attachments.tsx
  review-tray.tsx
  manuscript-review.tsx
  outline-review.tsx

src/lib/ai/
  agent-runtime.ts
  agent-prompts.ts
  agent-tools.ts
  agent-context.ts
  agent-proposals.ts
  agent-compaction.ts

src/stores/
  agent-console-store.ts
  agent-persistence.ts
```

This is a direction, not permission to create one abstraction per file. Existing
pure proposal reducers, context builders, diff rendering, retries, and OpenAI model
construction should be reused or moved when they already express the required
behavior. Legacy tab components should be deleted after their useful domain logic
has moved.

## Verification

### Unit tests

- Request construction includes exactly one current mode prompt.
- Persisted history never contains system prompts.
- Switching modes during a run affects only the next run.
- Draft context stays live and sent context freezes exact text, order, and type.
- Sent attachments retain snapshots when live sources change or disappear.
- "Pick Up From Here" reads the full chapter.
- A middle anchor stages insertion before the existing successor.
- A final anchor stages an append.
- Later chapter prose remains unchanged.
- Stage tools replace the pending proposal only after success.
- Follow-ups read and replace the complete pending proposal.
- Per-change preconditions reject changed text, deleted targets, and changed order.
- Accept one revalidates remaining changes.
- Accept All is atomic and creates one undo operation.
- Stop and retry preserve the correct frozen run data.
- Compaction omits old mode prompts and retains author decisions.
- Persistence round-trips v3 state.
- v1 and v2 AI state intentionally migrate to an empty v3 conversation.
- Malformed current state and save failures surface typed errors.
- OpenAI model construction has no provider branch.

### Component tests

- X hides the console and reopening restores its state.
- Writing and Edit mode styling uses the correct theme tokens.
- Add to Chat collects multiple removable chips without submitting.
- Submitting clears the sent draft but preserves attachments in the message.
- Tool rows stream through pending, completed, stopped, and error states.
- Context usage renders through AI Elements.
- The sticky tray remains above the composer while the conversation scrolls.
- Selecting a proposed change navigates to its live editor or outline context.
- Stale changes disable Accept.
- API configuration errors link to Settings.
- The legacy tab rail and screens are absent.

### Flow tests

- Editor + PDF + AI remain simultaneously docked.
- Pick Up bridges between two existing blocks and preserves the later half.
- A follow-up can add more blocks and replace the pending proposal.
- Manuscript changes can be accepted individually or atomically.
- Outline Sculpt runs in the console and is reviewed in the same tray.
- Project switching never mixes conversations or active runs.

### Required commands

```text
just typecheck
just test
just build
just fmt
```

The Rust removal also requires `cargo test` and clippy through the existing `just`
recipes. UI verification must inspect the editor-only, editor-plus-AI, and
editor-plus-PDF-plus-AI layouts.

## Acceptance Criteria

- There is one AI conversation per project and no conversation selector.
- The AI console always docks on the right.
- Closing the console never clears conversation or proposal state.
- The old AI tab rail and bespoke AI screens no longer exist.
- Writing and Edit share one transcript and one shared tool set.
- Each run receives exactly one current mode prompt.
- Add to Chat collects multiple live references and sent messages freeze snapshots.
- Pick Up From Here bridges into later prose or appends only at the chapter end.
- Tool calls are visible and raw reasoning is not.
- No AI tool directly mutates manuscript or outline data.
- The sticky tray supports navigation, Accept, Accept All, Reject, and stale guards.
- Editor, PDF, and AI can remain open together.
- In-app Codex and Claude provider support is removed.
- All verification commands pass.
