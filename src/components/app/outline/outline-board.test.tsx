// @vitest-environment happy-dom
//
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OutlineBoard } from "@/components/app/outline/outline-board";
import { useProjectStore } from "@/stores/project-store";
import { useOutlineBoardStore } from "@/stores/outline-board-store";

afterEach(() => cleanup());

beforeEach(() => {
  useOutlineBoardStore.setState({
    openChapterId: null,
    proposal: null,
    decisions: {},
    sculptingChapterId: null,
    sculptError: null,
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
      characters: [], lore: [], statuses: {}, outline: { premise: "" },
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
});

describe("BoardChapterColumn sculpt states", () => {
  it("renders the sculpt error next to the failed chapter's Sculpt trigger", () => {
    useOutlineBoardStore.setState({ sculptingChapterId: "ch1", sculptError: "HTTP 401 bad key" });
    render(<OutlineBoard />);
    expect(screen.getByText("HTTP 401 bad key")).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("shows a spinner and disables only the sculpting chapter's button while in flight", () => {
    useOutlineBoardStore.setState({ sculptingChapterId: "ch1", proposal: null, sculptError: null });
    const { container } = render(<OutlineBoard />);
    const sculptButtons = screen.getAllByRole("button", { name: /Sculpt/ });
    expect(sculptButtons[0].hasAttribute("disabled")).toBe(true);
    expect(sculptButtons[1].hasAttribute("disabled")).toBe(false);
    expect(container.querySelector('svg[data-slot="spinner"]')).toBeTruthy();
  });

  it("shows neither spinner nor error when idle", () => {
    const { container } = render(<OutlineBoard />);
    expect(container.querySelector('svg[data-slot="spinner"]')).toBeNull();
    expect(screen.queryByText("Try again")).toBeNull();
  });
});
