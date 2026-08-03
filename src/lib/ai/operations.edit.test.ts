import { describe, expect, it } from "vitest";

import { sanitizeProposal } from "@/lib/ai/operations";
import type { BlockChange, ManuscriptProposal } from "@/lib/types";

const blocks = [
  { id: "b1", text: "the cat sat" },
  { id: "b2", text: "hello world" },
  { id: "empty", text: "" },
];

const change = (
  patch: Partial<BlockChange> & { kind: BlockChange["kind"] },
): BlockChange => ({
  blockId: null,
  afterId: null,
  type: null,
  speaker: null,
  newText: null,
  toIndex: null,
  reason: "r",
  ...patch,
});

const proposal = (changes: BlockChange[]): ManuscriptProposal => ({
  chapterId: "ch1",
  summary: "s",
  changes,
});

describe("sanitizeProposal rewrite rules", () => {
  it("drops a rewrite whose blockId is unknown", () => {
    const input = proposal([
      change({ kind: "rewrite", blockId: "unknown", newText: "x" }),
    ]);
    expect(sanitizeProposal(input, blocks, null).changes).toEqual([]);
  });

  it("drops a rewrite with no newText", () => {
    const input = proposal([change({ kind: "rewrite", blockId: "b1" })]);
    expect(sanitizeProposal(input, blocks, null).changes).toEqual([]);
  });

  it("drops a no-op rewrite after trimming", () => {
    const input = proposal([
      change({
        kind: "rewrite",
        blockId: "b1",
        newText: "  the cat sat  ",
      }),
    ]);
    expect(sanitizeProposal(input, blocks, null).changes).toEqual([]);
  });

  it("drops a rewrite that blanks a block", () => {
    const input = proposal([
      change({ kind: "rewrite", blockId: "b1", newText: "" }),
    ]);
    expect(sanitizeProposal(input, blocks, null).changes).toEqual([]);
  });

  it("keeps a genuine rewrite", () => {
    const revision = change({
      kind: "rewrite",
      blockId: "b2",
      newText: "hello there",
    });
    expect(
      sanitizeProposal(proposal([revision]), blocks, null).changes,
    ).toEqual([revision]);
  });
});

describe("sanitizeProposal structural rules", () => {
  it("drops inserts with blank text, no type, or an unknown anchor", () => {
    const input = proposal([
      change({ kind: "insert", type: "narration", newText: "  " }),
      change({ kind: "insert", newText: "fresh" }),
      change({
        kind: "insert",
        type: "narration",
        newText: "fresh",
        afterId: "unknown",
      }),
    ]);
    expect(sanitizeProposal(input, blocks, null).changes).toEqual([]);
  });

  it("keeps inserts anchored to a known block or the chapter end", () => {
    const anchored = change({
      kind: "insert",
      type: "dialogue",
      newText: "hi",
      afterId: "b1",
    });
    const atEnd = change({
      kind: "insert",
      type: "narration",
      newText: "coda",
      afterId: null,
    });
    expect(
      sanitizeProposal(proposal([anchored, atEnd]), blocks, null).changes,
    ).toEqual([anchored, atEnd]);
  });

  it("keeps only known remove and move targets", () => {
    const remove = change({ kind: "remove", blockId: "b1" });
    const move = change({ kind: "move", blockId: "b2", toIndex: 0 });
    const input = proposal([
      change({ kind: "remove", blockId: "unknown" }),
      change({ kind: "move", blockId: "b1" }),
      change({ kind: "move", blockId: "unknown", toIndex: 0 }),
      remove,
      move,
    ]);
    expect(sanitizeProposal(input, blocks, null).changes).toEqual([
      remove,
      move,
    ]);
  });

  it("does not mutate the input proposal", () => {
    const input = proposal([
      change({ kind: "remove", blockId: "unknown" }),
    ]);
    sanitizeProposal(input, blocks, null);
    expect(input.changes).toHaveLength(1);
  });

  it("confines every change kind to the allowed target", () => {
    const kept = sanitizeProposal(
      proposal([
        change({ kind: "rewrite", blockId: "b1", newText: "new b1" }),
        change({ kind: "rewrite", blockId: "b2", newText: "new b2" }),
        change({
          kind: "insert",
          afterId: "b1",
          type: "narration",
          newText: "after b1",
        }),
        change({
          kind: "insert",
          afterId: "b2",
          type: "narration",
          newText: "after b2",
        }),
        change({
          kind: "insert",
          afterId: null,
          type: "narration",
          newText: "at end",
        }),
        change({ kind: "remove", blockId: "b1" }),
        change({ kind: "remove", blockId: "b2" }),
        change({ kind: "move", blockId: "b1", toIndex: 1 }),
        change({ kind: "move", blockId: "b2", toIndex: 0 }),
      ]),
      blocks,
      ["b1"],
    ).changes;

    expect(kept).toEqual([
      change({ kind: "rewrite", blockId: "b1", newText: "new b1" }),
      change({
        kind: "insert",
        afterId: "b1",
        type: "narration",
        newText: "after b1",
      }),
      change({ kind: "remove", blockId: "b1" }),
      change({ kind: "move", blockId: "b1", toIndex: 1 }),
    ]);
  });

  it("drops every change when the allowlist is empty", () => {
    const input = proposal([
      change({ kind: "rewrite", blockId: "b1", newText: "new b1" }),
      change({
        kind: "insert",
        afterId: "b1",
        type: "narration",
        newText: "after b1",
      }),
      change({ kind: "remove", blockId: "b2" }),
    ]);
    expect(sanitizeProposal(input, blocks, []).changes).toEqual([]);
  });
});
