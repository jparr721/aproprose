# Book foundation implementation slice

- Constructor: `new Book({ project, meta, chapter, loadChapter })`. The captured project, metadata and active unsaved chapter form a run-local read view; filesystem reads are injected and lazy.
- Public reads: `readChapter`, `readChapterRecord`, `readOutline`, `readLore`, `manifest`, `metadata`, `readCharacter`, `search`.
- Complete semantic blocks retain dialogue speakers and ordered tails, scene levels, lore titles and canonical citation text. Source storage fields `raw` and `dirty` stay private to existing source adapters.
- Shared ContentRecord headers, typed references and strict versioned codecs wrap actual Book/chapter views. Runtime collaborators are never serialized.
- Existing project-store remains authoritative. This slice introduces no writes, save behavior, alternate project store or metadata migration.
- Root integration replaces controller read projections using this same Book instance. Existing source fingerprints, block snapshot text and chapter outline normalization remain authoritative.

| File set | Responsibility |
|---|---|
| `src/content/record.ts`, `src/content/record.test.ts` | Shared record schema, refs and serialization boundary |
| `src/book/types.ts`, `src/book/projections.ts` | Schema-derived semantic chapter views and pure projection |
| `src/book/book.ts`, `src/book/book.test.ts`, `src/book/index.ts` | Injected Book instance, lazy frozen reads and bounded search |
| `src/lib/ai/agent-types.ts` | ChapterToolValue aliases owning Book view type |

- Acceptance: unsaved chapter wins over filesystem; repeated reads do not reload; returned values cannot mutate captured inputs/cache; failed/unknown chapter reads fail explicitly; full chained dialogue and all block types survive projection and record round trips; search returns exact cited text and explicit inspected coverage.
- Cross-review: specialist P1/P2 write sets are disjoint. P3 changes to agent-types follow this slice. P4 uses canonical Book text rather than introducing another formatter.
- Verification: user authorized local mode. Regression tests are added before implementation; root owns aggregate typecheck/test/browser/build/Rust gate.

## Integrated catalog wave

- Additional assigned files: `src/lib/ai/agent-tools.ts`, `src/lib/ai/agent-tools.test.ts`, and only new catalog types in `src/lib/ai/agent-types.ts`.
- The catalog binds the same injected Book instance and frozen specialist policy. Manifest, exact publication metadata, full character profile, derived story knowledge, bounded chapter ranges and exact book searches are available on demand.
- `ask_author` records one bounded question, its public rationale and optional choices in the existing persisted tool message. It returns no fabricated answer or approval.
- One capability mapping drives both SDK exposure and host execution checks. Read-only analysis cannot stage changes even if a handler is called directly. Cancellation and run ownership are checked before execution and after asynchronous reads.
- Regression evidence: before implementation, `bun run test src/lib/ai/agent-tools.test.ts` failed 5 of 19 tests; the read-only host test returned a staged proposal instead of rejecting it. Missing catalog APIs caused the other four failures.
- Final focused receipt: `bun run test src/lib/ai/agent-tools.test.ts src/book/book.test.ts src/content/record.test.ts` passed 3 files and 28 tests.
- Root owns controller/runtime integration and persisted tool descriptor rendering. Canonical fingerprint/snapshot helper extraction into a lower-level source module is deferred explicitly by root; helpers are reused without a competing formatter.
