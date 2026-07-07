import { describe, it, expect } from "vitest";
import { planSplit, planCarve, stripOuterQuotes, isNoOp } from "@/lib/blocks/carve";
import type { Block } from "@/lib/types";

const mk = (p: Partial<Block> = {}): Block => ({
  id: "src",
  type: "narration",
  text: "",
  raw: "orig",
  dirty: false,
  ...p,
});

describe("planSplit", () => {
  it("is a no-op at the very start or end", () => {
    const b = mk({ text: "Hello world" });
    expect(planSplit(b, 0).blocks).toEqual([b]);
    expect(planSplit(b, 11).blocks).toEqual([b]);
    expect(planSplit(b, 0).focusId).toBe("src");
  });

  it("splits narration into two fresh, dirty pieces at the caret", () => {
    const b = mk({ text: "Hello world" });
    const { blocks, focusId } = planSplit(b, 5);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe("Hello");
    expect(blocks[1].text).toBe("world");
    expect(blocks.every((p) => p.type === "narration")).toBe(true);
    expect(blocks.every((p) => p.dirty && p.raw === "")).toBe(true);
    expect(blocks[0].id).not.toBe(blocks[1].id);
    expect(focusId).toBe(blocks[1].id);
  });

  it("keeps the speaker on both halves and moves the beat to the trailing half", () => {
    const b = mk({
      type: "dialogue",
      text: "Hi there",
      speaker: "c1",
      tail: [{ kind: "beat", text: "She waved." }],
    });
    const { blocks } = planSplit(b, 2);
    expect(blocks[0]).toMatchObject({ type: "dialogue", text: "Hi", speaker: "c1" });
    expect(blocks[0].tail).toBeUndefined();
    expect(blocks[1]).toMatchObject({
      type: "dialogue",
      text: "there",
      speaker: "c1",
      tail: [{ kind: "beat", text: "She waved." }],
    });
  });

  it("does not leave a dangling marker when the cut is right after an underscore", () => {
    const b = mk({ text: "ab _cd_ ef" });
    const { blocks } = planSplit(b, 4);
    expect(blocks[0].text).toBe("ab");
    expect(blocks[1].text).toBe("_cd_ ef");
    for (const p of blocks) expect((p.text.match(/_/g) ?? []).length % 2).toBe(0);
  });

  it("rebalances emphasis markers across a cut", () => {
    const b = mk({ text: "a _bc_ d" });
    const { blocks } = planSplit(b, 4);
    expect(blocks[0].text).toBe("a _b_");
    expect(blocks[1].text).toBe("_c_ d");
  });

  it("keeps a lore title on the first piece when split", () => {
    const b = mk({ type: "lore", text: "Origin myth here", title: "Genesis" });
    const { blocks } = planSplit(b, 7);
    expect(blocks[0].title).toBe("Genesis");
    expect(blocks[1].title).toBeUndefined();
  });
});

describe("planCarve", () => {
  it("carves a middle slice into a new-typed block, splitting into three", () => {
    const b = mk({ text: "abc def ghi" });
    const { blocks, focusId } = planCarve(b, 4, 7, "lore");
    expect(blocks.map((p) => [p.type, p.text])).toEqual([
      ["narration", "abc"],
      ["lore", "def"],
      ["narration", "ghi"],
    ]);
    expect(focusId).toBe(blocks[1].id);
  });

  it("drops empty edge pieces when the selection touches a boundary", () => {
    const b = mk({ text: "def ghi" });
    const { blocks } = planCarve(b, 0, 3, "lore");
    expect(blocks.map((p) => [p.type, p.text])).toEqual([
      ["lore", "def"],
      ["narration", "ghi"],
    ]);
  });

  it("becomes a whole-block type change when the whole text is selected", () => {
    const b = mk({ text: "all of it" });
    const { blocks } = planCarve(b, 0, 9, "scratchpad");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "scratchpad", text: "all of it" });
    expect(blocks[0].id).not.toBe("src");
  });

  it("strips surrounding quotes when converting to dialogue", () => {
    const b = mk({ text: 'She said, "Run now."' });
    const { blocks } = planCarve(b, 10, 20, "dialogue");
    expect(blocks.map((p) => [p.type, p.text])).toEqual([
      ["narration", "She said,"],
      ["dialogue", "Run now."],
    ]);
    expect(blocks[1].speaker).toBeUndefined();
  });

  it("resets fields converting to a different type, keeps them when isolating", () => {
    const b = mk({ type: "dialogue", text: "Hello there friend", speaker: "c1" });
    const lore = planCarve(b, 6, 11, "lore").blocks;
    expect(lore.map((p) => [p.type, p.speaker])).toEqual([
      ["dialogue", "c1"],
      ["lore", undefined],
      ["dialogue", "c1"],
    ]);
    const iso = planCarve(b, 6, 11, "dialogue").blocks;
    expect(iso[1]).toMatchObject({ type: "dialogue", text: "there", speaker: "c1" });
  });

  it("moves a dialogue beat to the trailing dialogue piece when carving a middle slice", () => {
    const b = mk({
      type: "dialogue",
      text: "Hello there friend",
      speaker: "c1",
      tail: [{ kind: "beat", text: "She waved." }],
    });
    const { blocks } = planCarve(b, 6, 11, "lore");
    expect(blocks.map((p) => p.type)).toEqual(["dialogue", "lore", "dialogue"]);
    expect(blocks[0].tail).toBeUndefined();
    expect(blocks[2].tail).toEqual([{ kind: "beat", text: "She waved." }]);
  });

  it("keeps a lore title on the first surviving lore piece when carving", () => {
    const b = mk({ type: "lore", text: "Origin myth retold here", title: "Genesis" });
    const { blocks } = planCarve(b, 7, 11, "narration");
    expect(blocks.map((p) => p.type)).toEqual(["lore", "narration", "lore"]);
    expect(blocks[0].title).toBe("Genesis");
    expect(blocks[2].title).toBeUndefined();
  });

  it("drops orphaned emphasis markers when carving an emphasized word", () => {
    const b = mk({ text: "abc _def_ ghi" });
    const { blocks } = planCarve(b, 5, 8, "lore");
    expect(blocks.map((p) => [p.type, p.text])).toEqual([
      ["narration", "abc"],
      ["lore", "_def_"],
      ["narration", "ghi"],
    ]);
  });

  it("treats a whitespace-only selection as a caret split (no empty block)", () => {
    const b = mk({ text: "one   two" });
    const { blocks } = planCarve(b, 3, 6, "dialogue");
    expect(blocks.map((p) => [p.type, p.text])).toEqual([
      ["narration", "one"],
      ["narration", "two"],
    ]);
  });
});

describe("isNoOp", () => {
  it("detects an untouched plan vs a real carve", () => {
    const b = mk({ text: "Hello world" });
    expect(isNoOp(planSplit(b, 0), b)).toBe(true);
    expect(isNoOp(planCarve(b, 0, 5, "lore"), b)).toBe(false);
  });
});

describe("stripOuterQuotes", () => {
  it("removes one matched pair of straight or curly quotes", () => {
    expect(stripOuterQuotes('"hi"')).toBe("hi");
    expect(stripOuterQuotes("“hi”")).toBe("hi");
    expect(stripOuterQuotes("'hi'")).toBe("hi");
    expect(stripOuterQuotes("no quotes")).toBe("no quotes");
  });
});
