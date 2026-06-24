import { describe, it, expect, vi } from "vitest";

// Stub the model layer so importing operations.ts does not pull the Tauri/model stack.
vi.mock("@/lib/ai/model", () => ({ getModel: vi.fn() }));

import { sanitizeEdits } from "@/lib/ai/operations";
import type { BlockEdit } from "@/lib/types";

const blocks = [
  { id: "b1", text: "the cat sat" },
  { id: "b2", text: "hello world" },
  { id: "empty", text: "" },
];

describe("sanitizeEdits", () => {
  it("drops edits whose blockId is not a provided block", () => {
    const edits: BlockEdit[] = [{ blockId: "nope", newText: "x", reason: "r" }];
    expect(sanitizeEdits(edits, blocks)).toEqual([]);
  });

  it("drops a whitespace-for-empty no-op (both trim to empty)", () => {
    const edits: BlockEdit[] = [{ blockId: "empty", newText: "   ", reason: "r" }];
    expect(sanitizeEdits(edits, blocks)).toEqual([]);
  });

  it("drops no-op edits (newText equals current text, trimmed)", () => {
    const edits: BlockEdit[] = [{ blockId: "b1", newText: "  the cat sat  ", reason: "r" }];
    expect(sanitizeEdits(edits, blocks)).toEqual([]);
  });

  it("keeps genuine changes", () => {
    const edits: BlockEdit[] = [{ blockId: "b2", newText: "hello there", reason: "r" }];
    expect(sanitizeEdits(edits, blocks)).toEqual([
      { blockId: "b2", newText: "hello there", reason: "r" },
    ]);
  });
});
