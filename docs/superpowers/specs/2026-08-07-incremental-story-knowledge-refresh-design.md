# Incremental Story Knowledge Refresh

## Summary

aproprose will maintain a compact, living representation of the manuscript after successful chapter saves. A background refresh pipeline will analyze saved prose in block-aligned chunks, persist chapter-level knowledge, and use that knowledge to update the global logline, story overview, and structured character profiles. The initial run indexes every chapter. Later runs process only chapters whose semantic fingerprints changed.

The refresh pipeline will never block or roll back manuscript saving. Derived metadata updates apply automatically. Potential new characters require author approval before the app creates a character record.

Each existing character will also gain a dedicated detail surface with manual fields and a persistent Describe with AI conversation. Describe exchanges may update only the selected character and apply useful profile changes immediately.

## Goals

- Keep the logline and story overview aligned with material manuscript changes.
- Build detailed character knowledge without repeatedly sending the full raw book to the model.
- Capture supported details about appearance, mannerisms, motivations, relationships, history, and voice.
- Use existing dialogue speaker IDs, outline cast assignments, names, and prior character knowledge to associate prose with known characters.
- Make later writing and editing conversations more consistent by grounding the agent on detailed character profiles.
- Process the first book index and later updates in bounded chunks.
- Preserve manuscript save reliability when AI configuration, network access, or model output fails.
- Ask before creating a newly discovered character.
- Let authors riff conversationally about one character and see profile updates during the conversation.

## Non-goals

- Automatically creating characters without author approval.
- Automatically rewriting lore entries, outline cards, or chapter spine fields.
- Rescanning every raw chapter after every save.
- Sharing knowledge between projects.
- Treating inferred details as manuscript facts when the source does not support them.
- Adding a general-purpose project indexing system in this iteration.

## Chosen approach

The implementation will use an incremental map and reduce pipeline.

1. Map changed manuscript chunks into structured observations.
2. Reduce chunk observations into one persisted knowledge record per chapter.
3. Reduce story signals across all chapter records into the logline and overview.
4. Reduce observations only for affected known characters into profile patches.
5. Group unknown-character evidence into approval candidates.

This approach was selected over two alternatives:

- A full-book rescan after every save has a simpler state model but repeats expensive work, increases latency, and creates avoidable output churn.
- An autonomous retrieval agent can decide which chapters to read, but indexing becomes nondeterministic, difficult to resume, and easier to make incomplete.

## Domain model

### Character profiles

The existing `Character` type keeps `id`, `name`, `color`, and `role`, and gains a required profile:

```ts
interface CharacterProfile {
  appearance: string;
  mannerisms: string;
  motivations: string;
  relationships: string;
  history: string;
  voice: string;
}

interface Character {
  id: string;
  name: string;
  color: string;
  role: string;
  profile: CharacterProfile;
}
```

All profile fields are plain editable text. Empty fields use empty strings in storage and a hyphen only when rendered as an empty read-only value.

### Persisted story knowledge

`ProjectMeta` gains a required `knowledge` object. This state is project data and belongs in `.aproprose/meta.json`.

```ts
interface EvidenceLocator {
  chapterId: string;
  sourceId: string;
  order: number;
  fingerprint: string;
}

type CharacterProfileField = keyof CharacterProfile;

interface CharacterObservation {
  id: string;
  characterId: string;
  field: CharacterProfileField;
  detail: string;
  evidence: EvidenceLocator[];
}

interface UnknownCharacterObservation {
  id: string;
  name: string;
  role: string;
  details: Partial<CharacterProfile>;
  evidence: EvidenceLocator[];
}

interface ChapterKnowledge {
  sourceFingerprint: string;
  summary: string;
  premiseSignals: string[];
  conflictSignals: string[];
  stakeSignals: string[];
  arcSignals: string[];
  endingSignals: string[];
  characterObservations: CharacterObservation[];
  unknownCharacterObservations: UnknownCharacterObservation[];
}

interface CharacterCandidate {
  id: string;
  evidenceFingerprint: string;
  name: string;
  role: string;
  profile: CharacterProfile;
  evidence: EvidenceLocator[];
}

interface ProjectKnowledge {
  chapters: Record<string, ChapterKnowledge>;
  characterCandidates: CharacterCandidate[];
  dismissedCandidateFingerprints: string[];
  appliedCharacterObservationIds: Record<string, string[]>;
}
```

Evidence uses the existing source-locator pattern rather than trusting a parsed block ID alone. The ID supports exact matches during the current session, while order and content fingerprint allow later resolution after blocks are reparsed.

The knowledge store does not persist runtime status, active promises, abort controllers, or queued jobs.

### Migration

A new metadata migration will:

- Add an empty six-field profile to every existing character.
- Add empty project knowledge.
- Preserve every existing metadata field.
- Bump the current metadata version.

The boundary schema will validate all new fields and supply empty values for older blobs. New fields will be required after migration so call sites can trust the type system.

## Refresh runtime

A dedicated Zustand store will own ephemeral refresh coordination. It will remain separate from `project-store` so the project store does not absorb model orchestration and job lifecycle concerns.

The runtime state will expose:

- Status: `idle`, `refreshing`, or `failed`.
- The current project root and active chapter, if any.
- Progress as completed chapters over total chapters.
- The latest actionable error.
- `enqueueSavedChapter`, `retry`, and `cancel` operations.

Only one refresh run may execute at a time. If another successful save occurs during a run, the store retains the latest fingerprint for that chapter. After the active run settles, one follow-up run processes the newest pending fingerprints. Repeated saves do not create an unbounded queue.

Opening or closing a project aborts active work. Every model boundary and final commit verifies the frozen project root. Results from a project that is no longer active are discarded.

The outline derives coverage separately from runtime status. An idle project with missing chapter knowledge is `Not refreshed`, while an idle project whose chapter fingerprints all match persisted knowledge is `Up to date`.

## Save integration

`saveChapter` remains responsible for writing manuscript source and restoring clean parsed blocks. After `writeTextFile` succeeds and the store adopts the reparsed blocks, it calls `enqueueSavedChapter` with:

- Project root.
- Chapter ID.
- The semantic block fingerprint of the persisted source.

The refresh call is fire-and-forget. Its failure cannot change `saving`, `chapterDirty`, `saveError`, compile state, or the source on disk.

The refresh service reads the chapter source from disk before analysis. This makes the persisted manuscript the source of truth and avoids analyzing an in-memory state that did not save.

On the first refresh, every chapter without matching persisted knowledge is selected. On later refreshes, a chapter is selected only when its current semantic fingerprint differs from `ChapterKnowledge.sourceFingerprint`. Deleted chapter records are removed before whole-book reduction.

## Chunking

The service parses each selected chapter and filters to authored scene content:

- Narration blocks.
- Dialogue blocks, including speaker IDs and dialogue tails.
- Chapter scene labels.

Lore, scratchpad, raw LaTeX, and scene-break blocks are excluded from automatic manuscript inference.

Chunks are built in source order and capped by a fixed character budget. Blocks are never split. A single block larger than the cap becomes one oversized chunk. There is no overlap, so each eligible block is analyzed exactly once. The chapter reducer combines observations across chunk boundaries.

Each rendered block includes its source locator, type, text, and known dialogue speaker. Each chunk also receives:

- Chapter title and outline spine.
- Chapter and card cast assignments.
- A compact roster of all known character IDs, names, and roles.
- Full current profiles only for characters explicitly associated with the chapter, assigned as a speaker, or named in the chunk.
- The current story overview.

The chunk budget will be a named constant with unit tests. It is independent of a specific model tokenizer and leaves ample room for instructions and structured output.

## AI map output

Chunk analysis uses the configured provider and selected model through the existing Vercel AI SDK integration. No API key or raw provider request moves into the frontend source.

The map prompt requires the model to:

- Report only details supported by supplied prose.
- Associate known characters by exact supplied ID.
- Use dialogue speaker identity and outline cast assignments as strong context.
- Avoid turning temporary emotion or one-time behavior into a permanent trait without textual support.
- Produce concise story signals rather than a chapter recap.
- Return unknown people separately instead of inventing IDs.
- Attach one or more exact evidence locators to every observation.

The output is a Zod-validated object. The application rejects:

- Unknown known-character IDs.
- Invalid profile field names.
- Evidence outside the offered chunk.
- Blank observation details.
- Unknown-character observations without a name or evidence.

Invalid individual observations are removed. A structurally invalid response fails that chapter refresh explicitly.

## Chapter reduction

All valid map outputs for one chapter are reduced into one `ChapterKnowledge` record. The reducer deduplicates observations using normalized character ID, field, detail, and evidence fingerprint. It may consolidate synonymous observations but must retain evidence.

The complete replacement record is committed only after every chunk and the chapter reducer succeed. A failed chapter stays missing or retains its previous fingerprint, so retry identifies it as unfinished. Completed unchanged chapters are not reprocessed.

## Whole-book reduction

After selected chapter records are ready, reduction occurs in three bounded stages.

### Story reducer

The story reducer receives all chapter summaries and story signals in chapter order, plus the current logline and overview. It returns a complete logline and overview.

The prompt treats current author text as authoritative context, changes it only for material story evidence, keeps the overview under the existing 2,000-character limit, and avoids a chapter-by-chapter recap. Empty replacements are invalid when the current value is nonempty.

### Character reducers

Only characters referenced by new or changed chapter observations are reduced. The initial index reduces every observed existing character.

Automatic character output is a patch, not an unconstrained record replacement:

```ts
interface CharacterFieldAddition {
  field: CharacterProfileField;
  text: string;
  evidenceIds: string[];
}

interface CharacterFieldCorrection {
  field: CharacterProfileField;
  replaceExact: string;
  replacement: string;
  evidenceIds: string[];
}
```

Additions extend the current field without deleting existing text. Exact corrections apply only when `replaceExact` still exists in the live field. Blank output cannot erase a field. Previously applied evidence is not appended twice. This deterministic patch shape preserves manual refinements while still allowing supported corrections.

Applied patches record their deterministic observation IDs in `appliedCharacterObservationIds`. Later reducers omit those observations from new additions while retaining them as background context. Character jobs may be batched to fit the configured model context. Each character result is validated independently, and valid results are staged for the next atomic metadata commit.

### Candidate reducer

Unknown-character observations are grouped by normalized name and overlapping evidence. The reducer creates a candidate with a role, structured profile, and combined evidence. A candidate requires a nonempty proper name plus either evidence from two distinct blocks or at least two nonempty profile fields supported by one block. This excludes passing unnamed figures while allowing one concentrated character introduction.

The candidate evidence fingerprint is stable for the same normalized evidence. A fingerprint found in `dismissedCandidateFingerprints` remains hidden. New materially different evidence produces a different fingerprint and may surface the candidate again.

## Atomic commit and concurrency

The pipeline captures the project root, selected chapter fingerprints, current story fingerprint, and affected character profile fingerprints before reduction.

Before committing, it verifies:

- The same project is active.
- Every analyzed chapter still has the expected saved fingerprint.
- The current story fingerprint still matches the reducer input.
- Each affected profile fingerprint still matches the character reducer input.

Unchanged results commit in one metadata write. If story or profile data changed while reduction was in flight, that stale portion is skipped and a follow-up reduction is queued against current values. New chapter knowledge that still matches its saved source may be retained. This prevents a background completion from overwriting manual edits or a Describe exchange.

Project metadata writes will use one serialized, project-root-scoped persistence queue owned by `project-store`. Existing manual metadata edits, automatic refresh commits, candidate decisions, and Describe updates enqueue complete snapshots in order, so the newest accepted state always writes last. Refresh and Describe operations await their queued write before reporting success. A persistence failure is reported and does not allow refresh status to claim `Up to date`.

## Character detail workflow

Clicking a character in the sidebar opens a right-side character detail sheet, following the existing lore detail pattern. The sidebar row becomes an action rather than inert display text.

The sheet header identifies the character and contains a stock `ButtonGroup` with:

- Manual.
- Describe with AI.

Manual view uses existing input and textarea primitives for name, role, appearance, mannerisms, motivations, relationships, history, and voice. Color editing reuses the existing character color picker. Updates persist through `project-store`.

Describe with AI view embeds the existing `AgentSection` pattern in the sheet. It uses a persistent session ID scoped by project and character ID. Its empty state invites the author to discuss appearance, habits, motives, relationships, background, speech, contradictions, or any other supported or intended detail.

The conversation receives:

- The current complete character record.
- Logline and story overview.
- Stored observations and chapter summaries that reference the character.
- Existing manuscript and outline read tools for deeper retrieval.
- A character update tool restricted to the selected character ID.

The character update tool accepts validated field replacements for that selected profile only. Each successful tool call applies immediately, persists metadata, and returns a concise tool result for the conversation. It cannot change manuscript text, outline data, lore, another character, or create a character.

Describe sessions follow the existing single-active-agent coordination, cancellation, persistence, provider configuration, usage display, and actionable error behavior.

## New-character approval workflow

When pending candidates exist, the outline page displays an unobtrusive action near refresh status. Opening it shows the candidate name, proposed role, generated profile, and evidence previews.

The author can:

- Add the candidate. This creates a normal character with a new local ID and removes the candidate.
- Dismiss the candidate. This records its evidence fingerprint and removes the candidate.

Accept and dismiss are explicit user actions. The background pipeline never opens a modal while the author is typing.

## Outline refresh status

The outline board places a compact status beside the logline and story overview section:

- `Not refreshed` before every current chapter has persisted knowledge.
- `Refreshing` with the shared `Spinner` and chapter progress.
- `Up to date` after a successful run.
- `Refresh failed` with an actionable retry button and error text available through the existing error presentation pattern.
- A candidate count action when new-character suggestions await review.

Loading labels contain no ellipsis. Refresh state is informative and does not disable manual editing.

## Error handling

- Manuscript write failure prevents refresh enqueue because no new saved source exists.
- AI configuration, request, schema, or network failure marks refresh failed and retains all previously committed metadata.
- External model calls use the established provider path and error normalization.
- Retries target chapters whose saved fingerprints do not match persisted knowledge, then rerun affected global reductions.
- A failed chunk does not commit a partial chapter record.
- A failed character reduction does not prevent other independently valid character results from committing.
- Project switching aborts active requests and discards late results.
- Metadata persistence failure raises the existing actionable metadata error instead of reporting a successful refresh.

## Agent grounding changes

Existing writing, editing, critique, continuity, and outline conversations currently receive character name and role. Grounding will include nonempty structured profile sections for relevant characters.

Whole-roster tools return structured profiles, but prompts should expand only relevant profiles into prose context. This keeps normal agent calls compact while allowing the agent to retrieve full details when needed.

## Testing

### Unit tests

- Metadata migration adds complete empty profiles and project knowledge.
- Chunking preserves order and block boundaries and covers each eligible block exactly once.
- Semantic chapter fingerprints ignore reminted block IDs and change for meaningful source changes.
- Queue coalescing retains only the newest fingerprint per chapter.
- Map sanitization rejects invalid IDs, fields, evidence, and blanks.
- Chapter reduction deduplicates observations without losing evidence.
- Character patch application preserves current text, applies exact corrections safely, and never duplicates applied evidence.
- Candidate grouping and evidence fingerprints are deterministic.
- Candidate accept and dismiss transitions update metadata correctly.

### Integration tests with mocked models

- The first successful save indexes all missing chapters.
- A later save analyzes only chapters with changed semantic fingerprints.
- A second save during refresh schedules one follow-up run using the newest source.
- A chunk failure leaves the previous chapter record and marks the chapter unfinished.
- Retry processes only missing or changed chapter work.
- Switching projects aborts the run and prevents a stale commit.
- Manual story or profile edits during reduction are never overwritten.
- Refresh failure leaves the saved manuscript and existing metadata intact.
- Describe conversation updates only its selected character and persists the result.

### Store tests

- `saveChapter` enqueues only after the file write and clean-state adoption succeed.
- Refresh rejection does not alter save or compile state.
- Accepting a candidate creates a profiled character with a new ID.
- Dismissing a candidate suppresses the same evidence fingerprint.

### Component tests

- Character sidebar rows open the correct detail sheet.
- Manual character fields and color changes persist.
- Manual and Describe with AI views switch through a stock `ButtonGroup`.
- Describe view hydrates and stops the character-scoped agent session correctly.
- Refresh progress, success, failure, retry, and candidate count render correctly.
- Candidate evidence can be reviewed, accepted, or dismissed.

### Regression checks

- Existing projects migrate without losing cast, lore, outline, or chapter metadata.
- Existing agent and outline proposal flows remain review-gated.
- Automatic refresh does not create manuscript or outline proposals.
- Typecheck, frontend build, and the complete test suite remain green.

## Delivery boundaries

The implementation should be split into independently verifiable layers:

1. Types, migration, pure fingerprint, chunk, merge, and candidate functions.
2. Refresh model operations and chapter knowledge pipeline.
3. Runtime queue and save integration.
4. Character detail manual UI.
5. Character Describe agent session and restricted update tool.
6. Outline refresh status and candidate approval UI.
7. Expanded grounding, integration tests, and final verification.

No layer should require a new dependency. Existing Zustand, Zod, Vercel AI SDK, Tauri bridge, and shadcn-style primitives cover the design.
