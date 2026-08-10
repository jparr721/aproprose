import { toast } from "sonner";
import { recordProposalEvent } from "@/lib/ai/agent-controller";
import {
  validateManuscriptChanges,
  validateOutlineChanges,
} from "@/lib/ai/agent-proposals";
import type {
  AgentOutlineApplyResult,
  AgentProposalApplyResult,
  OutlineUndoToken,
  PendingProposal,
  ProposalEventData,
} from "@/lib/ai/agent-types";
import { getChapterOutline } from "@/lib/outline/model";
import { storyOverviewFingerprint } from "@/lib/ai/agent-context";
import { PROJECT_AGENT_SESSION, type AgentSessionId } from "@/lib/ai/agent-types";
import {
  agentSessionStore,
  requireAgentSessionProject,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";

type ProposalDecisionAction = Exclude<
  ProposalEventData["action"],
  "staged"
>;

type ProposalApplyFailure = Exclude<
  AgentProposalApplyResult | AgentOutlineApplyResult,
  { status: "applied" }
>;

export class ProposalDecisionCorrelationError extends Error {
  constructor(proposal: PendingProposal, current: PendingProposal | null) {
    const currentDescription =
      current === null ? "none" : `${current.id} (${current.kind})`;
    super(
      `Cannot decide proposal ${proposal.id} (${proposal.kind}): current pending proposal is ${currentDescription}. Refresh and retry.`,
    );
    this.name = "ProposalDecisionCorrelationError";
  }
}

function currentProposalForDecision(
  proposal: PendingProposal,
  sessionId: AgentSessionId,
): PendingProposal {
  const current = agentSessionStore(sessionId).getState().pendingProposal;
  if (
    current === null ||
    current.id !== proposal.id ||
    current.kind !== proposal.kind
  ) {
    throw new ProposalDecisionCorrelationError(proposal, current);
  }
  return current;
}

function assertProposalKindExhausted(proposal: never): never {
  throw new Error(`Unsupported proposal kind: ${JSON.stringify(proposal)}`);
}

function eventText(
  kind: PendingProposal["kind"],
  action: ProposalDecisionAction,
  count: number,
): string {
  const subject =
    kind === "manuscript"
      ? "manuscript"
      : kind === "outline"
        ? "outline"
        : "story overview";
  if (action === "accepted-all") {
    return `Accepted all ${count} ${subject} changes.`;
  }
  if (action === "rejected-all") {
    return `Rejected all ${count} ${subject} changes.`;
  }
  return action === "accepted"
    ? `Accepted one ${subject} change.`
    : `Rejected one ${subject} change.`;
}

function proposalEvent(
  proposal: PendingProposal,
  action: ProposalDecisionAction,
  count: number,
): ProposalEventData {
  return {
    proposalId: proposal.id,
    action,
    changeCount: count,
    text: eventText(proposal.kind, action, count),
  };
}

function recordSessionProposalEvent(
  event: ProposalEventData,
  sessionId: AgentSessionId,
): void {
  if (sessionId.kind === "project") {
    recordProposalEvent(event);
    return;
  }
  recordProposalEvent(event, sessionId);
}

function showOutlineUndo(token: OutlineUndoToken): void {
  toast.success("Outline changes applied", {
    action: {
      label: "Undo",
      onClick: () => {
        const undone = useProjectStore
          .getState()
          .undoAgentOutlineProposal(token);
        if (!undone) {
          toast.error("Couldn't undo outline changes");
        }
      },
    },
  });
}

function showProposalApplyFailure(result: ProposalApplyFailure): void {
  if (result.status === "stale") {
    toast.error("Proposal source changed", {
      description: "Keep this proposal open and ask the agent to regenerate it.",
    });
    return;
  }
  toast.error("Proposal couldn't be applied", {
    description: "Keep this proposal open and ask the agent to replace it.",
  });
}

function closeExhaustedManuscriptReview(proposal: PendingProposal): void {
  if (
    proposal.kind === "manuscript" &&
    useAgentConsoleStore.getState().pendingProposal === null
  ) {
    useViewStore.getState().closeManuscriptReview();
  }
}

function applyProposalChanges(
  proposal: PendingProposal,
  changeIds: string[],
): boolean {
  const projectState = useProjectStore.getState();
  switch (proposal.kind) {
    case "manuscript": {
      const result = projectState.applyAgentManuscriptProposal(
        proposal,
        changeIds,
      );
      if (result.status !== "applied") {
        showProposalApplyFailure(result);
        return false;
      }
      return true;
    }
    case "outline": {
      const result = projectState.applyAgentOutlineProposal(
        proposal,
        changeIds,
      );
      if (result.status !== "applied") {
        showProposalApplyFailure(result);
        return false;
      }
      showOutlineUndo(result.undoToken);
      return true;
    }
    case "overview":
      return true;
    default:
      return assertProposalKindExhausted(proposal);
  }
}

export function proposalStaleChangeIds(
  proposal: PendingProposal,
): Set<string> {
  const projectState = useProjectStore.getState();
  const stale = new Set<string>();
  if (
    proposal.overviewChange &&
    storyOverviewFingerprint(projectState.meta.outline.overview) !==
      proposal.overviewChange.sourceFingerprint
  ) {
    stale.add(proposal.overviewChange.id);
  }
  if (
    projectState.project === null ||
    projectState.project.root !== proposal.projectRoot
  ) {
    proposal.changes.forEach((change) => stale.add(change.id));
    if (proposal.overviewChange) stale.add(proposal.overviewChange.id);
    return stale;
  }
  switch (proposal.kind) {
    case "overview":
      return stale;
    case "manuscript":
      if (
        projectState.activeChapterId !== proposal.chapterId ||
        !projectState.project.chapters.some(
          (chapter) => chapter.id === proposal.chapterId,
        )
      ) {
        proposal.changes.forEach((change) => stale.add(change.id));
        return stale;
      }
      validateManuscriptChanges(proposal, projectState.blocks).forEach(
        (change) => stale.add(change.changeId),
      );
      return stale;
    case "outline": {
      if (
        !projectState.project.chapters.some(
          (chapter) => chapter.id === proposal.chapterId,
        )
      ) {
        proposal.changes.forEach((change) => stale.add(change.id));
        return stale;
      }
      const chapter = getChapterOutline(
        projectState.meta.chapters,
        proposal.chapterId,
      );
      validateOutlineChanges(proposal, chapter.cards).forEach(
        (change) => stale.add(change.changeId),
      );
      return stale;
    }
    default:
      return assertProposalKindExhausted(proposal);
  }
}

export function acceptProposalChange(
  proposal: PendingProposal,
  changeId: string,
  requestedSessionId?: AgentSessionId,
): void {
  const sessionId = requestedSessionId ?? PROJECT_AGENT_SESSION;
  requireAgentSessionProject(sessionId, proposal.projectRoot);
  const current = currentProposalForDecision(proposal, sessionId);
  if (current.overviewChange?.id === changeId) {
    if (proposalStaleChangeIds(current).has(changeId)) return;
    if (current.kind === "overview") {
      useProjectStore.getState().setOverview(current.overviewChange.after);
    } else if (!applyProposalChanges(current, [changeId])) {
      return;
    }
    agentSessionStore(sessionId).getState().removePendingChanges([changeId]);
    recordSessionProposalEvent(proposalEvent(current, "accepted", 1), sessionId);
    return;
  }
  const change = current.changes.find((item) => item.id === changeId);
  if (change === undefined) {
    throw new Error(`Pending proposal change not found: ${changeId}`);
  }
  if (!applyProposalChanges(current, [changeId])) return;
  agentSessionStore(sessionId).getState().removePendingChanges([changeId]);
  closeExhaustedManuscriptReview(current);
  recordSessionProposalEvent(proposalEvent(current, "accepted", 1), sessionId);
}

export function acceptAllProposalChanges(
  proposal: PendingProposal,
  requestedSessionId?: AgentSessionId,
): void {
  const sessionId = requestedSessionId ?? PROJECT_AGENT_SESSION;
  requireAgentSessionProject(sessionId, proposal.projectRoot);
  const current = currentProposalForDecision(proposal, sessionId);
  const changeIds = [
    ...current.changes.map((change) => change.id),
    ...(current.overviewChange ? [current.overviewChange.id] : []),
  ];
  if (proposalStaleChangeIds(current).size > 0) return;
  if (current.kind !== "overview" && !applyProposalChanges(current, changeIds)) return;
  if (current.kind === "overview") {
    useProjectStore.getState().setOverview(current.overviewChange.after);
  }
  agentSessionStore(sessionId).getState().clearPendingProposal();
  closeExhaustedManuscriptReview(current);
  recordSessionProposalEvent(
    proposalEvent(
      current,
      "accepted-all",
      changeIds.length,
    ),
    sessionId,
  );
}

export function rejectProposalChange(
  proposal: PendingProposal,
  changeId: string,
  requestedSessionId?: AgentSessionId,
): void {
  const sessionId = requestedSessionId ?? PROJECT_AGENT_SESSION;
  requireAgentSessionProject(sessionId, proposal.projectRoot);
  const current = currentProposalForDecision(proposal, sessionId);
  if (
    !current.changes.some((change) => change.id === changeId) &&
    current.overviewChange?.id !== changeId
  ) {
    throw new Error(`Pending proposal change not found: ${changeId}`);
  }
  agentSessionStore(sessionId).getState().removePendingChanges([changeId]);
  closeExhaustedManuscriptReview(current);
  recordSessionProposalEvent(proposalEvent(current, "rejected", 1), sessionId);
}

export function rejectAllProposalChanges(
  proposal: PendingProposal,
  requestedSessionId?: AgentSessionId,
): void {
  const sessionId = requestedSessionId ?? PROJECT_AGENT_SESSION;
  requireAgentSessionProject(sessionId, proposal.projectRoot);
  const current = currentProposalForDecision(proposal, sessionId);
  const changeCount = current.changes.length + (current.overviewChange ? 1 : 0);
  agentSessionStore(sessionId).getState().clearPendingProposal();
  closeExhaustedManuscriptReview(current);
  recordSessionProposalEvent(
    proposalEvent(current, "rejected-all", changeCount),
    sessionId,
  );
}
