# Agentic editorial contracts

- Decision: constructor-injected Book, AuthorProfile, Editorial and specialist Agent instances share typed content records and codecs; the tool catalog binds their domain operations under explicit run authority.
- Status: long-term contract sketches, not drop-in code. The initial implemented APIs are documented in book-foundation-slice-2026-10-07.md and specialist-slice-2026-10-07.md. Full workspace writes and the native journal below remain planned.
- Rationale, prompts, tool catalog and delivery gates: [architecture plan](agentic-editorial-design-2026-10-07.md).

## Usage: caller's view first

```ts
// Proposed application composition root, called once per loaded book.
import { createApplication } from "@/app/application";

const application = createApplication({
  records: validatedContent,
  ports: platformPorts,
});
const { book, author, editorial } = application;

// These are concrete instances implementing narrow SDK interfaces.
const contract = await author.resolve({ bookId, chapterId, sessionId });
const planner = await editorial.start({
  action: "chapter-planner",
  input: { bookId, chapterId },
  eventId: clickEventId,
});
```

```ts
// Proposed Plan with AI event handler.
import type { EditorialSdk } from "@/editorial";

async function openChapterPlanner(input: PlannerClick, editorial: EditorialSdk): Promise<void> {
  const session = await editorial.start({
    action: "chapter-planner",
    input: { bookId: input.bookId, chapterId: input.chapterId },
    eventId: input.eventId,
  });
  // start returns after durable session/start-event creation and dispatches work.
  // UI subscribes to reading, issues, current question and draft cards.
  input.showSession(session.id);
}

async function answerPlannerQuestion(input: PlannerAnswer, editorial: EditorialSdk): Promise<void> {
  await editorial.respond({
    sessionId: input.sessionId,
    expectedSessionRevision: input.sessionRevision,
    questionId: input.questionId,
    response: { kind: "answer", text: input.text },
    eventId: input.eventId,
  });
  // The persisted answer resumes the correct specialist; UI does not build prompts.
}
```

```ts
// Distinct sidebar agents; UI never chooses a model tool set directly.
import type { EditorialSdk } from "@/editorial";

async function askWriter(input: WriterSubmission, editorial: EditorialSdk): Promise<SessionHandle> {
  return editorial.start({
    action: "writer",
    input: {
      bookId: input.bookId,
      target: input.target,
      request: input.text,
    },
    eventId: input.eventId,
  });
}

async function askEditor(input: EditorSubmission, editorial: EditorialSdk): Promise<SessionHandle> {
  return editorial.start({
    action: "literary-editor",
    input: {
      bookId: input.bookId,
      target: input.target,
      request: input.text,
    },
    eventId: input.eventId,
  });
}
```

```ts
// Review application and source saving remain explicit different operations.
import type { BookSdk } from "@/book";

async function applyReviewedChanges(input: ReviewSelection, book: BookSdk): Promise<WorkingApplyReceipt> {
  return book.applyWorkspace({
    workspaceId: input.workspaceId,
    expectedWorkspaceRevision: input.workspaceRevision,
    groupIds: input.selectedGroupIds,
    authorEventId: input.eventId,
  });
}

async function saveBookDraft(input: SaveSelection, book: BookSdk): Promise<SourceSaveReceipt> {
  return book.save({
    bookId: input.bookId,
    expectedWorkingRevision: input.workingRevision,
    scope: input.scope,
    authorEventId: input.eventId,
  });
}
```

- `PlannerClick`, submissions and selections are typed UI event values. IDs come from the application composition root and validated persisted records, not the model.
- Manual editing of a proposed card calls `editorial.reviseDraft` with that workspace's revision. Editing accepted book content calls `book.editDraft`. Neither route imports a store's internal mutation method.
- The public action boundary takes care of session hydration, action/target validation, current settings, unsaved sources, SDK creation, tool binding, persistence and continuation.
- Components receive project-scoped instances through the application scope; they do not import mutable module singletons. Reopening a project rehydrates records and constructs fresh dependencies. Dispose cancels runs and subscriptions, not durable content.

## Public module contracts

| Entry | Public operations | Internal decisions |
|---|---|---|
| `@/content` | Record header/reference/codec protocol | No concrete payload schemas, persistence backend or runtime dependencies |
| `@/book` | Read view, edit working draft, workspace stage/review/apply, save, undo, subscribe | Source projection, entity identity, reference integrity, revisions, serialization, persistence |
| `@/author` | Resolve contract, inspect conflicts, propose/confirm scoped intent | Declared versus inferred authority, rule applicability, explicit exceptions, global versus project storage |
| `@/editorial` | Start, respond, steer, resume/stop, revise draft, inspect/subscribe | Session records, issues/questions/decisions, coverage, specialist selection and workspace references |
| `@/agents` | Application-internal execution port | Specialist contracts, SDK tools/messages, stream lifecycle, provider/model capture and budgets |
| `@/app/application` | Construct/dispose typed project-scoped instances | Concrete adapters, codec contributions, agent factory and tool binding |

- Components import public domain APIs and view hooks. Agent handlers receive read/workspace/editorial ports, never Zustand stores, raw filesystem functions or credential APIs.
- `@/agents` is not a second application API for UI callers. The composition root provides it to Editorial.
- Public domain values contain no Vercel UIMessage, LanguageModel, Zod schema, Tauri DTO, raw/dirty serialization flags or Zustand state object. Private adapters parse those into the domain contract.

## Identity and complete source

```ts
// Expanded type notation for review. Implementation derives validated IDs and
// domain values from the owning schemas, with no casts at call sites.
declare const bookIdentity: unique symbol;
declare const entityIdentity: unique symbol;
declare const revisionIdentity: unique symbol;
declare const eventIdentity: unique symbol;
declare const sessionIdentity: unique symbol;
declare const workspaceIdentity: unique symbol;
declare const groupIdentity: unique symbol;
declare const questionIdentity: unique symbol;

type BookId = string & { readonly [bookIdentity]: true };
type EntityId = string & { readonly [entityIdentity]: true };
type Revision = string & { readonly [revisionIdentity]: true };
type EventId = string & { readonly [eventIdentity]: true };
type SessionId = EntityId & { readonly [sessionIdentity]: true };
type WorkspaceId = EntityId & { readonly [workspaceIdentity]: true };
type ChangeGroupId = EntityId & { readonly [groupIdentity]: true };
type QuestionId = EntityId & { readonly [questionIdentity]: true };

type BookAddress =
  | { kind: "metadata" }
  | { kind: "chapter-order" }
  | { kind: "chapter"; chapterId: EntityId }
  | { kind: "block"; chapterId: EntityId; blockId: EntityId }
  | { kind: "book-spine" }
  | { kind: "chapter-plan"; chapterId: EntityId }
  | { kind: "card"; chapterId: EntityId; cardId: EntityId }
  | { kind: "character"; characterId: EntityId }
  | { kind: "lore"; loreId: EntityId }
  | { kind: "intent"; intentId: EntityId }
  | { kind: "knowledge"; knowledgeId: EntityId }
  | { kind: "source"; sourceId: EntityId }
  | { kind: "asset"; assetId: EntityId };

interface SourceRef {
  readonly bookId: BookId;
  readonly address: BookAddress;
  readonly revision: Revision;
  readonly snapshotId: EntityId;
  readonly representation: "authoring-text" | "literal-source" | "entity-text";
}

interface LiteralSourceRef extends SourceRef {
  readonly representation: "literal-source";
}

interface TextRange {
  readonly startUtf16: number;
  readonly endUtf16: number;
}

interface Evidence {
  readonly source: SourceRef;
  readonly range: TextRange;
  readonly exactQuote: string;
}

interface CitationRequest {
  readonly source: SourceRef;
  readonly exactQuote: string;
  readonly occurrence: number;
}

type BlockValue =
  | { kind: "narration"; text: string }
  | {
      kind: "dialogue";
      openingQuote: string;
      speakerId: EntityId | null;
      tail: readonly DialogueSegment[];
    }
  | { kind: "scene"; label: string }
  | { kind: "break"; separator: string }
  | { kind: "lore-note"; title: string; text: string }
  | { kind: "scratchpad"; text: string }
  | { kind: "latex"; source: string };

interface ReadBlock {
  readonly source: SourceRef;
  readonly order: number;
  readonly content: BlockValue;
  readonly citationText: SourceFragment;
}

interface SourceFragment {
  readonly source: SourceRef;
  readonly range: TextRange;
  readonly exactText: string;
  readonly origin: "author-draft" | "workspace" | "saved-source";
}

interface CoverageReceipt {
  readonly source: SourceRef;
  readonly inspectedRanges: readonly TextRange[];
  readonly completedStepIds: readonly EntityId[];
  readonly status: "partial" | "complete";
}
```

- `DialogueSegment` reuses the existing beat/quote domain shape. Optional serialization fields from the current `Block` are converted once into total domain variants; exact original source remains in the internal immutable source snapshot.
- Ranges refer to the immutable decoded rendition named by `snapshotId` and `representation`. Authoring text includes normalized emphasis and complete dialogue; literal source contains exact LaTeX. These have different coordinate spaces. The host retains their source map and never treats an authoring-text offset as a raw-source offset. Native byte offsets are converted and validated inside the adapter.
- Model tools submit a source handle, exact quote and occurrence to host citation resolution. The host returns validated `Evidence` or an explicit mismatch/ambiguity error. Issue/change tools accept validated evidence handles, not model-calculated UTF-16 or LaTeX offsets. A content digest/revision and occurrence/neighbor anchors support relocation; parse-local IDs alone do not.
- Preserve current character/card/lore identities. Migrate path-derived chapter identities through aliases. Reconcile application-known edits through explicit lineage; ambiguous external edits retire the anchor instead of selecting by position.
- Pagination can split an oversized block into exact ranges with its structural context. Returned pages declare what remains. Reading page one never certifies full chapter coverage.
- The host computes coverage from completed source-inspection steps or validated map results. The model cannot set a Boolean claiming it read everything. Mapped coverage is labeled separately from the coordinator's direct close reading.

```ts
interface BookReadView {
  readonly bookId: BookId;
  readonly viewId: EntityId;
  readonly workingRevision: Revision;
  manifest(input: ManifestPageRequest): Promise<ManifestPage>;
  chapter(input: ChapterPageRequest): Promise<ChapterPage>;
  entity(input: EntityReadRequest): Promise<BookEntity>;
  source(input: SourceRangeRequest): Promise<SourceFragment>;
  search(input: BookSearchRequest): Promise<SearchPage>;
  related(input: RelatedSourceRequest): Promise<RelatedSourcePage>;
  history(input: HistoryRequest): Promise<HistoryPage>;
  cite(input: CitationRequest): Promise<Evidence>;
}

interface ChapterPage {
  readonly chapter: SourceRef;
  readonly blocks: readonly ReadBlock[];
  readonly totalBlocks: number;
  readonly next: { kind: "end" } | { kind: "more"; cursor: EntityId };
  readonly suppliedRanges: readonly TextRange[];
}
```

- Manifest, entity, search and related-source results use the exhaustive book address/entity schema, include source revisions and freshness, and are bounded by a validated cursor/limit. They do not return arbitrary paths or generic payload bags.
- `BookEntity` covers complete metadata, chapter topology/status, chapter plan, card relations/findings, characters, lore, author intentions, knowledge, other manifested source and assets. The main plan's access matrix is the field-completeness checklist.
- A stale page cursor fails with `SourceRevisionConflict`. Search indexes derive from the same read view and include unsaved drafts. They are not separately writable truth.

## Common content types and codecs

```ts
// Shared protocol in @/content. Concrete schemas live with their domain owner.
type ContentNamespace =
  | { readonly kind: "local" }
  | { readonly kind: "book"; readonly bookId: BookId }
  | { readonly kind: "editorial"; readonly bookId: BookId };

interface ContentHeader<Kind extends string, Id> {
  readonly owner: ContentNamespace;
  readonly kind: Kind;
  readonly id: Id;
  readonly schemaVersion: number;
  readonly revision: Revision;
}

interface ContentValue<Kind extends string, Id, Value> {
  readonly header: ContentHeader<Kind, Id>;
  readonly value: Value;
}

// Expanded illustration of the registry-derived union, not a parallel schema.
type BookRecord = ContentValue<"book", BookId, BookValue>;
type ChapterRecord = ContentValue<"chapter", ChapterId, ChapterValue>;
type CardRecord = ContentValue<"card", CardId, CardValue>;
type AuthorProfileRecord = ContentValue<"author-profile", AuthorProfileId, AuthorProfileValue>;
type EditorialSessionRecord = ContentValue<"editorial-session", SessionId, EditorialSessionValue>;
type ContentRecord = BookRecord | ChapterRecord | CardRecord | AuthorProfileRecord | EditorialSessionRecord;

interface ContentCodec<RecordValue> {
  decode(input: unknown): RecordValue;
  encode(input: RecordValue): SerializedContent;
}

interface ContentRef<Kind extends string, Id> {
  readonly owner: ContentNamespace;
  readonly kind: Kind;
  readonly id: Id;
}

interface ContentSnapshotRef<Kind extends string, Id> {
  readonly target: ContentRef<Kind, Id>;
  readonly revision: Revision;
  readonly snapshotId: EntityId;
}
```

- `ChapterId`, `CardId` and `AuthorProfileId` are schema-validated branded IDs, like the earlier Book/session IDs. `BookValue`, `ChapterValue` and `EditorialSessionValue` are complete owning-domain payloads. The expanded union illustrates the base composition; the real registry includes every kind in the access matrix, not only these five examples.
- `ContentRef` identifies an entity whose current state may change. `ContentSnapshotRef` and the richer `SourceRef` identify an exact version for evidence/preconditions. Neither serializes a pointer to a live object.
- Owning schemas constrain each kind's allowed namespace; a chapter cannot belong to local settings. References compare namespace, kind and validated ID together. Hydration decodes/migrates first, validates live references and graph membership second, then constructs instances and publishes state. Historical references resolve against retained snapshots/tombstones; missing historical bytes return an explicit unavailable-source result without breaking history or choosing a current substitute.
- `SerializedContent` is a private validated wire envelope with a kind/version discriminator and JSON-compatible payload, not a runtime class. Codec dispatch checks the discriminator, applies supported owner-specific migrations and validates the resulting record. Unknown input is confined to this boundary.
- The common header and codec protocol contain no imports from Book, Author or Editorial. Each module contributes keyed schema/codec entries to the composition root; derived unions and exhaustive checks retain kind/payload/ID correlation.
- Serialization preserves identity and semantics. Revision remains distinct from schema version; changing a card does not require a storage-schema migration. Canonical domain reducers determine new revisions, not mutable class properties or arbitrary caller-supplied values.
- Encode records and typed references only. Hydrate through validated codecs, then inject repositories and services into new instances. Do not use `JSON.stringify(instance)`, prototype-name dispatch or persist an injected collaborator. LaTeX/source bytes and asset bytes remain in their appropriate exact-storage adapters.
- Shared codec shape does not grant generic mutation. Only Book commands can change accepted book content; only genuine author events confirm rules/answers; Editorial owns its session records. Unsupported versions and invalid new records fail explicitly instead of silently manufacturing defaults.

## Author contract

```ts
type IntentScope =
  | { kind: "global" }
  | { kind: "book"; bookId: BookId }
  | { kind: "chapter"; bookId: BookId; chapterId: EntityId }
  | { kind: "task"; sessionId: SessionId };

interface DeclaredRule {
  readonly id: EntityId;
  readonly text: string;
  readonly scope: IntentScope;
  readonly authorEventId: EventId;
  readonly supersedes: EntityId | null;
}

interface ScopedException {
  readonly id: EntityId;
  readonly ruleIds: readonly EntityId[];
  readonly replacement: string;
  readonly scope: IntentScope;
  readonly authorEventId: EventId;
}

interface StyleObservation {
  readonly id: EntityId;
  readonly dimension: string;
  readonly hypothesis: string;
  readonly evidence: readonly Evidence[];
  readonly confidence: "tentative" | "supported";
}

type ResolvedAuthorContract =
  | {
      kind: "ready";
      revision: Revision;
      rules: readonly DeclaredRule[];
      exceptions: readonly ScopedException[];
      decisions: readonly ConfirmedIntentDecision[];
      observations: readonly StyleObservation[];
    }
  | {
      kind: "conflicted";
      revision: Revision;
      ruleIds: readonly EntityId[];
      decisionIds: readonly EntityId[];
      question: string;
    };

function resolveAuthorContract(input: AuthorContractInput): ResolvedAuthorContract {
  // Select applicable declarations; apply only explicit scoped supersession;
  // retain the original author wording; surface material unresolved conflicts.
  throw new Error("not implemented");
}

interface AuthorSdk {
  resolve(input: AuthorContractInput): Promise<ResolvedAuthorContract>;
  propose(input: ProposeAuthorContract): Promise<AuthorProposalReceipt>;
  confirm(input: ConfirmAuthorContract): Promise<AuthorContractReceipt>;
}

interface ConfirmedDecisionReadPort {
  readApplicable(input: AuthorContractScope): Promise<ConfirmedDecisionSnapshot>;
}
```

- Model-facing tools can propose new rules or exceptions. The trusted author event boundary alone confirms them. Inference cannot mint `authorEventId` provenance.
- The global Settings store remains the owner of global explicit fields until its mutation port is migrated; the Author module resolves them without storing a competing copy. Book-scoped declarations live with book metadata; inference observations are separate derived records.
- A stable local AuthorProfile ID is allocated explicitly and linked from book-owned metadata. It is independent of the printed `NovelMetadata.author` byline and does not imply authentication. Multiple project-scoped AuthorProfile instances use the same global declaration repository; changing a byline does not create a profile or discard preferences.
- Book-scoped declaration writes share the existing metadata document owner/transaction port; AuthorProfile must not become a second writer of `.aproprose/meta.json`. A declaration repository supplies policy reads and revision validation without requiring a Book-to-AuthorProfile callback.
- `ConfirmedDecisionReadPort` is a narrowed projection of the existing Editorial repository, created before the instances. Its snapshot includes scope revision, exact confirmed intention decisions, trusted author provenance and supersession. Resolution and the contract gate use the same pure applicability resolver over declarations/exceptions and these decisions; they do not copy them into AuthorProfile or depend on Editorial's runtime instance. Ordinary answers and speculative discussion are not automatically governing intent.
- The contract stamp includes applicable decision-scope revisions, not just IDs already read. Recompute the scope stamp before application so new relevant decisions, corrections and supersessions invalidate affected work. Editorial's persisted decision events also mark dependent workspaces stale; the gate remains authoritative if that notification is delayed.
- Freeze contract revision and raw rule text for the turn. A model-generated condensed brief is supplementary context and cannot replace the governing declarations.
- Declared intentions govern interventions, not manuscript fact extraction: conflicting evidence must remain available to the editor.

## Typed book edits and workspaces

```ts
type EntityReference =
  | { kind: "existing"; source: SourceRef }
  | { kind: "created"; localId: EntityId };

type Position =
  | { kind: "first" }
  | { kind: "after"; item: EntityReference };

// Representative expanded schema variants. The owning schema catalog defines
// the complete command set from the main plan's domain matrix exactly once.
type BookCommand =
  | { kind: "set-metadata"; target: SourceRef; value: NovelMetadata }
  | { kind: "set-book-spine"; target: SourceRef; value: Outline }
  | { kind: "create-chapter"; localId: EntityId; title: string; position: Position }
  | { kind: "rename-chapter"; target: SourceRef; title: string }
  | { kind: "reorder-chapters"; target: SourceRef; chapters: readonly EntityReference[] }
  | { kind: "remove-chapter"; target: SourceRef }
  | { kind: "set-chapter-status"; target: SourceRef; value: ChapterStatus }
  | { kind: "set-chapter-plan"; target: SourceRef; value: ChapterPlanValue }
  | { kind: "insert-block"; chapter: EntityReference; localId: EntityId; position: Position; value: BlockValue }
  | { kind: "replace-block"; target: SourceRef; value: BlockValue }
  | { kind: "move-block"; target: SourceRef; chapter: EntityReference; position: Position }
  | { kind: "remove-block"; target: SourceRef }
  | { kind: "create-card"; chapter: EntityReference; localId: EntityId; position: Position; value: CardValue }
  | { kind: "replace-card"; target: SourceRef; value: CardValue }
  | { kind: "move-card"; target: SourceRef; chapter: EntityReference; position: Position }
  | { kind: "remove-card"; target: SourceRef }
  | { kind: "create-character"; localId: EntityId; value: CharacterValue }
  | { kind: "replace-character"; target: SourceRef; value: CharacterValue }
  | { kind: "remove-character"; target: SourceRef }
  | { kind: "create-lore"; localId: EntityId; value: LoreValue }
  | { kind: "replace-lore"; target: SourceRef; value: LoreValue }
  | { kind: "remove-lore"; target: SourceRef }
  | { kind: "replace-source-range"; target: LiteralSourceRef; range: TextRange; expectedText: string; replacement: string }
  | { kind: "replace-asset"; target: SourceRef; suppliedAssetId: EntityId };

interface ChangeGroup {
  readonly id: ChangeGroupId;
  readonly commands: readonly BookCommand[];
  readonly reason: string;
  readonly issueIds: readonly EntityId[];
  readonly evidence: readonly Evidence[];
  readonly requires: readonly ChangeGroupId[];
}

interface WorkspaceView {
  readonly id: WorkspaceId;
  readonly bookId: BookId;
  readonly revision: Revision;
  readonly contractRevision: Revision;
  readonly readSet: readonly SourceRef[];
  readonly groups: readonly ChangeGroup[];
  readonly conflicts: readonly WorkspaceConflict[];
}

interface BookSdk {
  readView(input: OpenReadView): Promise<BookReadView>;
  editDraft(input: AuthorDraftEdit): Promise<WorkingApplyReceipt>;
  stage(input: StageWorkspaceGroups): Promise<WorkspaceReceipt>;
  review(input: ReviewWorkspace): Promise<WorkspaceView>;
  applyWorkspace(input: ApplyWorkspace): Promise<WorkingApplyReceipt>;
  save(input: SaveBookDraft): Promise<SourceSaveReceipt>;
  undo(input: UndoWorkingChanges): Promise<WorkingApplyReceipt>;
  subscribe(input: BookSubscription): () => void;
}

function reduceBook(input: BookReductionInput): BookReduction {
  // Construct a new graph; validate references, positions, exact source and
  // operation scope; derive dependencies, changed resources and inverse edits.
  throw new Error("not implemented");
}

async function applyWorkspace(input: ApplyWorkspace): Promise<WorkingApplyReceipt> {
  // Validate workspace revision and dependency-closed selection against one
  // live read view, including sources cited from other chapters and contract.
  // Persist recoverable author drafts and inverse edits before publishing state.
  throw new Error("not implemented");
}
```

- Reuse `NovelMetadata`, `Outline` and `ChapterStatus` from the existing domain while migrating. `ChapterPlanValue`, `CardValue`, `CharacterValue` and `LoreValue` contain all the current authored fields and typed links, with authority-owned IDs excluded. Do not reduce cards to title/intention only.
- Split/merge chapter/block and character-merge tool handlers generate coherent groups of these primitive semantic commands, preserving identity lineage and reference repairs. They are substantive operations, not a second mutation engine.
- Full-value replacements require the exact entity revision and preserve fields not being changed. User-facing revise tools can accept schema-derived typed patches and materialize the complete value inside the domain owner. There is no generic JSON-path patch operation.
- Policy/intent changes are explicit Author proposal/confirmation commands. Issue events belong to Editorial; derived observations belong to the Book knowledge owner. They are not smuggled into manuscript replacement commands.
- Command input/output schemas are authoritative. Derive tool input types, command variants, summaries, persistence projections and coverage fixtures from those definitions; the expanded union above is explanatory, not a second hand-maintained schema.
- Dependencies come from validated entity references and source effects, not only the model's `requires` list. Raw-range replacements cannot overlap semantic edits on the same source; reparse and integrity validation occur before application.
- An author edit to a workspace item increments the workspace revision. Subsequent agent edits must name that new revision or fail with a workspace conflict. A live-book edit marks overlapping workspace changes stale.

## Receipts and persistence boundary

```ts
interface WorkspaceReceipt {
  readonly workspaceId: WorkspaceId;
  readonly workspaceRevision: Revision;
  readonly persistedEventId: EventId;
}

interface WorkingApplyReceipt {
  readonly bookId: BookId;
  readonly workingRevision: Revision;
  readonly recoveryRecordId: EntityId;
  readonly inverseChangeId: EntityId;
  readonly affectedSources: readonly SourceRef[];
}

interface SourceSaveReceipt {
  readonly bookId: BookId;
  readonly savedRevision: Revision;
  readonly commitId: EntityId;
  readonly affectedSources: readonly SourceRef[];
}

interface BookPersistencePort {
  recover(input: RecoverBook): Promise<RecoveredBook>;
  persistDraft(input: PreparedDraftRecord): Promise<WorkingApplyReceipt>;
  commitSources(input: PreparedSourceCommit): Promise<SourceSaveReceipt>;
}

async function commitSources(input: PreparedSourceCommit): Promise<SourceSaveReceipt> {
  // Root-scoped serialization; compare expected file revisions; durably stage
  // journal, preimages and new bytes; replace files; finalize one app receipt.
  // On retry return the prior receipt for the same event and payload digest.
  // Recovery preserves any file matching neither known preimage nor new image.
  throw new Error("not implemented");
}
```

- Workspace persistence stores proposed work. Working application stores recoverable accepted drafts, including inactive chapters. Save updates conventional book files. No receipt substitutes for another.
- Existing metadata edits may retain eager saving when independent. A mixed metadata/manuscript group remains one recoverable working transaction and checkpoints coherently; saving one dependent resource cannot persist dangling references to unsaved new entities.
- App readers do not expose a partially recovered source batch. External tools can observe intermediate file replacements; filesystem-wide atomicity is not claimed.
- Register narrow native commands in `src-tauri/src/lib.rs` backed by `src-tauri/src/book/`. Native validation restricts paths to manifested book resources, verifies expected content, and owns transaction staging. The webview cannot forge a raw file manifest to escape membership checks.
- Expected failures use specific error types such as `SourceRevisionConflict`, `WorkspaceRevisionConflict`, `AuthorContractConflict`, `DependencySelectionError`, `AmbiguousSourceReference` and `BookRecoveryConflict`. Network retries are bounded, logged with structured context, and throw the last error; uncertain writes are retried only with their original event key.

## Persistent interview and editorial API

```ts
interface EditorialIssue {
  readonly id: EntityId;
  readonly category: "prose" | "structure" | "intent" | "continuity" | "character" | "lore";
  readonly claim: string;
  readonly intendedEffect: string;
  readonly severity: "blocking" | "material" | "polish";
  readonly confidence: "hypothesis" | "supported" | "confirmed";
  readonly evidence: readonly Evidence[];
  readonly decisionIds: readonly EntityId[];
  readonly cardRefs: readonly EntityReference[];
  readonly status: "open" | "awaiting-author" | "resolved" | "rejected" | "deferred";
}

interface EditorialQuestion {
  readonly id: QuestionId;
  readonly issueIds: readonly EntityId[];
  readonly text: string;
  readonly whyItMatters: string;
  readonly evidence: readonly Evidence[];
  readonly options: readonly { id: EntityId; label: string; consequence: string }[];
}

type AuthorResponse =
  | { kind: "answer"; text: string }
  | { kind: "choose"; optionId: EntityId; elaboration: string }
  | { kind: "skip"; reason: string }
  | { kind: "reject-premise"; reason: string }
  | { kind: "correct"; text: string };

type TurnOutcome =
  | { kind: "investigating"; runId: EntityId }
  | { kind: "awaiting-author"; question: EditorialQuestion }
  | { kind: "draft-ready"; workspaceId: WorkspaceId }
  | { kind: "complete"; resolvedIssueIds: readonly EntityId[] }
  | { kind: "deferred"; issueIds: readonly EntityId[]; reason: string }
  | { kind: "budget-reached"; continuationId: EntityId; remainingWork: string }
  | { kind: "interrupted"; reason: "stopped" | "project-switch" | "app-exit" }
  | { kind: "failed"; failure: EditorialFailure };

interface EditorialSdk {
  start(input: StartAction): Promise<SessionHandle>;
  respond(input: RespondToQuestion): Promise<SessionHandle>;
  steer(input: AuthorSteering): Promise<SessionHandle>;
  reviseDraft(input: AuthorWorkspaceEdit): Promise<WorkspaceReceipt>;
  resume(input: ResumeSession): Promise<SessionHandle>;
  stop(input: StopSession): Promise<SessionHandle>;
  read(input: ReadSession): Promise<EditorialProjection>;
  search(input: EditorialSearchRequest): Promise<EditorialSearchPage>;
  subscribe(input: EditorialSubscription): () => void;
}

interface EditorialSearchRequest {
  readonly bookId: BookId;
  readonly query: string;
  readonly target: "issues" | "questions" | "answers" | "decisions" | "sessions";
  readonly cursor: EntityId | null;
  readonly limit: number;
}

interface AgentEditorialReadPort {
  search(input: EditorialSearchRequest): Promise<EditorialSearchPage>;
  readSession(input: EditorialSessionRangeRequest): Promise<EditorialSessionPage>;
}

function reduceEditorial(input: EditorialReductionInput): EditorialState {
  // Questions arise from issue/evidence events. Only real author events answer
  // them. Preserve rejected/deferred decisions, invalidate dependent groups on
  // correction, and require new evidence or explicit reopening to ask again.
  throw new Error("not implemented");
}

async function respond(input: RespondToQuestion): Promise<SessionHandle> {
  // Verify session/question revision and trusted user provenance; deduplicate
  // event; persist answer and resulting decision before dispatching the next run.
  throw new Error("not implemented");
}
```

- `steer` supports normal conversation without a pending question, corrections to earlier decisions, and changes to task focus. It is not a model tool for fabricating user instructions.
- Answers, decisions, workspace references and coverage are authoritative structured state. Transcript summaries are disposable projections for context continuity.
- Cross-session retrieval stays in Editorial. Search returns bounded identity/provenance previews; exact session-range reads return relevant issue/question/answer/decision records and transcript excerpts. Both validate book membership and revisioned cursors. Agents receive this read port alongside Book reads, without a Book-to-Editorial dependency.
- `start` uses both event idempotency and the scoped session's active/start state: repeated clicks with fresh event IDs still focus/resume an existing run rather than create duplicate investigations.
- `SessionHandle` contains identity and current projection/subscription information; it does not expose the SDK agent, stores or transport objects.
- Session identity includes book, specialist and target scope. Short-action turns retain their specific contract; workspace follow-ups never replace the original agent with a generic proposal persona. Migrated shared project transcripts keep their original mode metadata and remain retrievable without manufacturing new author decisions.

## Action definitions and shared runtime

```ts
// Internal agent module only. Actual action schemas form one keyed registry;
// derive StartAction, action IDs and output types from it.
interface SpecialistContract<Input, Output> {
  readonly id: string;
  readonly version: string;
  readonly mission: string;
  readonly input: DomainParser<Input>;
  readonly output: DomainParser<Output>;
  readonly capabilities: readonly CapabilityId[];
  readonly evidenceRequirement: EvidenceRequirement;
}

interface FrozenAgentRun<Input> {
  readonly runId: EntityId;
  readonly sessionId: SessionId;
  readonly input: Input;
  readonly contract: ResolvedAuthorContract;
  readonly readView: BookReadView;
  readonly workspace: WorkspaceView;
  readonly modelSelection: FrozenModelSelection;
  readonly budget: RunBudget;
}

interface AgentExecutionPort {
  execute<Input, Output>(input: {
    contract: SpecialistContract<Input, Output>;
    run: FrozenAgentRun<Input>;
    instructions: CompiledInstructions;
    seed: SeedContext;
    tools: BoundAgentTools;
    signal: AbortSignal;
    emit: (event: AgentEvent) => Promise<void>;
  }): Promise<AgentExecutionResult<Output>>;
}

function chapterPlannerContract(): SpecialistContract<PlanChapterInput, PlannerAssessment> {
  // Seed with author contract, manifest and mandatory complete target coverage.
  // Mission, question criteria, tools and output schema are specific to planning.
  // Cross-book retrieval remains an agent decision based on the current issue.
  throw new Error("not implemented");
}

function writerContract(): SpecialistContract<WriteInput, WriterAssessment> {
  // Bind intended effect, generation boundaries, voice evidence and self-audit.
  throw new Error("not implemented");
}

function literaryEditorContract(): SpecialistContract<EditInput, EditorAssessment> {
  // Bind rigorous developmental/line diagnosis and source-evidenced revision.
  throw new Error("not implemented");
}

async function executeAgent<Input, Output>(input: AgentExecutionInput<Input, Output>): Promise<TurnOutcome> {
  // This is BaseAgent.run's one execution implementation, not another UI API.
  // Prepare specialist seed; compile author + specialist + typed task instructions;
  // bind actual instance ports to frozen authority; invoke AgentExecutionPort.
  // Assess the parsed result using the originating specialist and emit a typed
  // outcome through Editorial's event port. Do not persist sessions directly.
  throw new Error("not implemented");
}
```

- `DomainParser` is the internal boundary-parser interface; it does not expose Zod to UI callers. Runtime schema definitions remain the authoritative source of domain types.
- Every button has its own keyed specialist definition from the main plan. This generic execution port unifies lifecycle, not behavior. It does not switch over action names to reconstruct prompts or tool policy.
- The external SDK adapter constructs ToolLoopAgent, converts streams/tool descriptors and observes the supplied budget/cancellation policy. BaseAgent owns instruction compilation, instance binding and specialist assessment; Editorial owns durable events/session transitions. None of these responsibilities has a second implementation.
- Shared tool layers are composed from the same operation catalog. Each tool binds revisions, idempotency and domain scope; a model cannot widen its authority by asking for another tool group.
- The runtime may expose additional groups on demand; `prepareStep` does not route the agent through a mandatory sequence of read/diagnose/edit stages. The specialist chooses its next tool within its action contract.
- Step/token/time budgets are explicit host policy, not editorial completion criteria. Reaching one yields durable unfinished work. A bounded continuation resumes it without losing questions or cards. No self-spawning unbounded continuation loop is proposed.
- Source-map workers and read-only specialist consultations inherit the frozen contract, evidence handles, cancellation and parent budget. Their exact results are available to the parent; the parent retains sole editorial/workspace authority.

## Concrete classes and composition root

```ts
// Construction contracts. The SDK interfaces above specify full public APIs.
interface BookDependencies {
  readonly bookId: BookId;
  readonly repository: BookRepository;
  readonly source: BookSourceAdapter;
  readonly persistence: BookPersistencePort;
  readonly contractGate: AuthorContractGate;
  readonly identities: CreationIdentityPort;
}

interface AuthorDependencies {
  readonly profileId: AuthorProfileId;
  readonly declarations: AuthorDeclarationRepository;
  readonly decisions: ConfirmedDecisionReadPort;
  readonly observations: StyleObservationRepository;
}

interface EditorialDependencies {
  readonly book: BookSdk;
  readonly author: AuthorSdk;
  readonly repository: EditorialRepository;
  readonly agents: AgentFactoryPort;
  readonly events: EditorialEventPublisher;
}

// Internal composition-root excerpt after records/graph/repositories hydrate.
const contractGate = createAuthorContractGate({
  declarations: ports.declarations,
  decisions: ports.confirmedDecisions,
});
const author = new AuthorProfile({
  profileId: records.author.header.id,
  declarations: ports.declarations,
  decisions: ports.confirmedDecisions,
  observations: ports.observations,
});
const book = new Book({
  bookId: records.book.header.id,
  repository: ports.bookRepository,
  source: ports.source,
  persistence: ports.bookPersistence,
  contractGate,
  identities: ports.identities,
});
const agents = new AgentFactory({
  execution: ports.inference,
  tools: toolCatalog,
  specialists: specialistRegistry,
});
const editorial = new Editorial({
  book,
  author,
  repository: ports.editorialRepository,
  agents,
  events: ports.editorialEvents,
});
```

- Book, AuthorProfile and Editorial are concrete classes implementing the SDK contracts above. Their constructor inputs are explicit typed dependencies. They do not inherit from each other; their immutable content values compose the same base record types.
- `AuthorSdk` exposes `resolve`, `propose` and trusted `confirm`. Book's injected `AuthorContractGate` validates a policy stamp through the shared declaration and confirmed-decision read ports, without calling back through AuthorProfile or Editorial. Both ports are constructed first; declaration writes use the single physical document owner for book metadata changes.
- Repositories/working-state owners hold authoritative records. Class instances coordinate queries and validated transitions through those owners; they do not maintain competing copies of settings, metadata or sessions. Pure reducers remain the domain transformation logic.
- The agent factory receives no Editorial in its constructor. Editorial passes its narrowed read/event ports with each invocation after all objects exist. This is constructor injection for long-lived collaborators and explicit invocation values for book/session/revision/cancellation state.
- The composition root alone selects native/browser/test adapters and contributes codecs to the shared registry. No service locator, DI dependency, module singleton or constructor-name revival is introduced.

## Actual instance-bound catalog

```ts
interface BookAgentPort {
  readView(input: OpenReadView): Promise<BookReadView>;
  stage(input: StageWorkspaceGroups): Promise<WorkspaceReceipt>;
}

interface AuthorAgentPort {
  resolve(input: AuthorContractInput): Promise<ResolvedAuthorContract>;
  propose(input: ProposeAuthorContract): Promise<AuthorProposalReceipt>;
}

interface EditorialAgentPort extends AgentEditorialReadPort {
  recordIssues(input: RecordIssues): Promise<EditorialReceipt>;
  askAuthor(input: AskAuthorQuestion): Promise<EditorialReceipt>;
}

interface BoundToolDependencies {
  readonly book: BookAgentPort;
  readonly author: AuthorAgentPort;
  readonly editorial: EditorialAgentPort;
  readonly run: RunAuthority;
}

class ToolCatalog {
  bind(input: BoundToolDependencies): BoundAgentTools {
    // Generate closures from the authoritative typed descriptor registry.
    // Each closure invokes these same instances with host-bound run authority.
    // Freeze reads to the selected view; validate live revisions for mutations.
    throw new Error("not implemented");
  }
}

// Internal run-launch excerpt. Narrowing retains the same object instances.
const bookPort: BookAgentPort = book;
const authorPort: AuthorAgentPort = author;
const editorialPort: EditorialAgentPort = editorial;
const tools = toolCatalog.bind({
  book: bookPort,
  author: authorPort,
  editorial: editorialPort,
  run: runAuthority,
});
```

- Bound descriptors implement semantic operations, not reflected class-method access. The SDK adapter only converts them into SDK tools. `read_chapter_range` calls the bound Book's revision-pinned read view; `create_cards` stages validated commands through that same Book; `ask_author` records a question through the bound Editorial.
- Model-visible inputs omit trusted book/session identity, authority tokens and author-event provenance when the host already binds them. The schemas expose neither source Save nor trusted answer/confirmation operations. Runtime owner validation still applies even if a descriptor is called incorrectly.
- Run authority contains host-owned run/session/workspace IDs, application generation, frozen working/contract revisions, capabilities and invocation identity. An authority registry validates it after asynchronous work and before transition publication. Project disposal revokes the generation; delayed calls fail with `RunAuthorityRevoked` rather than touching a reopened project.
- Immutable read views remain pinned until an explicit refresh/re-grounding event. Workspace revisions advance on successful persisted edits; expected-revision checks reject stale concurrent writes. No descriptor reads a mutable service-wide current-book field or imports a store.

## Shared Agent base and specialist classes

```ts
abstract class BaseAgent<Input, Output> {
  constructor(private readonly dependencies: AgentDependencies) {}

  protected abstract readonly contract: SpecialistContract<Input, Output>;
  protected abstract seed(input: AgentSeedInput<Input>): Promise<SeedContext>;
  protected abstract assess(input: AgentAssessmentInput<Output>): ContractAssessment;

  async run(input: AgentInvocation<Input>): Promise<TurnOutcome> {
    // One shared executeAgent implementation above; dependencies are immutable.
    // Editorial already created/resumed the session and froze author authority.
    // Run-local context carries tool ports, budget, model, signal and emitter.
    // The base invokes the purpose seed/assessment, not a mandatory phase script.
    throw new Error("not implemented");
  }
}

class ChapterPlannerAgent extends BaseAgent<PlanChapterInput, PlannerAssessment> {
  protected readonly contract = chapterPlannerContract();

  protected seed(input: AgentSeedInput<PlanChapterInput>): Promise<SeedContext> {
    return seedPlannerTarget(input);
  }

  protected assess(input: AgentAssessmentInput<PlannerAssessment>): ContractAssessment {
    return assessPlannerInterview(input);
  }
}

class WriterAgent extends BaseAgent<WriteInput, WriterAssessment> {
  protected readonly contract = writerContract();

  protected seed(input: AgentSeedInput<WriteInput>): Promise<SeedContext> {
    return seedWriterVoiceAndBoundaries(input);
  }

  protected assess(input: AgentAssessmentInput<WriterAssessment>): ContractAssessment {
    return assessWriterEffectAndFidelity(input);
  }
}

class LiteraryEditorAgent extends BaseAgent<EditInput, EditorAssessment> {
  protected readonly contract = literaryEditorContract();

  protected seed(input: AgentSeedInput<EditInput>): Promise<SeedContext> {
    return seedEditorGoalAndEvidence(input);
  }

  protected assess(input: AgentAssessmentInput<EditorAssessment>): ContractAssessment {
    return assessEditorialDiagnosis(input);
  }
}
```

- Planner seeds complete target coverage and relevant prior decisions, then assesses discrepancy evidence, question value and linked cards/sections. Writer seeds intended effect, voice examples and generation boundaries, then assesses voice/fact fidelity and the resulting passage. Editor seeds revision goals and evidence, then assesses causal diagnosis, confidence, severity and intervention quality.
- These helper functions are proposed composed specialist policies, not existing APIs. Seed IO uses injected read ports; assessments and value transformations remain pure. The subclasses package those real differences; they do not own duplicated lifecycle or source writes.
- BaseAgent owns shared instruction compilation, binding, cancellation and result assessment delivery. Editorial remains the owner of start idempotency, questions, genuine answers, decisions and persistence; Book remains the mutation owner. Subclass hooks cannot override these responsibilities or author precedence.
- The action registry contains the typed input/output/prompt contract and factory for each action. Small actions without unique execution behavior use a configured concrete implementation of the same base, with their own seed/evaluator. Both construction forms flow through the same factory, catalog and BaseAgent.run; callers have one execution API.
- Shared dependencies are immutable. Controllers, run authority, view/workspace references, budgets and stream emitters are per-invocation values. Agent objects are not ContentRecords and do not serialize; durable continuation stores action/contract versions and editorial state, then reconstructs a fresh runtime instance.

## Boundary and registry checks

- A build-gated architecture check rejects UI imports from private Book/Author/Editorial/Agent modules, direct source writes outside Book adapters, SDK inference outside Agent adapters, and duplicate legacy writers after each migration slice.
- Tool registry exhaustiveness derives from command/entity schemas. Every book field must have complete read/search/edit/review/persistence coverage. Every action must have input/output schemas, author-contract applicability, prompt version and behavioral fixtures.
- Session persistence has one current writer and explicit readers/migrations for supported historic versions. Restore IDs, attachments, proposal outcomes and candidate decisions; never infer author acceptance from an assistant sentence.
- Composition-root integration tests construct real domain instances, bind descriptors and verify tool/manual changes appear in the same subscribed state. Codec fixtures cover all registered kinds, typed reference graphs, supported migrations, invalid input and untouched LaTeX/source fidelity. Delayed operations after disposal must fail authority validation.
- Test the actual external SDK adapter against the pinned SDK types during implementation. These Markdown sketches have not been compiled and do not claim completed implementation validation.
