import { contentSnapshotRef } from "@/content/record";
import { projectChapter } from "@/book/projections";
import { bookRecordCodec, chapterRecordCodec } from "@/book/types";
import type {
  BookChapterSnapshot,
  BookChapterValue,
  BookDependencies,
  BookManifest,
  BookRecord,
  BookSearchInput,
  BookSearchMatch,
  BookSearchResult,
  ChapterRecord,
} from "@/book/types";
import { cardFingerprint, textFingerprint } from "@/lib/ai/agent-context";
import type { LoreToolValue, OutlineToolValue } from "@/lib/ai/agent-types";
import { getChapterOutline } from "@/lib/outline/model";
import type { Character, ChapterRef, NovelMetadata, ProjectInfo, ProjectKnowledge, ProjectMeta } from "@/lib/types";

export class BookEntityNotFoundError extends Error {
  constructor(kind: "Chapter" | "Character", id: string) {
    super(`${kind} not found: ${id}`);
    this.name = "BookEntityNotFoundError";
  }
}

export class BookSourceIdentityError extends Error {
  constructor(expectedChapterId: string, actualChapterId: string) {
    super(`Chapter source identity mismatch: requested ${expectedChapterId}, received ${actualChapterId}`);
    this.name = "BookSourceIdentityError";
  }
}

export class Book {
  private readonly project: ProjectInfo;
  private readonly meta: ProjectMeta;
  private readonly loadChapter: BookDependencies["loadChapter"];
  private readonly chapters = new Map<string, Promise<ChapterRecord>>();

  constructor(dependencies: BookDependencies) {
    this.project = structuredClone(dependencies.project);
    this.meta = structuredClone(dependencies.meta);
    this.loadChapter = dependencies.loadChapter;
    if (dependencies.chapter !== null) {
      this.requireChapter(dependencies.chapter.chapterId);
      this.chapters.set(dependencies.chapter.chapterId, Promise.resolve(this.chapterRecord(dependencies.chapter)));
    }
  }

  private requireChapter(chapterId: string): ChapterRef {
    const chapter = this.project.chapters.find((entry) => entry.id === chapterId);
    if (chapter === undefined) throw new BookEntityNotFoundError("Chapter", chapterId);
    return chapter;
  }

  private chapterRecord(chapter: BookChapterSnapshot): ChapterRecord {
    const value = projectChapter(chapter);
    return chapterRecordCodec.parse({
      header: {
        owner: { kind: "book", bookId: this.project.root },
        kind: "chapter",
        id: value.chapterId,
        schemaVersion: 1,
        revision: textFingerprint(JSON.stringify(value)),
      },
      value,
    });
  }

  async readChapterRecord(chapterId: string): Promise<ChapterRecord> {
    this.requireChapter(chapterId);
    let loaded = this.chapters.get(chapterId);
    if (loaded === undefined) {
      loaded = this.loadChapter(chapterId).then((chapter) => {
        if (chapter.chapterId !== chapterId) throw new BookSourceIdentityError(chapterId, chapter.chapterId);
        return this.chapterRecord(chapter);
      });
      this.chapters.set(chapterId, loaded);
    }
    let record: ChapterRecord;
    try {
      record = await loaded;
    } catch (error) {
      if (this.chapters.get(chapterId) === loaded) this.chapters.delete(chapterId);
      throw error;
    }
    return structuredClone(record);
  }

  async readChapter(chapterId: string): Promise<BookChapterValue> {
    return (await this.readChapterRecord(chapterId)).value;
  }

  manifest(): BookManifest {
    return {
      name: this.project.name,
      metadata: this.metadata(),
      chapters: this.project.chapters.map((chapter) => ({
        ...chapter,
        status: this.meta.statuses[chapter.id] ?? null,
        cardCount: getChapterOutline(this.meta.chapters, chapter.id).cards.length,
        hasKnowledge: this.meta.knowledge.chapters[chapter.id] !== undefined,
      })),
      characterIds: this.meta.characters.map((character) => character.id),
      loreIds: this.meta.lore.map((entry) => entry.id),
    };
  }

  record(): BookRecord {
    const value = this.manifest();
    return bookRecordCodec.parse({
      header: {
        owner: { kind: "book", bookId: this.project.root },
        kind: "book",
        id: this.project.root,
        schemaVersion: 1,
        revision: textFingerprint(JSON.stringify(value)),
      },
      value,
    });
  }

  metadata(): NovelMetadata {
    return structuredClone(this.project.metadata);
  }

  knowledge(): ProjectKnowledge {
    return structuredClone(this.meta.knowledge);
  }

  readCharacter(characterId: string): Character {
    const character = this.meta.characters.find((entry) => entry.id === characterId);
    if (character === undefined) throw new BookEntityNotFoundError("Character", characterId);
    return structuredClone(character);
  }

  readOutline(chapterId: string | null): OutlineToolValue {
    const chapters = chapterId === null ? this.project.chapters : [this.requireChapter(chapterId)];
    return {
      premise: this.meta.outline.premise,
      overview: this.meta.outline.overview,
      characters: structuredClone(this.meta.characters),
      chapters: chapters.map((chapter) => {
        const outline = getChapterOutline(this.meta.chapters, chapter.id);
        return {
          chapterId: chapter.id,
          title: chapter.title,
          act: outline.act,
          plotPoint: outline.plotPoint,
          premise: outline.premise,
          goal: outline.goal,
          conflict: outline.conflict,
          turn: outline.turn,
          characterIds: [...outline.characterIds],
          cards: outline.cards.map((card, order) => ({
            ...structuredClone(card),
            order,
            fingerprint: cardFingerprint(card),
          })),
        };
      }),
    };
  }

  readLore(query: string | null): LoreToolValue {
    const normalized = query === null ? "" : query.trim().toLocaleLowerCase();
    const entries = normalized.length === 0
      ? this.meta.lore
      : this.meta.lore.filter((entry) => [entry.title, entry.description, ...entry.tags]
        .some((text) => text.toLocaleLowerCase().includes(normalized)));
    return { entries: structuredClone(entries) };
  }

  async search(input: BookSearchInput): Promise<BookSearchResult> {
    const query = input.query.trim().toLocaleLowerCase();
    if (query.length === 0) throw new Error("Search query must not be empty");
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error("Search limit must be between 1 and 100");
    const chapterIds = [...new Set(input.chapterIds)];
    for (const chapterId of chapterIds) this.requireChapter(chapterId);
    const matches: BookSearchMatch[] = [];
    const inspectedChapterIds: string[] = [];
    for (const chapterId of chapterIds) {
      const record = await this.readChapterRecord(chapterId);
      inspectedChapterIds.push(chapterId);
      for (const block of record.value.blocks) {
        if (!block.citationText.toLocaleLowerCase().includes(query)) continue;
        if (matches.length === input.limit) {
          return {
            matches,
            inspectedChapterIds,
            uninspectedChapterIds: chapterIds.slice(inspectedChapterIds.length),
            limited: true,
          };
        }
        matches.push({
          chapterId,
          chapterTitle: record.value.title,
          blockId: block.id,
          order: block.order,
          type: block.type,
          text: block.citationText,
          fingerprint: block.fingerprint,
          source: contentSnapshotRef(record),
        });
      }
    }
    return { matches, inspectedChapterIds, uninspectedChapterIds: [], limited: false };
  }
}
