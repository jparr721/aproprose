import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the model layer so importing operations.ts does not pull the Tauri/model
// stack, and stub the SDK so editBlocks runs against a canned model output.
vi.mock("@/lib/ai/model", () => ({ getModel: vi.fn().mockResolvedValue({}) }));
vi.mock("ai", () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  Output: { object: vi.fn() },
}));

import { generateText } from "ai";
import { editBlocks, reviseChapter, reviseResultSchema, sanitizeProposal } from "@/lib/ai/operations";
import { getModel } from "@/lib/ai/model";
import type { BlockChange, ManuscriptProposal } from "@/lib/types";

beforeEach(() => {
  vi.mocked(generateText).mockReset();
  vi.mocked(getModel).mockClear();
});

const blocks = [
  { id: "b1", text: "the cat sat" },
  { id: "b2", text: "hello world" },
  { id: "empty", text: "" },
];

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

const proposal = (changes: BlockChange[]): ManuscriptProposal => ({
  chapterId: "ch1",
  summary: "s",
  changes,
});

describe("sanitizeProposal rewrite rules", () => {
  it("drops a rewrite whose blockId is unknown", () => {
    const p = proposal([change({ kind: "rewrite", blockId: "nope", newText: "x" })]);
    expect(sanitizeProposal(p, blocks, null).changes).toEqual([]);
  });

  it("drops a rewrite with no newText", () => {
    const p = proposal([change({ kind: "rewrite", blockId: "b1" })]);
    expect(sanitizeProposal(p, blocks, null).changes).toEqual([]);
  });

  it("drops a no-op rewrite (newText equals current text, trimmed)", () => {
    const p = proposal([change({ kind: "rewrite", blockId: "b1", newText: "  the cat sat  " })]);
    expect(sanitizeProposal(p, blocks, null).changes).toEqual([]);
  });

  it("drops a whitespace-for-empty no-op (both trim to empty)", () => {
    const p = proposal([change({ kind: "rewrite", blockId: "empty", newText: "   " })]);
    expect(sanitizeProposal(p, blocks, null).changes).toEqual([]);
  });

  it("drops a rewrite that blanks a block (empty newText is a delete, not a revision)", () => {
    const p = proposal([change({ kind: "rewrite", blockId: "b1", newText: "" })]);
    expect(sanitizeProposal(p, blocks, null).changes).toEqual([]);
  });

  it("keeps a genuine rewrite", () => {
    const c = change({ kind: "rewrite", blockId: "b2", newText: "hello there" });
    expect(sanitizeProposal(proposal([c]), blocks, null).changes).toEqual([c]);
  });
});

describe("sanitizeProposal insert/remove/move rules", () => {
  it("drops an insert with empty (trimmed) newText", () => {
    const p = proposal([change({ kind: "insert", type: "narration", newText: "  " })]);
    expect(sanitizeProposal(p, blocks, null).changes).toEqual([]);
  });

  it("drops an insert without a type", () => {
    const p = proposal([change({ kind: "insert", newText: "fresh" })]);
    expect(sanitizeProposal(p, blocks, null).changes).toEqual([]);
  });

  it("drops an insert whose afterId is unknown", () => {
    const p = proposal([
      change({ kind: "insert", type: "narration", newText: "fresh", afterId: "nope" }),
    ]);
    expect(sanitizeProposal(p, blocks, null).changes).toEqual([]);
  });

  it("keeps an insert anchored to a known block or to the chapter end", () => {
    const anchored = change({ kind: "insert", type: "dialogue", newText: "hi", afterId: "b1" });
    const atEnd = change({ kind: "insert", type: "narration", newText: "coda", afterId: null });
    expect(sanitizeProposal(proposal([anchored, atEnd]), blocks, null).changes).toEqual([
      anchored,
      atEnd,
    ]);
  });

  it("drops a remove whose blockId is unknown and keeps a known one", () => {
    const keep = change({ kind: "remove", blockId: "b1" });
    const p = proposal([change({ kind: "remove", blockId: "nope" }), keep]);
    expect(sanitizeProposal(p, blocks, null).changes).toEqual([keep]);
  });

  it("drops a move without a toIndex or with an unknown blockId", () => {
    const p = proposal([
      change({ kind: "move", blockId: "b1" }),
      change({ kind: "move", blockId: "nope", toIndex: 0 }),
    ]);
    expect(sanitizeProposal(p, blocks, null).changes).toEqual([]);
  });

  it("keeps a well-formed move", () => {
    const c = change({ kind: "move", blockId: "b2", toIndex: 0 });
    expect(sanitizeProposal(proposal([c]), blocks, null).changes).toEqual([c]);
  });

  it("does not mutate the input proposal", () => {
    const p = proposal([change({ kind: "remove", blockId: "nope" })]);
    sanitizeProposal(p, blocks, null);
    expect(p.changes).toHaveLength(1);
  });

  it("keeps only selected structural changes", () => {
    const kept = sanitizeProposal(
      proposal([
        change({ kind: "rewrite", blockId: "b1", newText: "new b1" }),
        change({ kind: "rewrite", blockId: "b2", newText: "new b2" }),
        change({ kind: "insert", afterId: "b1", type: "narration", newText: "after b1" }),
        change({ kind: "insert", afterId: "b2", type: "narration", newText: "after b2" }),
        change({ kind: "insert", afterId: null, type: "narration", newText: "at end" }),
        change({ kind: "remove", blockId: "b1" }),
        change({ kind: "remove", blockId: "b2" }),
        change({ kind: "move", blockId: "b1", toIndex: 1 }),
        change({ kind: "move", blockId: "b2", toIndex: 0 }),
      ]),
      blocks,
      ["b1"],
    ).changes;

    expect(kept.map((item) => item.kind)).toEqual(["rewrite", "insert", "remove", "move"]);
  });
});

describe("editBlocks keeps every edit local to its own block", () => {
  const req = {
    chapterId: "ch1",
    blocks: [
      { id: "b1", type: "narration" as const, text: "the cat sat" },
      { id: "b2", type: "narration" as const, text: "hello world" },
    ],
    instruction: "make these two paragraphs relate more",
  };

  it("collapses two edits for the same block to one and drops a block-blanking edit", async () => {
    // The model tries to relate the blocks: it edits b1 twice and empties b2 to
    // fold its prose into b1. Locality: b1 gets one edit, b2 is left intact.
    vi.mocked(generateText).mockResolvedValue({
      output: {
        edits: [
          { blockId: "b1", newText: "The cat sat quietly.", reason: "r1" },
          { blockId: "b1", newText: "The cat sat, waiting.", reason: "dup" },
          { blockId: "b2", newText: "", reason: "blank" },
        ],
      },
    } as never);
    const out = await editBlocks(req);
    expect(out.changes).toEqual([
      change({ kind: "rewrite", blockId: "b1", newText: "The cat sat quietly.", reason: "r1" }),
    ]);
  });

  it("a leading no-op does not shadow a genuine later edit for the same block", async () => {
    // The model emits a no-op for b1 (text unchanged) before its real revision.
    // Dedup must run on genuine edits, so the real revision survives.
    vi.mocked(generateText).mockResolvedValue({
      output: {
        edits: [
          { blockId: "b1", newText: "the cat sat", reason: "noop" },
          { blockId: "b1", newText: "The cat sat, waiting.", reason: "real" },
        ],
      },
    } as never);
    const out = await editBlocks(req);
    expect(out.changes).toEqual([
      change({ kind: "rewrite", blockId: "b1", newText: "The cat sat, waiting.", reason: "real" }),
    ]);
  });
});

describe("guard shortcircuits (no model call)", () => {
  it("editBlocks resolves an empty proposal when the instruction is blank", async () => {
    const out = await editBlocks({
      chapterId: "ch1",
      blocks: [{ id: "b1", type: "narration", text: "t" }],
      instruction: "   ",
    });
    expect(out).toEqual({ chapterId: "ch1", summary: "", changes: [] });
    expect(getModel).not.toHaveBeenCalled();
  });

  it("reviseChapter resolves an empty proposal when no blocks are eligible", async () => {
    const out = await reviseChapter({ chapterId: "ch1", blocks: [], instruction: "go" });
    expect(out).toEqual({ chapterId: "ch1", summary: "", changes: [] });
    expect(getModel).not.toHaveBeenCalled();
  });
});

describe("reviseResultSchema round-trip", () => {
  it("accepts a change with all-null optional fields plus kind and reason", () => {
    const parsed = reviseResultSchema.parse({
      summary: "s",
      changes: [
        {
          kind: "remove",
          blockId: null,
          afterId: null,
          type: null,
          speaker: null,
          newText: null,
          toIndex: null,
          reason: "r",
        },
      ],
    });
    expect(parsed.changes).toHaveLength(1);
    expect(parsed.changes[0].kind).toBe("remove");
  });

  it("accepts a fully-populated insert change", () => {
    const insert = {
      kind: "insert",
      blockId: null,
      afterId: "b1",
      type: "dialogue",
      speaker: "Mara",
      newText: "Hi there",
      toIndex: null,
      reason: "adds a beat",
    };
    const parsed = reviseResultSchema.parse({ summary: "s", changes: [insert] });
    expect(parsed.changes[0]).toEqual(insert);
  });
});
