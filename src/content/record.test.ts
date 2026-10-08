import { describe, expect, it } from "vitest";
import { z } from "zod";
import { contentRecordSchema, createContentCodec, contentRef } from "@/content/record";

const schema = contentRecordSchema({ kind: "example", value: z.strictObject({ text: z.string() }) });
const codec = createContentCodec(schema);
const serialized = {
  header: { owner: { kind: "book", bookId: "book-1" }, kind: "example", id: "example-1", schemaVersion: 1, revision: "revision-1" },
  value: { text: "Unfinished draft" },
};

describe("ContentRecord serialization", () => {
  it("shares a versioned envelope and typed identity without losing owning payload", () => {
    const record = codec.parse(serialized);
    expect(codec.decode(codec.encode(record))).toEqual(record);
    expect(contentRef(record)).toEqual({ owner: serialized.header.owner, kind: "example", id: "example-1" });
  });

  it("rejects unknown schema versions, wrong kinds and runtime collaborators", () => {
    expect(() => codec.parse({ ...serialized, header: { ...serialized.header, schemaVersion: 2 } })).toThrow();
    expect(() => codec.parse({ ...serialized, header: { ...serialized.header, kind: "different" } })).toThrow();
    expect(() => codec.parse({ ...serialized, loadChapter: () => undefined })).toThrow();
    expect(() => codec.parse({ ...serialized, value: { text: "Draft", injected: "dependency" } })).toThrow();
  });
});
