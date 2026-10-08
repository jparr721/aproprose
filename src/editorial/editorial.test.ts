import { describe, expect, it, vi } from "vitest";
import type { AgentProposalRecord, AgentUIMessage, PendingProposal } from "@/lib/ai/agent-types";
import { Editorial, type EditorialDependencies } from "@/editorial";
import { EMPTY_AGENT_STATE, type AgentConsoleData } from "@/stores/agent-console-store";

function fixture(): { editorial: Editorial; dependencies: EditorialDependencies; state: AgentConsoleData } {
  const state: AgentConsoleData = structuredClone(EMPTY_AGENT_STATE);
  const dependencies: EditorialDependencies = {
    hydrate: vi.fn(async () => {}),
    read: () => state,
    ownsProject: () => true,
    isReady: () => true,
    start: vi.fn(async () => {
      state.runStatus = "submitted";
      return { status: "success" };
    }),
  };
  return { editorial: new Editorial(dependencies), dependencies, state };
}

const message: AgentUIMessage = { id: "previous-question", role: "assistant", parts: [{ type: "text", text: "Previous question" }] };
const proposal: PendingProposal = {
  id: "previous-proposal", kind: "outline", projectRoot: "/book", chapterId: "one",
  summary: "Existing plan", createdAt: "2026-10-08T00:00:00.000Z", originatingMessageId: message.id, changes: [],
};
const record: AgentProposalRecord = { proposal, source: { kind: "legacy" }, decisions: {}, replacedByProposalId: null };

describe("Editorial chapter investigation", () => {
  it("hydrates before starting once and preserves composer text", async () => {
    const { editorial, dependencies, state } = fixture();
    state.draftText = "My unfinished answer";
    const input = { projectRoot: "/book", chapterId: "one", signal: new AbortController().signal };
    await Promise.all([editorial.investigateChapter(input), editorial.investigateChapter(input)]);
    expect(dependencies.start).toHaveBeenCalledOnce();
    expect(state.draftText).toBe("My unfinished answer");
  });

  it("allows explicit recovery of an empty preflight failure without consuming the composer", async () => {
    const { editorial, dependencies, state } = fixture();
    state.runError = { reason: "model-unselected", message: "Choose a model", action: "choose-model", settingsTarget: "model" };
    state.draftText = "My unfinished answer";
    expect(await editorial.investigateChapter({ projectRoot: "/book", chapterId: "one", signal: new AbortController().signal })).toEqual({ kind: "started", outcome: { status: "success" } });
    expect(dependencies.start).toHaveBeenCalledOnce();
    expect(state.draftText).toBe("My unfinished answer");
  });

  it.each([
    ["messages", { messages: [message] }],
    ["summary", { summary: { text: "Keep previous decisions", throughMessageId: message.id } }],
    ["pending proposal", { pendingProposal: proposal }],
    ["retained proposals", { proposalRecords: [record] }],
    ["interrupted run", { interruptedRun: { runId: "old-run", userMessageId: "old-request", assistantMessageId: null, reason: "stopped", interruptedAt: "2026-10-08T00:00:00.000Z" } }],
    ["submitted run", { runStatus: "submitted" }],
    ["streaming run", { runStatus: "streaming" }],
  ] satisfies Array<[string, Partial<AgentConsoleData>]>)("resumes %s despite a run error", async (_label, retained) => {
    const { dependencies, state } = fixture();
    const recovered: AgentConsoleData = {
      ...state, ...retained,
      runError: { reason: "tool", message: "Previous source failure", action: "retry", settingsTarget: null },
    };
    const editorial = new Editorial({ ...dependencies, read: () => recovered });
    expect(await editorial.investigateChapter({ projectRoot: "/book", chapterId: "one", signal: new AbortController().signal })).toEqual({ kind: "resumed" });
    expect(dependencies.start).not.toHaveBeenCalled();
  });

  it("does not start after cancelled hydration or a project switch", async () => {
    const { editorial, dependencies } = fixture();
    const controller = new AbortController();
    dependencies.hydrate = async () => { controller.abort(); };
    expect(await editorial.investigateChapter({ projectRoot: "/book", chapterId: "one", signal: controller.signal })).toEqual({ kind: "cancelled" });
    dependencies.ownsProject = () => false;
    expect(await editorial.investigateChapter({ projectRoot: "/book", chapterId: "one", signal: new AbortController().signal })).toEqual({ kind: "cancelled" });
    expect(dependencies.start).not.toHaveBeenCalled();
  });

  it("preserves a reopened conversation and waits for persistence recovery", async () => {
    const { editorial, dependencies, state } = fixture();
    const input = { projectRoot: "/book", chapterId: "one", signal: new AbortController().signal };
    state.summary = { text: "Unanswered author question", throughMessageId: "q1" };
    expect(await editorial.investigateChapter(input)).toEqual({ kind: "resumed" });
    state.summary = null;
    dependencies.isReady = () => false;
    expect(await editorial.investigateChapter(input)).toEqual({ kind: "unavailable" });
    expect(dependencies.start).not.toHaveBeenCalled();
  });
});
