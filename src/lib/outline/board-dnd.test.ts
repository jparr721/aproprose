import { describe, expect, it } from "vitest";
import { cardColumnId, resolveCardDrop } from "@/lib/outline/board-dnd";
import { emptyChapterOutline } from "@/lib/outline/model";
import type { Card, ChapterOutline } from "@/lib/types";

const card = (id: string): Card => ({ id, title: id, intention: "", characterIds: [], loreIds: [], continuityFlags: [] });
const chapters: Record<string, ChapterOutline> = {
  ch1: { ...emptyChapterOutline(), cards: [card("a"), card("b")] },
  ch2: { ...emptyChapterOutline(), cards: [card("c")] },
};

describe("resolveCardDrop", () => {
  it("drop over a column appends to that chapter", () => {
    expect(resolveCardDrop(chapters, "a", cardColumnId("ch2"))).toEqual({
      fromChapterId: "ch1", toChapterId: "ch2", cardId: "a", toIndex: 1,
    });
  });
  it("drop over a card targets that card's chapter + index", () => {
    expect(resolveCardDrop(chapters, "a", "c")).toEqual({
      fromChapterId: "ch1", toChapterId: "ch2", cardId: "a", toIndex: 0,
    });
  });
  it("no-op on itself", () => {
    expect(resolveCardDrop(chapters, "a", "a")).toBeNull();
  });
  it("null for an unknown active card", () => {
    expect(resolveCardDrop(chapters, "zzz", "c")).toBeNull();
  });
});
