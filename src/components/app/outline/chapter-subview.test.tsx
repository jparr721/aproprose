// @vitest-environment happy-dom
//
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChapterSubview } from "@/components/app/outline/chapter-subview";
import { useProjectStore } from "@/stores/project-store";
import { useOutlineBoardStore } from "@/stores/outline-board-store";

afterEach(() => cleanup());

beforeEach(() => {
  useOutlineBoardStore.setState({ openChapterId: "ch1" } as never);
  useProjectStore.setState({
    project: {
      root: "/x", name: "n", mainFile: "m", title: null, author: null,
      metadata: { title: "", subtitle: "", author: "", publisher: "", isbn: "" },
      chapters: [{ id: "ch1", label: "1", title: "What the Letter Said", file: "a.tex", wordCount: 1840 }],
    },
    meta: {
      characters: [], lore: [], statuses: {}, outline: { premise: "" },
      chapters: { ch1: { act: "setup", plotPoint: "inciting", premise: "", goal: "", conflict: "", turn: "", characterIds: [], cards: [] } },
    },
  } as never);
});

describe("ChapterSubview", () => {
  it("shows the breadcrumb + chapter title and edits the goal", () => {
    render(<ChapterSubview />);
    expect(screen.getByText("Storyboard")).toBeTruthy();
    expect(screen.getByDisplayValue("What the Letter Said")).toBeTruthy();
    const goal = screen.getByPlaceholderText(/what does this chapter set up/i);
    fireEvent.change(goal, { target: { value: "Win" } });
    expect(useProjectStore.getState().meta.chapters.ch1.goal).toBe("Win");
  });
  it("adds a card", () => {
    render(<ChapterSubview />);
    fireEvent.click(screen.getByRole("button", { name: /add card/i }));
    expect(useProjectStore.getState().meta.chapters.ch1.cards).toHaveLength(1);
  });
});
