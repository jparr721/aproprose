import { describe, it, expect, vi } from "vitest";
import { applyProposal } from "@/lib/blocks/proposal";
import type { Block, BlockChange } from "@/lib/types";

const mk = (id: string, text: string, p: Partial<Block> = {}): Block => ({
  id,
  type: "narration",
  text,
  raw: `${text}\n\n`,
  dirty: false,
  ...p,
});

const change = (p: Partial<BlockChange> & { kind: BlockChange["kind"] }): BlockChange => ({
  blockId: null,
  afterId: null,
  type: null,
  speaker: null,
  newText: null,
  toIndex: null,
  reason: "r",
  ...p,
});

const noSpeaker = (): string | undefined => undefined;

describe("applyProposal rewrite", () => {
  it("applies the text and marks the block dirty", () => {
    const blocks = [mk("a", "alpha"), mk("b", "bravo")];
    const out = applyProposal(
      blocks,
      [change({ kind: "rewrite", blockId: "a", newText: "ALPHA" })],
      noSpeaker,
    );
    expect(out.blocks.map((x) => x.text)).toEqual(["ALPHA", "bravo"]);
    expect(out.blocks[0].dirty).toBe(true);
    expect(out.blocks[1]).toBe(blocks[1]); // untouched blocks keep identity
    expect(out.applied).toBe(1);
    expect(out.skipped).toBe(0);
  });

  it("skips and counts a rewrite whose block has vanished", () => {
    const blocks = [mk("a", "alpha")];
    const out = applyProposal(
      blocks,
      [change({ kind: "rewrite", blockId: "ghost", newText: "x" })],
      noSpeaker,
    );
    expect(out.blocks).toEqual(blocks);
    expect(out.applied).toBe(0);
    expect(out.skipped).toBe(1);
  });
});

describe("applyProposal insert", () => {
  it("inserts after the anchor block, minted dirty with empty raw", () => {
    const blocks = [mk("a", "alpha"), mk("b", "bravo")];
    const out = applyProposal(
      blocks,
      [change({ kind: "insert", afterId: "a", type: "narration", newText: "fresh" })],
      noSpeaker,
    );
    expect(out.blocks.map((x) => x.text)).toEqual(["alpha", "fresh", "bravo"]);
    const inserted = out.blocks[1];
    expect(inserted.id).not.toBe("a");
    expect(inserted.id).not.toBe("b");
    expect(inserted.type).toBe("narration");
    expect(inserted.dirty).toBe(true);
    expect(inserted.raw).toBe("");
    expect(out.applied).toBe(1);
  });

  it("appends at the end when afterId is null", () => {
    const blocks = [mk("a", "alpha")];
    const out = applyProposal(
      blocks,
      [change({ kind: "insert", afterId: null, type: "narration", newText: "coda" })],
      noSpeaker,
    );
    expect(out.blocks.map((x) => x.text)).toEqual(["alpha", "coda"]);
  });

  it("applies three inserts sharing one afterId in reading order", () => {
    const blocks = [mk("a", "alpha"), mk("b", "bravo")];
    const out = applyProposal(
      blocks,
      [
        change({ kind: "insert", afterId: "a", type: "narration", newText: "one" }),
        change({ kind: "insert", afterId: "a", type: "narration", newText: "two" }),
        change({ kind: "insert", afterId: "a", type: "narration", newText: "three" }),
      ],
      noSpeaker,
    );
    expect(out.blocks.map((x) => x.text)).toEqual(["alpha", "one", "two", "three", "bravo"]);
    expect(out.applied).toBe(3);
    expect(out.skipped).toBe(0);
  });

  it("still inserts at the end (and counts as applied) when afterId has vanished", () => {
    const blocks = [mk("a", "alpha"), mk("b", "bravo")];
    const out = applyProposal(
      blocks,
      [change({ kind: "insert", afterId: "ghost", type: "narration", newText: "stray" })],
      noSpeaker,
    );
    expect(out.blocks.map((x) => x.text)).toEqual(["alpha", "bravo", "stray"]);
    expect(out.applied).toBe(1);
    expect(out.skipped).toBe(0);
  });

  it("resolves a dialogue speaker through the passed resolver", () => {
    const resolve = vi.fn().mockReturnValue("c9");
    const out = applyProposal(
      [mk("a", "alpha")],
      [change({ kind: "insert", type: "dialogue", speaker: "Mara", newText: "Hi" })],
      resolve,
    );
    expect(resolve).toHaveBeenCalledWith("Mara");
    expect(out.blocks[1].speaker).toBe("c9");
  });

  it("leaves speaker unset when the resolver finds no match", () => {
    const out = applyProposal(
      [mk("a", "alpha")],
      [change({ kind: "insert", type: "dialogue", speaker: "Nobody", newText: "Hi" })],
      noSpeaker,
    );
    expect(out.blocks[1].speaker).toBeUndefined();
  });

  it("applies an insert that carries chained tail segments", () => {
    const out = applyProposal(
      [{ id: "a", type: "narration", text: "x", raw: "", dirty: false }],
      [
        {
          kind: "insert", blockId: null, afterId: "a", type: "dialogue",
          speaker: null, newText: "All right,", toIndex: null, reason: "r",
          segments: [
            { kind: "beat", text: "Brian said." },
            { kind: "quote", text: "Start with this." },
          ],
        },
      ],
      () => undefined,
    );
    const inserted = out.blocks[1];
    expect(inserted.type).toBe("dialogue");
    expect(inserted.text).toBe("All right,");
    expect(inserted.tail).toEqual([
      { kind: "beat", text: "Brian said." },
      { kind: "quote", text: "Start with this." },
    ]);
  });
});

describe("applyProposal remove and move", () => {
  it("remove filters the block out", () => {
    const blocks = [mk("a", "alpha"), mk("b", "bravo")];
    const out = applyProposal(blocks, [change({ kind: "remove", blockId: "a" })], noSpeaker);
    expect(out.blocks.map((x) => x.id)).toEqual(["b"]);
    expect(out.applied).toBe(1);
  });

  it("skips and counts a remove whose block has vanished", () => {
    const out = applyProposal(
      [mk("a", "alpha")],
      [change({ kind: "remove", blockId: "ghost" })],
      noSpeaker,
    );
    expect(out.blocks.map((x) => x.id)).toEqual(["a"]);
    expect(out.skipped).toBe(1);
  });

  it("move clamps an out-of-range toIndex to the ends", () => {
    const blocks = [mk("a", "alpha"), mk("b", "bravo"), mk("c", "charlie")];
    const high = applyProposal(blocks, [change({ kind: "move", blockId: "a", toIndex: 99 })], noSpeaker);
    expect(high.blocks.map((x) => x.id)).toEqual(["b", "c", "a"]);
    const low = applyProposal(blocks, [change({ kind: "move", blockId: "c", toIndex: -5 })], noSpeaker);
    expect(low.blocks.map((x) => x.id)).toEqual(["c", "a", "b"]);
  });

  it("moves to an in-range index", () => {
    const blocks = [mk("a", "alpha"), mk("b", "bravo"), mk("c", "charlie")];
    const out = applyProposal(blocks, [change({ kind: "move", blockId: "c", toIndex: 1 })], noSpeaker);
    expect(out.blocks.map((x) => x.id)).toEqual(["a", "c", "b"]);
  });
});

describe("applyProposal fold semantics", () => {
  it("applies changes in order over the evolving list", () => {
    const blocks = [mk("a", "alpha"), mk("b", "bravo"), mk("c", "charlie")];
    const out = applyProposal(
      blocks,
      [
        change({ kind: "insert", afterId: "a", type: "narration", newText: "fresh" }),
        // Runs against [a, fresh, b, c]: moving c to 0 must account for the insert.
        change({ kind: "move", blockId: "c", toIndex: 0 }),
        change({ kind: "remove", blockId: "b" }),
      ],
      noSpeaker,
    );
    expect(out.blocks.map((x) => x.text)).toEqual(["charlie", "alpha", "fresh"]);
    expect(out.applied).toBe(3);
    expect(out.skipped).toBe(0);
  });

  it("returns the same blocks array with zero counts for empty changes", () => {
    const blocks = [mk("a", "alpha")];
    const out = applyProposal(blocks, [], noSpeaker);
    expect(out.blocks).toBe(blocks);
    expect(out.applied).toBe(0);
    expect(out.skipped).toBe(0);
  });

  it("does not mutate the input blocks", () => {
    const blocks = [mk("a", "alpha")];
    applyProposal(
      blocks,
      [change({ kind: "rewrite", blockId: "a", newText: "ALPHA" })],
      noSpeaker,
    );
    expect(blocks[0].text).toBe("alpha");
    expect(blocks[0].dirty).toBe(false);
  });
});
