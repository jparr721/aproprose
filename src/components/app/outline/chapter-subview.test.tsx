// @vitest-environment happy-dom
//
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const agent = vi.hoisted(() => ({
  stopAgentRun: vi.fn(),
  submitAgentRequest: vi.fn(),
}));

vi.mock("@/lib/ai/agent-controller", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/agent-controller")>();
  return { ...actual, stopAgentRun: agent.stopAgentRun, submitAgentRequest: agent.submitAgentRequest };
});

const tauri = vi.hoisted(() => ({
  readAppData: vi.fn(),
  writeAppData: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/tauri")>(),
  readAppData: tauri.readAppData,
  writeAppData: tauri.writeAppData,
  writeProjectMeta: async () => undefined,
}));

import { ChapterSubview } from "@/components/app/outline/chapter-subview";
import { EMPTY_META } from "@/lib/migration";
import { emptyProjectKnowledge } from "@/lib/story-knowledge/model";
import { agentConsoleOwnershipStatus, agentSessionStore, clearOutlineAgentSessions, EMPTY_AGENT_STATE, useAgentConsoleStore } from "@/stores/agent-console-store";
import {
  agentSessionCollectionKey,
  emptyPersistedAgentState,
  retryAgentPersistence,
  transitionAgentProject,
} from "@/stores/agent-persistence";
import type { AgentUIMessage } from "@/lib/ai/agent-types";
import { useProjectStore } from "@/stores/project-store";
import { useOutlineBoardStore } from "@/stores/outline-board-store";

afterEach(async () => {
  cleanup();
  tauri.writeAppData.mockResolvedValue(undefined);
  await retryAgentPersistence();
  await transitionAgentProject(null);
});

beforeEach(() => {
  clearOutlineAgentSessions();
  tauri.readAppData.mockReset();
  tauri.readAppData.mockResolvedValue(null);
  tauri.writeAppData.mockReset();
  tauri.writeAppData.mockResolvedValue(undefined);
  agent.stopAgentRun.mockReset();
  agent.submitAgentRequest.mockReset();
  agent.submitAgentRequest.mockResolvedValue({ status: "success" });
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
      ...EMPTY_META,
      characters: [], lore: [], statuses: {}, outline: { premise: "", overview: "" },
      chapters: { ch1: { act: "setup", plotPoint: "inciting", premise: "", goal: "", conflict: "", turn: "", characterIds: [], cards: [] } },
      knowledge: emptyProjectKnowledge(),
    },
  });
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

  it("opens planning inside the chapter view", () => {
    render(<ChapterSubview />);

    fireEvent.click(screen.getByRole("button", { name: "Plan with AI" }));
    expect(useOutlineBoardStore.getState().chapterView).toBe("planner");
    expect(screen.getByRole("region", { name: "Outline Planner" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Agent mode" })).toBeNull();
  });

  it("starts a chapter investigation after hydration without requiring a starter prompt", async () => {
    render(<ChapterSubview />);
    fireEvent.click(screen.getByRole("button", { name: "Plan with AI" }));

    await waitFor(() => expect(agent.submitAgentRequest).toHaveBeenCalledTimes(1));
    expect(agent.submitAgentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "run",
        task: { kind: "outline-sculpt", chapterId: "ch1" },
        refs: [],
      }),
      { kind: "outline", chapterId: "ch1" },
    );
  });

  it("starts exactly one investigation after actual scoped Retry recovers an empty conversation and preserves its draft", async () => {
    await transitionAgentProject("/x");
    tauri.readAppData.mockRejectedValueOnce(new Error("Temporary collection read failure"));
    render(<ChapterSubview />);
    fireEvent.click(screen.getByRole("button", { name: "Plan with AI" }));
    await waitFor(() => expect(screen.getByText("AI conversation could not be loaded.")).toBeTruthy());
    expect(agent.submitAgentRequest).not.toHaveBeenCalled();
    const session = agentSessionStore({ kind: "outline", chapterId: "ch1" });
    expect(agentConsoleOwnershipStatus(session.getState(), "/x")).toBe("unavailable");
    tauri.readAppData.mockResolvedValue({
      v: 1,
      sessions: { "outline:ch1": { ...emptyPersistedAgentState(), draftText: "Preserve my unfinished answer" } },
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(agentConsoleOwnershipStatus(session.getState(), "/x")).toBe("ready"));
    expect(session.getState().persistenceIssue).toBeNull();
    expect(screen.queryByText("Loading AI conversation")).toBeNull();
    await waitFor(() => expect(agent.submitAgentRequest).toHaveBeenCalledTimes(1));
    expect(screen.getByDisplayValue("Preserve my unfinished answer")).toBeTruthy();
    expect(session.getState().draftText).toBe("Preserve my unfinished answer");
    expect(agent.stopAgentRun).not.toHaveBeenCalled();
    expect(tauri.readAppData).toHaveBeenLastCalledWith(agentSessionCollectionKey("/x"));
  });

  it("waits for normal scoped hydration and does not duplicate its initial investigation", async () => {
    let release!: (value: unknown) => void;
    const loading = new Promise<unknown>((resolve) => { release = resolve; });
    tauri.readAppData.mockReturnValueOnce(loading);
    render(<ChapterSubview />);
    fireEvent.click(screen.getByRole("button", { name: "Plan with AI" }));
    await waitFor(() => expect(tauri.readAppData).toHaveBeenCalledOnce());
    expect(agent.submitAgentRequest).not.toHaveBeenCalled();
    expect(screen.getByText("Loading AI conversation")).toBeTruthy();
    await act(async () => release(null));
    await waitFor(() => expect(agent.submitAgentRequest).toHaveBeenCalledOnce());
    act(() => {
      agentSessionStore({ kind: "outline", chapterId: "ch1" }).getState().setDraftText("My next answer");
      useProjectStore.setState((state) => ({ compile: { ...state.compile, pdfBase64: "updated" } }));
    });
    expect(agent.submitAgentRequest).toHaveBeenCalledOnce();
    expect(agent.stopAgentRun).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("My next answer")).toBeTruthy();
  });

  it.each(["messages", "summary"] as const)("resumes recovered %s instead of starting another investigation", async (history) => {
    await transitionAgentProject("/x");
    tauri.readAppData.mockRejectedValueOnce(new Error("Temporary collection read failure"));
    render(<ChapterSubview />);
    fireEvent.click(screen.getByRole("button", { name: "Plan with AI" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    const message: AgentUIMessage = {
      id: "question-1", role: "assistant",
      metadata: {
        runId: "previous-run", mode: "edit", task: { kind: "outline-sculpt", chapterId: "ch1" },
        state: "complete", createdAt: "2026-10-08T00:00:00.000Z", failure: null, retryOf: null, usage: null,
      },
      parts: [{ type: "text", text: "What did the letter change?" }],
    };
    const saved = {
      ...emptyPersistedAgentState(),
      draftText: "My existing answer",
      messages: history === "messages" ? [message] : [],
      summary: history === "summary" ? { text: "Keep the existing investigation", throughMessageId: message.id } : null,
    };
    tauri.readAppData.mockResolvedValue({ v: 1, sessions: { "outline:ch1": saved } });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByDisplayValue("My existing answer")).toBeTruthy());
    await act(async () => {});
    expect(agent.submitAgentRequest).not.toHaveBeenCalled();
    if (history === "messages") expect(screen.getByText("What did the letter change?")).toBeTruthy();
    expect(agentSessionStore({ kind: "outline", chapterId: "ch1" }).getState().summary).toEqual(saved.summary);
  });

  it("does not stop an investigation when persistence readiness changes during its run", async () => {
    const sessionId = { kind: "outline" as const, chapterId: "ch1" };
    agent.submitAgentRequest.mockImplementation(async () => {
      agentSessionStore(sessionId).getState().beginPreflight();
      return { status: "success" };
    });
    render(<ChapterSubview />);
    fireEvent.click(screen.getByRole("button", { name: "Plan with AI" }));
    await waitFor(() => expect(agent.submitAgentRequest).toHaveBeenCalledOnce());
    const session = agentSessionStore(sessionId);
    act(() => session.getState().setPersistenceIssue({ kind: "save", projectRoot: "/x", message: "Temporary write failure" }));
    act(() => session.getState().setPersistenceIssue(null));
    await act(async () => {});
    expect(session.getState().runStatus).toBe("submitted");
    expect(agent.submitAgentRequest).toHaveBeenCalledOnce();
    expect(agent.stopAgentRun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Manual" }));
    expect(agent.stopAgentRun).toHaveBeenCalledTimes(1);
  });

  it.each(["manual", "chapter", "project", "unmount"] as const)("cancels pending hydration on %s navigation before it can start", async (navigation) => {
    let release!: (value: unknown) => void;
    const loading = new Promise<unknown>((resolve) => { release = resolve; });
    tauri.readAppData.mockReturnValueOnce(loading);
    const view = render(<ChapterSubview />);
    fireEvent.click(screen.getByRole("button", { name: "Plan with AI" }));
    await waitFor(() => expect(tauri.readAppData).toHaveBeenCalledOnce());
    act(() => {
      switch (navigation) {
        case "manual": useOutlineBoardStore.getState().showManual(); break;
        case "chapter": useOutlineBoardStore.getState().openChapter("another-chapter"); break;
        case "project": useProjectStore.setState({ project: null }); break;
        case "unmount": view.unmount(); break;
      }
    });
    await act(async () => release(null));
    expect(agent.submitAgentRequest).not.toHaveBeenCalled();
    expect(agent.stopAgentRun).toHaveBeenCalledTimes(1);
    expect(agent.stopAgentRun).toHaveBeenCalledWith({ kind: "outline", chapterId: "ch1" });
    expect(useAgentConsoleStore.getState().draftText).toBe("project draft");
  });

  it("aborts only the planner run when returning to manual planning", () => {
    render(<ChapterSubview />);
    fireEvent.click(screen.getByRole("button", { name: "Plan with AI" }));
    fireEvent.click(screen.getByRole("button", { name: "Manual" }));

    expect(agent.stopAgentRun).toHaveBeenCalledTimes(1);
    expect(agent.stopAgentRun).toHaveBeenCalledWith({
      kind: "outline",
      chapterId: "ch1",
    });
    expect(useAgentConsoleStore.getState().draftText).toBe("project draft");
  });
});
