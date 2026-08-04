// @vitest-environment happy-dom
//
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OutlineBoard } from "@/components/app/outline/outline-board";
import { useProjectStore } from "@/stores/project-store";
import { useOutlineBoardStore } from "@/stores/outline-board-store";

afterEach(() => cleanup());

beforeEach(() => {
  useOutlineBoardStore.setState({
    openChapterId: null,
    chapterView: "manual",
    highlightedCardId: null,
  });
  useProjectStore.setState({
    project: {
      root: "/x", name: "n", mainFile: "m", title: null, author: null,
      metadata: { title: "", subtitle: "", author: "", publisher: "", isbn: "" },
      chapters: [
        { id: "ch1", label: "1", title: "Quiet Town", file: "a.tex", wordCount: 100 },
        { id: "ch2", label: "2", title: "The Road", file: "b.tex", wordCount: 100 },
      ],
    },
    meta: {
      characters: [], lore: [], statuses: {}, outline: { premise: "", overview: "" },
      chapters: {
        ch1: { act: "setup", plotPoint: null, premise: "", goal: "", conflict: "", turn: "", characterIds: [], cards: [] },
        ch2: { act: "confrontation", plotPoint: null, premise: "", goal: "", conflict: "", turn: "", characterIds: [], cards: [] },
      },
    },
  } as never);
});

describe("OutlineBoard", () => {
  it("renders one column per chapter grouped into act bands", () => {
    render(<OutlineBoard />);
    expect(screen.getByText("Quiet Town")).toBeTruthy();
    expect(screen.getByText("The Road")).toBeTruthy();
    expect(screen.getByText("Setup")).toBeTruthy();
    expect(screen.getByText("Confrontation")).toBeTruthy();
  });

  it("edits the story overview", () => {
    render(<OutlineBoard />);
    const overview = screen.getByPlaceholderText(/summarize the premise/i);

    fireEvent.change(overview, {
      target: { value: "A courier risks a civil war to expose the crown." },
    });

    expect(useProjectStore.getState().meta.outline.overview).toBe(
      "A courier risks a civil war to expose the crown.",
    );
  });
});

describe("BoardChapterColumn planning", () => {
  it("opens the chapter planner without starting a run", () => {
    render(<OutlineBoard />);

    fireEvent.click(screen.getAllByRole("button", { name: "Plan with AI" })[0]);

    expect(useOutlineBoardStore.getState()).toMatchObject({
      openChapterId: "ch1",
      chapterView: "planner",
    });
    expect(screen.getByText("Quiet Town")).toBeTruthy();
  });
});

describe("BoardCard agent navigation highlight", () => {
  it("marks the exact card and clears the highlight before opening its chapter", () => {
    useProjectStore.setState((state) => ({
      meta: {
        ...state.meta,
        chapters: {
          ...state.meta.chapters,
          ch1: {
            ...state.meta.chapters.ch1,
            cards: [
              {
                id: "card-1",
                title: "The letter arrives",
                intention: "Force a choice",
                characterIds: [],
                loreIds: [],
                continuityFlags: [],
              },
            ],
          },
        },
      },
    }));
    useOutlineBoardStore.setState({ highlightedCardId: "card-1" });

    const { container } = render(<OutlineBoard />);
    const card = container.querySelector('[data-outline-card-id="card-1"]');
    if (!(card instanceof HTMLElement)) {
      throw new Error("Expected the highlighted outline card.");
    }

    expect(card.className).toContain("ring-2");
    expect(card.className).toContain("ring-ring");
    fireEvent.click(card);
    expect(useOutlineBoardStore.getState().highlightedCardId).toBeNull();
    expect(useOutlineBoardStore.getState().openChapterId).toBe("ch1");
  });
});
