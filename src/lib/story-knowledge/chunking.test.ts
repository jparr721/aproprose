import { describe, expect, it } from "vitest";
import { parseChapter } from "@/lib/latex";
import {
  chunkStoryChapter,
  storyChapterFingerprint,
} from "@/lib/story-knowledge/chunking";
import type { Block } from "@/lib/types";

describe("story knowledge chunking", () => {
  it("ignores reminted ids in semantic fingerprints", () => {
    const blocks = parseChapter("First paragraph.\n\nSecond paragraph.\n");
    const reminted = blocks.map((block, index) => ({
      ...block,
      id: `new-${index}`,
    }));
    expect(storyChapterFingerprint(reminted)).toBe(
      storyChapterFingerprint(blocks),
    );
  });

  it("excludes notes, raw latex, and chapter breaks from model input", () => {
    const eligible = parseChapter("First paragraph.\n\nSecond paragraph.\n");
    const excluded: Block[] = [
      {
        id: "lore-1",
        type: "lore",
        text: "Lore note",
        raw: "% lore\n",
        dirty: false,
      },
      {
        id: "scratch-1",
        type: "scratchpad",
        text: "Scratch note",
        raw: "% scratch\n",
        dirty: false,
      },
      {
        id: "latex-1",
        type: "latex",
        text: "\\newpage",
        raw: "\\newpage\n",
        dirty: false,
      },
      {
        id: "break-1",
        type: "chapter",
        level: "break",
        text: "Scene break",
        raw: "\\begin{center}Scene break\\end{center}\n",
        dirty: false,
      },
    ];
    const mixed = [eligible[0], ...excluded, eligible[1]];

    expect(
      chunkStoryChapter("ch1", "One", mixed, 1_000).flatMap((chunk) =>
        chunk.blocks.map((block) => block.text),
      ),
    ).toEqual(["First paragraph.", "Second paragraph."]);
    expect(storyChapterFingerprint(mixed)).toBe(
      storyChapterFingerprint(eligible),
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

  it("assigns a stable occurrence to duplicate semantic blocks", () => {
    const blocks = parseChapter("Repeated text.\n\nRepeated text.\n");
    const reminted = blocks.map((block, index) => ({
      ...block,
      id: `reminted-${index}`,
    }));

    const originalLocators = chunkStoryChapter("ch1", "One", blocks, 1_000)
      .flatMap((chunk) => chunk.blocks)
      .map((block) => block.locator);
    const remintedLocators = chunkStoryChapter("ch1", "One", reminted, 1_000)
      .flatMap((chunk) => chunk.blocks)
      .map((block) => block.locator);

    expect(originalLocators).toMatchObject([
      { occurrence: 0 },
      { occurrence: 1 },
    ]);
    expect(remintedLocators).toMatchObject([
      { occurrence: 0 },
      { occurrence: 1 },
    ]);
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
