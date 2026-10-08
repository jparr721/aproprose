import { z } from "zod";
import { contentRecordSchema, createContentCodec, type ContentSnapshotRef } from "@/content/record";
import type { Block, ProjectInfo, ProjectMeta } from "@/lib/types";

const blockFields = {
  id: z.string().min(1),
  order: z.number().int().nonnegative(),
  text: z.string(),
  fingerprint: z.string().min(1),
  citationText: z.string(),
};

export const bookBlockSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...blockFields, type: z.literal("narration") }),
  z.strictObject({
    ...blockFields,
    type: z.literal("dialogue"),
    speaker: z.string().optional(),
    tail: z.array(z.strictObject({ kind: z.enum(["beat", "quote"]), text: z.string() })).optional(),
  }),
  z.strictObject({ ...blockFields, type: z.literal("chapter"), level: z.enum(["scene", "break"]).optional() }),
  z.strictObject({ ...blockFields, type: z.literal("lore"), title: z.string().optional() }),
  z.strictObject({ ...blockFields, type: z.literal("scratchpad") }),
  z.strictObject({ ...blockFields, type: z.literal("latex") }),
]);

export const bookChapterSchema = z.strictObject({
  chapterId: z.string().min(1),
  title: z.string(),
  blocks: z.array(bookBlockSchema),
});

export const chapterRecordSchema = contentRecordSchema({ kind: "chapter", value: bookChapterSchema })
  .refine((record) => record.header.owner.kind === "book", "Chapter records require a book owner")
  .refine((record) => record.header.id === record.value.chapterId, "Chapter record identity must match its value");

export const chapterRecordCodec = createContentCodec(chapterRecordSchema);

export type BookBlockValue = z.infer<typeof bookBlockSchema>;
export type BookChapterValue = z.infer<typeof bookChapterSchema>;
export type ChapterRecord = z.infer<typeof chapterRecordSchema>;

export const bookManifestSchema = z.strictObject({
  name: z.string(),
  metadata: z.strictObject({
    title: z.string(),
    subtitle: z.string(),
    author: z.string(),
    publisher: z.string(),
    isbn: z.string(),
  }),
  chapters: z.array(z.strictObject({
    id: z.string().min(1),
    label: z.string(),
    title: z.string(),
    file: z.string().min(1),
    wordCount: z.number().int().nonnegative(),
    status: z.enum(["active", "draft", "outline", "planned"]).nullable(),
    cardCount: z.number().int().nonnegative(),
    hasKnowledge: z.boolean(),
  })),
  characterIds: z.array(z.string().min(1)),
  loreIds: z.array(z.string().min(1)),
});

export const bookRecordSchema = contentRecordSchema({ kind: "book", value: bookManifestSchema })
  .refine((record) => record.header.owner.kind === "book" && record.header.owner.bookId.toString() === record.header.id,
    "Book record identity must match its owner");
export const bookRecordCodec = createContentCodec(bookRecordSchema);
export type BookManifest = z.infer<typeof bookManifestSchema>;
export type BookRecord = z.infer<typeof bookRecordSchema>;

export interface BookChapterSnapshot {
  chapterId: string;
  title: string;
  blocks: Block[];
}

export interface BookDependencies {
  project: ProjectInfo;
  meta: ProjectMeta;
  chapter: BookChapterSnapshot | null;
  loadChapter(chapterId: string): Promise<BookChapterSnapshot>;
}

export interface BookSearchInput {
  query: string;
  chapterIds: string[];
  limit: number;
}

export interface BookSearchMatch {
  chapterId: string;
  chapterTitle: string;
  blockId: string;
  order: number;
  type: Block["type"];
  text: string;
  fingerprint: string;
  source: ContentSnapshotRef<"chapter">;
}

export interface BookSearchResult {
  matches: BookSearchMatch[];
  inspectedChapterIds: string[];
  uninspectedChapterIds: string[];
  limited: boolean;
}
