import { describe, expect, it, vi } from "vitest";
import { Book } from "@/book/book";
import { bookRecordCodec, chapterRecordCodec } from "@/book/types";
import { EMPTY_META } from "@/lib/migration";
import { blockFingerprint } from "@/lib/ai/agent-context";
import type { Block, ProjectInfo, ProjectMeta } from "@/lib/types";

function project(): ProjectInfo {
  return {
    root: "/book",
    name: "The Unfinished Book",
    mainFile: "main.tex",
    title: "The Unfinished Book",
    author: "The Author",
    metadata: {
      title: "The Unfinished Book",
      subtitle: "",
      author: "The Author",
      publisher: "",
      isbn: "",
    },
    chapters: [
      { id: "ch1", label: "1", title: "Dad", file: "one.tex", wordCount: 12 },
      { id: "ch2", label: "2", title: "Bagel", file: "two.tex", wordCount: 4 },
    ],
  };
}

function blocks(): Block[] {
  return [
    {
      id: "dialogue",
      type: "dialogue",
      text: "I remember.",
      speaker: "dad",
      tail: [
        { kind: "beat", text: "He set down the bagel." },
        { kind: "quote", text: "Every last detail." },
      ],
      raw: "original dialogue source",
      dirty: true,
    },
    { id: "scene", type: "chapter", text: "Kitchen", level: "scene", raw: "", dirty: false },
    { id: "break", type: "chapter", text: "* * *", level: "break", raw: "", dirty: false },
    { id: "lore", type: "lore", text: "Dad never ate bread.", title: "Diet", raw: "", dirty: false },
    { id: "scratch", type: "scratchpad", text: "Check the timeline.", raw: "", dirty: false },
    { id: "latex", type: "latex", text: "\\index{bread}", raw: "\\index{bread}\n", dirty: false },
    { id: "prose", type: "narration", text: "Rain fell.", raw: "Rain fell.\n\n", dirty: false },
  ];
}

describe("Book frozen source view", () => {
  it("preserves every semantic field without exposing source storage bookkeeping", async () => {
    const source = blocks();
    const loadChapter = vi.fn();
    const book = new Book({
      project: project(),
      meta: structuredClone(EMPTY_META),
      chapter: { chapterId: "ch1", title: "Dad", blocks: source },
      loadChapter,
    });
    const chapter = await book.readChapter("ch1");
    expect(chapter.blocks[0]).toEqual({
      id: "dialogue",
      order: 0,
      type: "dialogue",
      text: "I remember.",
      speaker: "dad",
      tail: source[0].tail,
      fingerprint: blockFingerprint(source[0]),
      citationText: "I remember.\nHe set down the bagel.\nEvery last detail.",
    });
    expect(chapter.blocks[1]).toMatchObject({ level: "scene" });
    expect(chapter.blocks[2]).toMatchObject({ level: "break" });
    expect(chapter.blocks[3]).toMatchObject({ title: "Diet", citationText: "Diet\nDad never ate bread." });
    expect(chapter.blocks[4].citationText).toBe("Check the timeline.");
    expect(chapter.blocks[5].citationText).toBe("\\index{bread}");
    expect(chapter.blocks.every((block) => !("raw" in block) && !("dirty" in block))).toBe(true);
    expect(loadChapter).not.toHaveBeenCalled();
  });

  it("isolates captured inputs and returned values, including nested dialogue tails", async () => {
    const source = blocks();
    const capturedProject = project();
    const meta = structuredClone(EMPTY_META);
    const book = new Book({
      project: capturedProject,
      meta,
      chapter: { chapterId: "ch1", title: "Dad", blocks: source },
      loadChapter: vi.fn(),
    });
    source[0].text = "Changed after capture";
    capturedProject.metadata.title = "Changed title";
    meta.outline.premise = "Changed premise";
    const first = await book.readChapter("ch1");
    const firstBlock = first.blocks[0];
    if (firstBlock.type !== "dialogue" || firstBlock.tail === undefined) throw new Error("Expected chained dialogue");
    firstBlock.tail[0].text = "Changed result";
    expect((await book.readChapter("ch1")).blocks[0].citationText).toContain("He set down the bagel.");
    expect((await book.readChapter("ch1")).blocks[0].text).toBe("I remember.");
    expect(book.metadata().title).toBe("The Unfinished Book");
    expect(book.readOutline(null).premise).toBe("");
  });

  it("loads requested chapters lazily once and rejects unknown or mismatched source identities", async () => {
    const loadChapter = vi.fn(async (chapterId: string) => ({ chapterId, title: "Bagel", blocks: blocks() }));
    const book = new Book({ project: project(), meta: structuredClone(EMPTY_META), chapter: null, loadChapter });
    expect(loadChapter).not.toHaveBeenCalled();
    await Promise.all([book.readChapter("ch2"), book.readChapter("ch2")]);
    expect(loadChapter).toHaveBeenCalledExactlyOnceWith("ch2");
    await expect(book.readChapter("unknown")).rejects.toThrow("Chapter not found: unknown");
    const mismatched = new Book({
      project: project(), meta: structuredClone(EMPTY_META), chapter: null,
      loadChapter: async () => ({ chapterId: "ch2", title: "Bagel", blocks: blocks() }),
    });
    await expect(mismatched.readChapter("ch1")).rejects.toThrow("Chapter source identity mismatch");
  });

  it("retries a failed chapter read and retains the successful source for later search", async () => {
    const failure = new Error("Temporary chapter read failure");
    const loadChapter = vi.fn(async () => ({ chapterId: "ch2", title: "Bagel", blocks: blocks() }))
      .mockRejectedValueOnce(failure);
    const book = new Book({ project: project(), meta: structuredClone(EMPTY_META), chapter: null, loadChapter });

    await expect(book.readChapter("ch2")).rejects.toBe(failure);
    expect((await book.readChapter("ch2")).title).toBe("Bagel");
    expect((await book.search({ query: "bagel", chapterIds: ["ch2"], limit: 10 })).matches[0].blockId).toBe("dialogue");
    expect(loadChapter).toHaveBeenCalledTimes(2);
  });

  it("shares failed and retried loads without sharing returned chapter values", async () => {
    const failure = new Error("Temporary chapter read failure");
    const loadChapter = vi.fn(async () => ({ chapterId: "ch2", title: "Bagel", blocks: blocks() }))
      .mockRejectedValueOnce(failure);
    const book = new Book({ project: project(), meta: structuredClone(EMPTY_META), chapter: null, loadChapter });

    const failedReads = await Promise.allSettled([
      book.readChapterRecord("ch2"),
      book.search({ query: "bagel", chapterIds: ["ch2"], limit: 10 }),
    ]);
    expect(failedReads).toEqual([
      { status: "rejected", reason: failure },
      { status: "rejected", reason: failure },
    ]);
    expect(loadChapter).toHaveBeenCalledTimes(1);

    const [first, second] = await Promise.all([book.readChapter("ch2"), book.readChapter("ch2")]);
    expect(loadChapter).toHaveBeenCalledTimes(2);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    first.blocks[0].text = "Changed returned value";
    expect(second.blocks[0].text).toBe("I remember.");
    expect((await book.readChapterRecord("ch2")).value.blocks[0].text).toBe("I remember.");
    expect(loadChapter).toHaveBeenCalledTimes(2);
  });

  it("allows a corrected chapter source after an identity failure", async () => {
    const loadChapter = vi.fn(async () => ({ chapterId: "ch2", title: "Bagel", blocks: blocks() }))
      .mockResolvedValueOnce({ chapterId: "ch1", title: "Dad", blocks: blocks() });
    const book = new Book({ project: project(), meta: structuredClone(EMPTY_META), chapter: null, loadChapter });

    await expect(book.readChapterRecord("ch2")).rejects.toThrow("Chapter source identity mismatch");
    expect((await book.readChapterRecord("ch2")).header.id).toBe("ch2");
    expect(loadChapter).toHaveBeenCalledTimes(2);
  });

  it("round-trips real chapter records without serializing injected collaborators", async () => {
    const book = new Book({
      project: project(), meta: structuredClone(EMPTY_META),
      chapter: { chapterId: "ch1", title: "Dad", blocks: blocks() }, loadChapter: vi.fn(),
    });
    const record = await book.readChapterRecord("ch1");
    expect(chapterRecordCodec.decode(chapterRecordCodec.encode(record))).toEqual(record);
    expect(record.header).toMatchObject({ kind: "chapter", id: "ch1", owner: { kind: "book", bookId: "/book" }, schemaVersion: 1 });
    expect(chapterRecordCodec.encode(record)).not.toContain("loadChapter");
    expect(chapterRecordCodec.encode(record)).not.toContain("original dialogue source");
  });

  it("searches full dialogue and notes with exact text and explicit inspected coverage", async () => {
    const loadChapter = vi.fn();
    const book = new Book({
      project: project(), meta: structuredClone(EMPTY_META),
      chapter: { chapterId: "ch1", title: "Dad", blocks: blocks() }, loadChapter,
    });
    const result = await book.search({ query: "bagel", chapterIds: ["ch1"], limit: 10 });
    expect(result.inspectedChapterIds).toEqual(["ch1"]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ chapterId: "ch1", blockId: "dialogue", text: "I remember.\nHe set down the bagel.\nEvery last detail." });
    expect(result.matches[0].source.target).toMatchObject({ kind: "chapter", id: "ch1" });
    expect((await book.search({ query: "timeline", chapterIds: ["ch1"], limit: 10 })).matches[0].blockId).toBe("scratch");
    await expect(book.search({ query: " ", chapterIds: ["ch1"], limit: 10 })).rejects.toThrow("Search query must not be empty");
    await expect(book.search({ query: "bagel", chapterIds: ["ch1"], limit: 101 })).rejects.toThrow("Search limit must be between 1 and 100");
    expect(loadChapter).not.toHaveBeenCalled();
  });

  it("returns frozen metadata, linked cast, lore, outlines and a discoverable book manifest", () => {
    const meta: ProjectMeta = structuredClone(EMPTY_META);
    meta.characters = [{ id: "dad", name: "Dad", role: "Father", color: "#ffffff", profile: { appearance: "", mannerisms: "", motivations: "", relationships: "", history: "", voice: "" } }];
    meta.lore = [{ id: "diet", title: "Diet", description: "No bread", tags: ["food"], characterIds: ["dad"] }];
    const book = new Book({ project: project(), meta, chapter: null, loadChapter: vi.fn() });
    expect(book.manifest().chapters).toHaveLength(2);
    expect(book.manifest().characterIds).toEqual(["dad"]);
    expect(book.manifest().loreIds).toEqual(["diet"]);
    expect(bookRecordCodec.decode(bookRecordCodec.encode(book.record())).value).toEqual(book.manifest());
    expect(book.readLore("food").entries[0].id).toBe("diet");
    expect(book.readCharacter("dad").name).toBe("Dad");
    expect(book.readOutline("ch1").chapters[0].cards).toEqual([]);
    expect(() => book.readCharacter("missing")).toThrow("Character not found: missing");
    expect(() => book.readOutline("missing")).toThrow("Chapter not found: missing");
  });
});
