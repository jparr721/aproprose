import { z } from "zod";

export const bookIdSchema = z.string().min(1).brand<"BookId">();
export const contentIdSchema = z.string().min(1).brand<"ContentId">();
export const contentRevisionSchema = z.string().min(1).brand<"ContentRevision">();

export const contentOwnerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("local") }),
  z.strictObject({ kind: z.literal("book"), bookId: bookIdSchema }),
  z.strictObject({ kind: z.literal("editorial"), bookId: bookIdSchema }),
]);

export type BookId = z.infer<typeof bookIdSchema>;
export type ContentId = z.infer<typeof contentIdSchema>;
export type ContentRevision = z.infer<typeof contentRevisionSchema>;
export type ContentOwner = z.infer<typeof contentOwnerSchema>;

export function contentRecordSchema<Kind extends string, Value extends z.ZodType>(input: {
  kind: Kind;
  value: Value;
}) {
  return z.strictObject({
    header: z.strictObject({
      owner: contentOwnerSchema,
      kind: z.literal(input.kind),
      id: contentIdSchema,
      schemaVersion: z.literal(1),
      revision: contentRevisionSchema,
    }),
    value: input.value,
  });
}

export interface ContentHeader<Kind extends string> {
  owner: ContentOwner;
  kind: Kind;
  id: ContentId;
  schemaVersion: 1;
  revision: ContentRevision;
}

export interface ContentRecord<Kind extends string, Value> {
  header: ContentHeader<Kind>;
  value: Value;
}

export type ContentRef<Kind extends string> = Pick<ContentHeader<Kind>, "owner" | "kind" | "id">;

export interface ContentSnapshotRef<Kind extends string> {
  target: ContentRef<Kind>;
  revision: ContentRevision;
}

export function contentRef<Kind extends string>(record: { header: ContentHeader<Kind> }): ContentRef<Kind> {
  return {
    owner: structuredClone(record.header.owner),
    kind: record.header.kind,
    id: record.header.id,
  };
}

export function contentSnapshotRef<Kind extends string>(record: { header: ContentHeader<Kind> }): ContentSnapshotRef<Kind> {
  return { target: contentRef(record), revision: record.header.revision };
}

export interface ContentCodec<Value> {
  parse(input: unknown): Value;
  encode(input: Value): string;
  decode(input: string): Value;
}

export function createContentCodec<Value>(schema: z.ZodType<Value>): ContentCodec<Value> {
  return {
    parse: (input) => schema.parse(input),
    encode: (input) => JSON.stringify(schema.parse(input)),
    decode: (input) => {
      const parsed: unknown = JSON.parse(input);
      return schema.parse(parsed);
    },
  };
}
