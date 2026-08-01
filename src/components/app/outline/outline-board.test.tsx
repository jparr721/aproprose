// @vitest-environment happy-dom
//
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentIntent } from "@/lib/ai/agent-types";

const controller = vi.hoisted(() => ({
  dispatchAgentIntent: vi.fn<(intent: AgentIntent) => Promise<void>>(),
}));

vi.mock("@/lib/ai/agent-controller", () => ({
  dispatchAgentIntent: controller.dispatchAgentIntent,
}));

import { OutlineBoard } from "@/components/app/outline/outline-board";
import { useProjectStore } from "@/stores/project-store";
import { useOutlineBoardStore } from "@/stores/outline-board-store";
import { useViewStore } from "@/stores/view-store";

afterEach(() => cleanup());

beforeEach(() => {
  controller.dispatchAgentIntent.mockReset().mockImplementation(async () => {
    useViewStore.getState().openAiConsole();
  });
  useViewStore.setState({ aiOpen: false, focus: false });
  useOutlineBoardStore.setState({
    openChapterId: null,
    highlightedCardId: null,
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

describe("BoardChapterColumn Sculpt", () => {
  it("dispatches an immediate Edit run and keeps the board visible", () => {
    render(<OutlineBoard />);

    fireEvent.click(screen.getAllByRole("button", { name: "Sculpt" })[0]);

    expect(controller.dispatchAgentIntent).toHaveBeenCalledWith({
      kind: "run",
      mode: "edit",
      text: "Review and reshape this chapter outline for clarity, causality, pacing, and escalation.",
      refs: [],
      task: { kind: "outline-sculpt", chapterId: "ch1" },
    });
    expect(useViewStore.getState().aiOpen).toBe(true);
    expect(screen.getByText("Quiet Town")).toBeTruthy();
  });

  it("does not render the legacy full-board proposal overlay", () => {
    useOutlineBoardStore.setState({
      sculptingChapterId: "ch1",
      proposal: {
        chapterId: "ch1",
        summary: "Legacy overlay",
        changes: [],
      },
    });

    render(<OutlineBoard />);

    expect(screen.queryByText("Legacy overlay")).toBeNull();
    expect(screen.queryByText("Reshape Quiet Town")).toBeNull();
    expect(screen.getByText("Quiet Town")).toBeTruthy();
  });

  it("does not render legacy per-column model errors or refresh controls", () => {
    useOutlineBoardStore.setState({
      sculptingChapterId: "ch1",
      sculptError: "HTTP 401 bad key",
    });

    render(<OutlineBoard />);

    expect(screen.queryByText("HTTP 401 bad key")).toBeNull();
    expect(screen.queryByText("Try again")).toBeNull();
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
