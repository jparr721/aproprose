// @vitest-environment happy-dom
//
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { OutlineBoard } from "@/components/app/outline/outline-board";
import { useProjectStore } from "@/stores/project-store";
import { useOutlineBoardStore } from "@/stores/outline-board-store";

beforeEach(() => {
  useOutlineBoardStore.setState({ openChapterId: null, proposal: null } as never);
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
