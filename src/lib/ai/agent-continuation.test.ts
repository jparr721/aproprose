import { describe, expect, it } from "vitest";
import { buildContinuationIntent } from "@/lib/ai/agent-continuation";
import type { Block } from "@/lib/types";

const blocks: Block[] = [
  { id: "first", type: "narration", text: "First", raw: "", dirty: false },
  { id: "note", type: "scratchpad", text: "Note", raw: "", dirty: false },
  { id: "last", type: "dialogue", text: "Last", raw: "", dirty: false },
];

describe("continuation intent", () => {
  it("anchors the last selected prose in manuscript order", () => {
    expect(buildContinuationIntent("ch", blocks, ["last", "first"]).task).toEqual({
      kind: "bridge", chapterId: "ch", anchorBlockId: "last", successorBlockId: null,
    });
  });
  it("preserves the clicked block's later prose boundary", () => {
    const intent = buildContinuationIntent("ch", blocks, ["first"]);
    expect(intent.task).toEqual({
      kind: "bridge", chapterId: "ch", anchorBlockId: "first", successorBlockId: "last",
    });
    expect(intent.refs).toEqual([{ kind: "block", chapterId: "ch", blockId: "first" }]);
  });
  it("uses final prose when no prose is selected", () => {
    expect(buildContinuationIntent("ch", blocks, ["note"]).task).toMatchObject({ anchorBlockId: "last" });
  });
  it.each([[], [blocks[1]]])("allows a chapter without prose", (chapterBlocks) => {
    expect(buildContinuationIntent("ch", chapterBlocks, []).task).toEqual({
      kind: "bridge", chapterId: "ch", anchorBlockId: null, successorBlockId: null,
    });
  });
});
