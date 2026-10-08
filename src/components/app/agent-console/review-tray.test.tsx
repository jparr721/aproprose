// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/storage", () => ({ tauriStateStorage: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined } }));
import { ReviewTray } from "@/components/app/agent-console/review-tray";
import type { AgentSessionId, OverviewPendingProposal } from "@/lib/ai/agent-types";
import { EMPTY_AGENT_STATE, agentSessionStore, clearOutlineAgentSessions, useAgentConsoleStore } from "@/stores/agent-console-store";
import { useViewStore } from "@/stores/view-store";

const proposal: OverviewPendingProposal = {
  id: "overview-1",
  kind: "overview",
  projectRoot: "/book",
  chapterId: null,
  summary: "Sharpen the story overview",
  createdAt: "2026-10-08T00:00:00.000Z",
  originatingMessageId: "assistant-1",
  changes: [],
  overviewChange: { id: "overview-change", before: "Old overview", after: "New overview", reason: "Focus the stakes", sourceFingerprint: "overview-fingerprint" },
};

beforeEach(() => {
  clearOutlineAgentSessions();
  useAgentConsoleStore.setState({ ...EMPTY_AGENT_STATE, pendingProposal: proposal });
  useViewStore.setState({ aiOpen: true, changesOpen: false, selectedChange: null, manuscriptReviewProposalId: null });
});
afterEach(cleanup);

describe("ReviewTray Changes handoff", () => {
  it("shows one compact review link without duplicating preview or decision controls", () => {
    render(<ReviewTray />);
    expect(screen.getByText(proposal.summary)).toBeTruthy();
    expect(screen.getByText("1 change ready for review")).toBeTruthy();
    expect(screen.queryByText("Old overview")).toBeNull();
    expect(screen.queryByText("New overview")).toBeNull();
    expect(screen.queryByRole("button", { name: /Accept|Reject|Apply|Dismiss/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(useViewStore.getState()).toMatchObject({ changesOpen: true, aiOpen: false, selectedChange: { sessionKey: "project", proposalId: proposal.id }, manuscriptReviewProposalId: null });
    expect(useAgentConsoleStore.getState().pendingProposal).toBe(proposal);
  });

  it("routes an outline session to its exact Changes scope", () => {
    const sessionId: AgentSessionId = { kind: "outline", chapterId: "chapter-2" };
    agentSessionStore(sessionId).setState({ ...EMPTY_AGENT_STATE, pendingProposal: proposal });
    render(<ReviewTray sessionId={sessionId} />);
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(useViewStore.getState().selectedChange).toEqual({ sessionKey: "outline:chapter-2", proposalId: proposal.id });
  });

  it("keeps the same compact tray through unrelated transcript updates", () => {
    const { container } = render(<ReviewTray />);
    const tray = container.querySelector("[data-agent-review-tray]");
    act(() => useAgentConsoleStore.setState({ messages: [] }));
    expect(container.querySelector("[data-agent-review-tray]")).toBe(tray);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("renders nothing after the current conversation target is exhausted", () => {
    useAgentConsoleStore.setState({ pendingProposal: null });
    const { container } = render(<ReviewTray />);
    expect(container.childElementCount).toBe(0);
  });
});
