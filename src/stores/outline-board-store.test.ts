import { describe, it, expect, beforeEach } from "vitest";
import { useOutlineBoardStore } from "@/stores/outline-board-store";

beforeEach(() => {
  useOutlineBoardStore.setState({
    openChapterId: null,
    chapterView: "edit",
  });
});

describe("outline-board-store chapter nav", () => {
  it("openChapter sets openChapterId", () => {
    useOutlineBoardStore.setState({ chapterView: "guide" } as never);
    useOutlineBoardStore.getState().openChapter("ch1");
    expect(useOutlineBoardStore.getState().openChapterId).toBe("ch1");
    expect(useOutlineBoardStore.getState().chapterView).toBe("edit");
  });

  it("openChapterGuide opens the chapter directly in the conversation", () => {
    useOutlineBoardStore.getState().openChapterGuide("ch1");
    expect(useOutlineBoardStore.getState().openChapterId).toBe("ch1");
    expect(useOutlineBoardStore.getState().chapterView).toBe("guide");
  });

  it("switches between manual editing and guided planning inside a chapter", () => {
    useOutlineBoardStore.getState().openChapter("ch1");
    useOutlineBoardStore.getState().setChapterView("guide");
    expect(useOutlineBoardStore.getState().chapterView).toBe("guide");
  });

  it("closeChapter clears openChapterId to null", () => {
    useOutlineBoardStore.getState().openChapter("ch1");
    useOutlineBoardStore.getState().closeChapter();
    expect(useOutlineBoardStore.getState().openChapterId).toBeNull();
  });
});
