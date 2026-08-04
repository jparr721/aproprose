// @vitest-environment happy-dom
//
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const agent = vi.hoisted(() => ({
  hydrateAgentOutlineSession: vi.fn(),
  stopAgentRun: vi.fn(),
}));

vi.mock("@/lib/ai/agent-controller", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/agent-controller")>();
  return { ...actual, stopAgentRun: agent.stopAgentRun };
});

vi.mock("@/stores/agent-persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/agent-persistence")>();
  return {
    ...actual,
    hydrateAgentOutlineSession: agent.hydrateAgentOutlineSession,
  };
});

import { ChapterSubview } from "@/components/app/outline/chapter-subview";
import { EMPTY_AGENT_STATE, useAgentConsoleStore } from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useOutlineBoardStore } from "@/stores/outline-board-store";

afterEach(() => cleanup());

beforeEach(() => {
  agent.hydrateAgentOutlineSession.mockReset();
  agent.hydrateAgentOutlineSession.mockResolvedValue(undefined);
  agent.stopAgentRun.mockReset();
  useAgentConsoleStore.setState({
    ...EMPTY_AGENT_STATE,
    messages: [],
    draftContextRefs: [],
    draftContextSources: {},
    draftSourceLocators: {},
    draftText: "project draft",
  });
  useOutlineBoardStore.setState({
    openChapterId: "ch1",
    chapterView: "manual",
    highlightedCardId: null,
  });
  useProjectStore.setState({
    project: {
      root: "/x", name: "n", mainFile: "m", title: null, author: null,
      metadata: { title: "", subtitle: "", author: "", publisher: "", isbn: "" },
      chapters: [{ id: "ch1", label: "1", title: "What the Letter Said", file: "a.tex", wordCount: 1840 }],
    },
    meta: {
      characters: [], lore: [], statuses: {}, outline: { premise: "", overview: "" },
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

  it("opens prompt-led planning inside the chapter view", () => {
    render(<ChapterSubview />);

    fireEvent.click(screen.getByRole("button", { name: "Plan with AI" }));
    expect(useOutlineBoardStore.getState().chapterView).toBe("planner");
    expect(screen.getByRole("region", { name: "Outline Planner" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Agent mode" })).toBeNull();
  });

  it("aborts only the planner run when returning to manual planning", () => {
    render(<ChapterSubview />);
    fireEvent.click(screen.getByRole("button", { name: "Plan with AI" }));
    fireEvent.click(screen.getByRole("button", { name: "Manual" }));

    expect(agent.stopAgentRun).toHaveBeenCalledWith({
      kind: "outline",
      chapterId: "ch1",
    });
    expect(useAgentConsoleStore.getState().draftText).toBe("project draft");
  });
});
