import { describe, it, expect, beforeEach } from "vitest";
import { useOutlineBoardStore } from "@/stores/outline-board-store";

beforeEach(() => {
  useOutlineBoardStore.setState({
    openChapterId: null,
    highlightedCardId: null,
  });
});

describe("outline-board-store chapter nav", () => {
  it("openChapter sets openChapterId", () => {
    useOutlineBoardStore.getState().openChapter("ch1");
    expect(useOutlineBoardStore.getState().openChapterId).toBe("ch1");
  });

  it("closeChapter clears openChapterId to null", () => {
    useOutlineBoardStore.getState().openChapter("ch1");
    useOutlineBoardStore.getState().closeChapter();
    expect(useOutlineBoardStore.getState().openChapterId).toBeNull();
  });

  it("highlights one outline card and clears the highlight explicitly", () => {
    useOutlineBoardStore.getState().highlightCard("card-1");
    expect(useOutlineBoardStore.getState().highlightedCardId).toBe("card-1");

    useOutlineBoardStore.getState().highlightCard("card-2");
    expect(useOutlineBoardStore.getState().highlightedCardId).toBe("card-2");

    useOutlineBoardStore.getState().highlightCard(null);
    expect(useOutlineBoardStore.getState().highlightedCardId).toBeNull();
  });
});
