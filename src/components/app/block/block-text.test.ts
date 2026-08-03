import { describe, expect, it } from "vitest";
import { blockHasContent } from "@/components/app/block/block-text";
import type { Block } from "@/lib/types";

function block(overrides: Partial<Block>): Block {
  return {
    id: "b1",
    type: "narration",
    text: "",
    raw: "",
    dirty: true,
    ...overrides,
  };
}

describe("blockHasContent", () => {
  it("treats blank text and blank optional fields as empty", () => {
    expect(blockHasContent(block({ text: "  " }))).toBe(false);
    expect(blockHasContent(block({ type: "lore", title: "  " }))).toBe(false);
    expect(
      blockHasContent(
        block({ type: "dialogue", tail: [{ kind: "beat", text: "  " }] }),
      ),
    ).toBe(false);
  });

  it("detects primary text, lore titles, and dialogue tail text", () => {
    expect(blockHasContent(block({ text: "Some prose." }))).toBe(true);
    expect(blockHasContent(block({ type: "lore", title: "Character note" }))).toBe(true);
    expect(
      blockHasContent(
        block({ type: "dialogue", tail: [{ kind: "beat", text: "She waved." }] }),
      ),
    ).toBe(true);
  });
});
