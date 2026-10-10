// @vitest-environment happy-dom
//
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const inference = vi.hoisted(() => ({
  getModel: vi.fn<() => Promise<LanguageModel>>(),
  stream: vi.fn<(input: StreamAgentRunInput) => Promise<StreamAgentRunResult>>(),
}));

vi.mock("@/lib/ai/model", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai/model")>(),
  getModel: inference.getModel,
}));

vi.mock("@/lib/ai/models", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai/models")>(),
  listTextModels: async () => ["review-test-model"],
  resolveModelContextWindow: async () => 128_000,
}));

vi.mock("@/lib/ai/agent-runtime", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai/agent-runtime")>(),
  streamAgentRun: inference.stream,
}));

const tauri = vi.hoisted(() => ({
  readAppData: vi.fn(),
  writeAppData: vi.fn(),
  readTextFile: vi.fn(),
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
  readTextFile: tauri.readTextFile,
  appendAgentFailureLog: async () => undefined,
  getAiKeyStatus: async () => ({ status: "configured" }),
}));

import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModel } from "ai";
import type { StreamAgentRunInput, StreamAgentRunResult } from "@/lib/ai/agent-runtime";
import * as controller from "@/lib/ai/agent-controller";
import { SettingsDialog } from "@/components/app/settings-dialog";
import { useSettingsStore } from "@/stores/settings-store";
import { SETTINGS_TABS, useSettingsDialogStore } from "@/stores/settings-dialog-store";
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

const agent = {
  submitAgentRequest: vi.spyOn(controller, "submitAgentRequest"),
  stopAgentRun: vi.spyOn(controller, "stopAgentRun"),
};

function questionResult(input: StreamAgentRunInput): StreamAgentRunResult {
  return {
    message: {
      id: input.generateMessageId(),
      role: "assistant",
      metadata: {
        runId: input.run.id, mode: input.run.mode, task: input.run.task,
        state: "complete", createdAt: input.run.startedAt, failure: null, retryOf: null, usage: null,
      },
      parts: [{ type: "text", text: "What did the letter change?" }],
    },
    usage: {
      modelId: input.modelId, inputTokens: 10, outputTokens: 10, totalTokens: 20, contextWindow: input.contextWindow,
      raw: {
        inputTokens: 10, inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
        outputTokens: 10, outputTokenDetails: { textTokens: 10, reasoningTokens: 0 }, totalTokens: 20,
      },
    },
  };
}

afterEach(async () => {
  cleanup();
  await act(async () => {});
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
  agent.stopAgentRun.mockClear();
  agent.submitAgentRequest.mockClear();
  inference.getModel.mockReset().mockResolvedValue(new MockLanguageModelV3());
  inference.stream.mockReset().mockImplementation(async (input) => questionResult(input));
  tauri.readTextFile.mockReset().mockResolvedValue("The letter arrived after midnight.");
  useSettingsStore.setState({ aiProvider: "openai", aiModel: "review-test-model" });
  useSettingsDialogStore.setState({ open: false, tab: SETTINGS_TABS.APPEARANCE, aiTarget: null });
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
    activeChapterId: "ch1",
    blocks: [{ id: "p1", type: "narration", text: "The letter arrived after midnight.", raw: "The letter arrived after midnight.", dirty: false }],
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
    expect(screen.queryByText("Outline Planner")).toBeNull();
    expect(screen.queryByText("n / 1. What the Letter Said")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close Outline Planner" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Agent mode" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Manual" }));
    expect(useOutlineBoardStore.getState().chapterView).toBe("manual");
  });

  it("closes the planner through the Storyboard breadcrumb", () => {
    render(<ChapterSubview />);
    fireEvent.click(screen.getByRole("button", { name: "Plan with AI" }));

    fireEvent.click(screen.getByText("Storyboard"));

    expect(useOutlineBoardStore.getState().openChapterId).toBeNull();
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
    inference.stream.mockImplementation((input) => new Promise((resolve) => {
      input.signal.addEventListener("abort", () => resolve(questionResult(input)), { once: true });
    }));
    render(<ChapterSubview />);
    fireEvent.click(screen.getByRole("button", { name: "Plan with AI" }));
    await waitFor(() => expect(inference.stream).toHaveBeenCalledOnce());
    const session = agentSessionStore(sessionId);
    act(() => session.getState().setPersistenceIssue({ kind: "save", projectRoot: "/x", message: "Temporary write failure" }));
    act(() => session.getState().setPersistenceIssue(null));
    await act(async () => {});
    expect(session.getState().runStatus).toBe("streaming");
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

  it("recovers the automatic request through actual Settings model selection and explicit Retry without consuming the author draft", async () => {
    useSettingsStore.setState({ aiModel: null });
    render(<><ChapterSubview /><SettingsDialog /></>);
    fireEvent.click(screen.getByRole("button", { name: "Plan with AI" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Choose model" })).toBeTruthy());
    const session = agentSessionStore({ kind: "outline", chapterId: "ch1" });
    expect(session.getState().messages).toEqual([]);
    expect(inference.getModel).not.toHaveBeenCalled();
    act(() => session.getState().setDraftText("Keep my unfinished answer"));
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
    const settings = screen.getByRole("dialog", { name: "Settings" });
    await waitFor(() => expect(within(settings).getByText("Select a model")).toBeTruthy());
    fireEvent.keyDown(within(settings).getByText("Select a model"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "review-test-model" }));
    expect(useSettingsStore.getState().aiModel).toBe("review-test-model");
    fireEvent.click(within(settings).getByRole("button", { name: "Close" }));
    await act(async () => {});
    expect(agent.submitAgentRequest).toHaveBeenCalledOnce();
    expect(inference.getModel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry investigation" }));
    await waitFor(() => expect(screen.getByText("What did the letter change?")).toBeTruthy());
    expect(agent.submitAgentRequest).toHaveBeenCalledTimes(2);
    expect(agent.submitAgentRequest.mock.calls[1]).toEqual(agent.submitAgentRequest.mock.calls[0]);
    expect(inference.getModel).toHaveBeenCalledOnce();
    expect(session.getState().draftText).toBe("Keep my unfinished answer");
    expect(screen.getByDisplayValue("Keep my unfinished answer")).toBeTruthy();
    expect(session.getState().messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(screen.queryByRole("button", { name: "Retry investigation" })).toBeNull();
    expect(agent.stopAgentRun).not.toHaveBeenCalled();
  });

  it("retries an empty preflight source failure once across repeated clicks and preserves draft text", async () => {
    useProjectStore.setState({ activeChapterId: null, blocks: [] });
    tauri.readTextFile.mockRejectedValueOnce(new Error("Temporary chapter read failure"));
    render(<ChapterSubview />);
    fireEvent.click(screen.getByRole("button", { name: "Plan with AI" }));
    const retry = await screen.findByRole("button", { name: "Retry investigation" });
    const session = agentSessionStore({ kind: "outline", chapterId: "ch1" });
    expect(session.getState().messages).toEqual([]);
    expect(inference.getModel).not.toHaveBeenCalled();
    act(() => session.getState().setDraftText("Do not replace this answer"));
    let releaseModel!: (model: LanguageModel) => void;
    inference.getModel.mockReturnValueOnce(new Promise((resolve) => { releaseModel = resolve; }));
    act(() => { fireEvent.click(retry); fireEvent.click(retry); });
    await waitFor(() => expect(inference.getModel).toHaveBeenCalledOnce());
    expect(agent.submitAgentRequest).toHaveBeenCalledTimes(2);
    expect(session.getState().runStatus).toBe("submitted");
    expect(screen.queryByRole("button", { name: "Retry investigation" })).toBeNull();
    await act(async () => releaseModel(new MockLanguageModelV3()));
    await waitFor(() => expect(screen.getByText("What did the letter change?")).toBeTruthy());
    expect(tauri.readTextFile).toHaveBeenCalledTimes(2);
    expect(inference.stream).toHaveBeenCalledOnce();
    expect(session.getState().draftText).toBe("Do not replace this answer");
  });

  it("does not loop an empty preflight error and permits an explicit Manual-to-Plan reentry", async () => {
    useSettingsStore.setState({ aiModel: null });
    render(<ChapterSubview />);
    fireEvent.click(screen.getByRole("button", { name: "Plan with AI" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Choose model" })).toBeTruthy());
    await act(async () => {});
    expect(agent.submitAgentRequest).toHaveBeenCalledOnce();
    act(() => { useSettingsStore.getState().setAiModel("review-test-model"); });
    await act(async () => {});
    expect(agent.submitAgentRequest).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Manual" }));
    await screen.findByDisplayValue("What the Letter Said");
    fireEvent.click(screen.getByRole("button", { name: "Plan with AI" }));
    await waitFor(() => expect(screen.getByText("What did the letter change?")).toBeTruthy());
    expect(agent.submitAgentRequest).toHaveBeenCalledTimes(2);
    expect(inference.getModel).toHaveBeenCalledOnce();
  });

  it("cancels an explicitly retried preflight on navigation before model resolution", async () => {
    useSettingsStore.setState({ aiModel: null });
    render(<ChapterSubview />);
    fireEvent.click(screen.getByRole("button", { name: "Plan with AI" }));
    const retry = await screen.findByRole("button", { name: "Retry investigation" });
    act(() => { useSettingsStore.getState().setAiModel("review-test-model"); });
    let releaseModel!: (model: LanguageModel) => void;
    inference.getModel.mockReturnValueOnce(new Promise((resolve) => { releaseModel = resolve; }));
    fireEvent.click(retry);
    await waitFor(() => expect(inference.getModel).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Manual" }));
    await act(async () => releaseModel(new MockLanguageModelV3()));
    expect(agent.stopAgentRun).toHaveBeenCalledTimes(1);
    expect(inference.stream).not.toHaveBeenCalled();
    expect(agentSessionStore({ kind: "outline", chapterId: "ch1" }).getState().messages).toEqual([]);
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
