import { describe, expect, it } from "vitest";
import { parseChapter } from "@/lib/latex";
import {
  chunkStoryChapter,
  storyChapterFingerprint,
} from "@/lib/story-knowledge/chunking";

describe("story knowledge chunking", () => {
  it("ignores reminted ids and excluded note blocks in semantic fingerprints", () => {
    const blocks = parseChapter("First paragraph.\n\nSecond paragraph.\n");
    const reminted = blocks.map((block, index) => ({
      ...block,
      id: `new-${index}`,
    }));
    expect(storyChapterFingerprint(reminted)).toBe(
      storyChapterFingerprint(blocks),
    );
  });

  it("keeps every eligible block whole and present exactly once", () => {
    const blocks = parseChapter("Alpha text.\n\nBeta text.\n\nGamma text.\n");
    const chunks = chunkStoryChapter("ch1", "One", blocks, 18);
    const projected = chunks.flatMap((chunk) => chunk.blocks);
    expect(projected.map((block) => block.text)).toEqual([
      "Alpha text.",
      "Beta text.",
      "Gamma text.",
    ]);
    expect(new Set(projected.map((block) => block.locator.sourceId)).size).toBe(3);
  });

  it("allows one authored block to exceed the chunk budget without splitting", () => {
    const blocks = parseChapter("A single long authored paragraph.\n");
    const chunks = chunkStoryChapter("ch1", "One", blocks, 5);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].blocks).toHaveLength(1);
  });

  it("keeps a dialogue speaker and every chained dialogue segment", () => {
    const [parsed] = parseChapter(
      "``First line,'' she said. ``Second line.''\n",
    );
    const dialogue = { ...parsed, speaker: "c1" };
    const [chunk] = chunkStoryChapter("ch1", "One", [dialogue], 1_000);
    expect(chunk.blocks[0]).toMatchObject({
      speakerId: "c1",
      text: expect.stringContaining("Second line."),
    });
  });
});
