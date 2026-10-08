// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChapterList } from "@/components/app/chapter-list";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { ProjectInfo } from "@/lib/types";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

const project: ProjectInfo = {
  root: "/book",
  name: "Book",
  mainFile: "main.tex",
  title: "Book",
  author: "Author",
  metadata: { title: "Book", subtitle: "", author: "Author", publisher: "", isbn: "" },
  chapters: Array.from({ length: 3 }, (_, index) => ({
    id: `ch${index + 1}`,
    label: String(index + 1),
    title: `Chapter ${index + 1}`,
    file: `chapter-${index + 1}.tex`,
    wordCount: 10,
  })),
};
const moveChapter = vi.fn(async (_id: string, _toIndex: number): Promise<void> => undefined);
const selectChapter = vi.fn(async (_id: string): Promise<void> => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({ project, activeChapterId: "ch2", chapterDirty: false, moveChapter, selectChapter });
  useViewStore.setState({ pending: null });
});

afterEach(() => {
  useViewStore.getState().cancelPending();
  cleanup();
  vi.restoreAllMocks();
});

describe("ChapterList", () => {
  it("guards sidebar Add before replacing a dirty draft", () => {
    useProjectStore.setState({
      chapterDirty: true,
      remoteDivergence: null,
      blocks: [{ id: "draft", type: "narration", text: "Keep this draft", raw: "", dirty: true }],
    });
    render(<SidebarProvider><ChapterList /></SidebarProvider>);

    fireEvent.click(screen.getByTitle("Add chapter"));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Four" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(useViewStore.getState().pending).not.toBeNull();
    expect(useProjectStore.getState().activeChapterId).toBe("ch2");
    expect(useProjectStore.getState().blocks[0].text).toBe("Keep this draft");
    expect(useProjectStore.getState().project?.chapters).toHaveLength(3);
  });

  it("selects a chapter on a normal click", () => {
    render(<SidebarProvider><ChapterList /></SidebarProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Chapter 1" }));

    expect(selectChapter).toHaveBeenCalledWith("ch1");
    expect(moveChapter).not.toHaveBeenCalled();
  });

  it("keeps the unsaved-edit guard for chapter selection", () => {
    useProjectStore.setState({ chapterDirty: true });
    render(<SidebarProvider><ChapterList /></SidebarProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Chapter 1" }));

    expect(selectChapter).not.toHaveBeenCalled();
    expect(useViewStore.getState().pending).not.toBeNull();
  });

  it("reorders through the keyboard without selecting another chapter", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement): DOMRect {
      const rows = Array.from(document.querySelectorAll('[data-sidebar="menu-item"]'));
      const row = this.closest('[data-sidebar="menu-item"]');
      const index = row ? rows.indexOf(row) : 0;
      return new DOMRect(0, index * 32, 256, 32);
    });
    render(<SidebarProvider><ChapterList /></SidebarProvider>);
    const chapter = screen.getByRole("button", { name: "Chapter 1" });
    chapter.focus();

    fireEvent.keyDown(chapter, { code: "Space" });
    await waitFor(() => expect(chapter.getAttribute("aria-pressed")).toBe("true"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.keyDown(document, { code: "ArrowDown" });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("droppable area ch2"));
    fireEvent.keyDown(document, { code: "Space" });

    await waitFor(() => expect(moveChapter).toHaveBeenCalledWith("ch1", 1));
    expect(selectChapter).not.toHaveBeenCalled();
  });
});
