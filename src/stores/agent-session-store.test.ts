import { beforeEach, describe, expect, it } from "vitest";
import type {
  AgentSessionId,
  AgentUIMessage,
  PersistedUsage,
} from "@/lib/ai/agent-types";
import { PROJECT_AGENT_SESSION } from "@/lib/ai/agent-types";
import {
  agentSessionStore,
  clearOutlineAgentSessions,
  useAgentConsoleStore,
  useAgentRunCoordinatorStore,
} from "@/stores/agent-console-store";
import { emptyPersistedAgentState } from "@/stores/agent-persistence";

const root = "/book";

function message(id: string): AgentUIMessage {
  return {
    id,
    role: "user",
    metadata: {
      runId: id,
      mode: "writing",
      task: { kind: "conversation", targetChapterId: null },
      state: "complete",
      createdAt: "2026-08-04T00:00:00.000Z",
      failure: null,
      retryOf: null,
      usage: null,
    },
    parts: [{ type: "text", text: id }],
  };
}

const usage: PersistedUsage = {
  modelId: "gpt-4.1",
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  contextWindow: 1000,
  raw: {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
  },
};

function hydrate(sessionId: AgentSessionId): void {
  agentSessionStore(sessionId).getState().hydrate(root, emptyPersistedAgentState());
}

describe("agent sessions", () => {
  beforeEach(() => {
    clearOutlineAgentSessions();
    useAgentConsoleStore.getState().resetProject();
    useAgentRunCoordinatorStore.setState({ activeSessionKey: null });
    hydrate(PROJECT_AGENT_SESSION);
  });

  it("isolates project and per-chapter conversation state", () => {
    const first = { kind: "outline" as const, chapterId: "chapter-1" };
    const second = { kind: "outline" as const, chapterId: "chapter-2" };
    hydrate(first);
    hydrate(second);

    const project = agentSessionStore(PROJECT_AGENT_SESSION);
    const firstStore = agentSessionStore(first);
    const secondStore = agentSessionStore(second);

    project.getState().setDraftText("project draft");
    project.getState().appendLocalMessage(message("project-message"));
    firstStore.getState().setDraftText("first draft");
    firstStore.getState().setSummary({
      text: "first summary",
      throughMessageId: "first-message",
    });
    firstStore.getState().appendLocalMessage(message("first-message"));
    firstStore.getState().setDraftContextRefs([
      { kind: "outline-card", chapterId: "chapter-1", cardId: "card-1" },
    ]);
    firstStore.getState().replacePendingProposal({
      id: "proposal-1",
      kind: "overview",
      projectRoot: root,
      chapterId: null,
      summary: "Update the overview",
      createdAt: "2026-08-04T00:00:00.000Z",
      originatingMessageId: "first-message",
      changes: [],
      overviewChange: {
        id: "overview-1",
        before: "Before",
        after: "After",
        reason: "The direction changed",
        sourceFingerprint: "source",
      },
    });
    firstStore.setState({
      lastUsage: usage,
      interruptedRun: {
        runId: "run-1",
        userMessageId: "first-message",
        assistantMessageId: null,
        reason: "stopped",
        interruptedAt: "2026-08-04T00:01:00.000Z",
      },
    });
    secondStore.getState().setDraftText("second draft");
    secondStore.getState().appendLocalMessage(message("second-message"));

    expect(project.getState()).toMatchObject({
      draftText: "project draft",
      messages: [expect.objectContaining({ id: "project-message" })],
      summary: null,
      lastUsage: null,
      draftContextRefs: [],
      pendingProposal: null,
      interruptedRun: null,
    });
    expect(firstStore.getState()).toMatchObject({
      draftText: "first draft",
      messages: [expect.objectContaining({ id: "first-message" })],
      summary: { text: "first summary", throughMessageId: "first-message" },
      lastUsage: usage,
      draftContextRefs: [
        { kind: "outline-card", chapterId: "chapter-1", cardId: "card-1" },
      ],
      pendingProposal: expect.objectContaining({ id: "proposal-1" }),
      interruptedRun: expect.objectContaining({ runId: "run-1" }),
    });
    expect(secondStore.getState()).toMatchObject({
      draftText: "second draft",
      messages: [expect.objectContaining({ id: "second-message" })],
      summary: null,
      lastUsage: null,
      draftContextRefs: [],
      pendingProposal: null,
      interruptedRun: null,
    });
  });

  it("allows only one active model run across sessions", () => {
    const first = { kind: "outline" as const, chapterId: "chapter-1" };
    const second = { kind: "outline" as const, chapterId: "chapter-2" };
    hydrate(first);

    expect(useAgentRunCoordinatorStore.getState().begin(first)).toBe(true);
    agentSessionStore(first).getState().beginPreflight();
    expect(useAgentRunCoordinatorStore.getState().begin(second)).toBe(false);
    expect(useAgentRunCoordinatorStore.getState().begin(PROJECT_AGENT_SESSION)).toBe(false);

    agentSessionStore(first).setState({ runStatus: "idle" });
    useAgentRunCoordinatorStore.getState().finish(first);
    expect(useAgentRunCoordinatorStore.getState().begin(second)).toBe(true);
  });
});
