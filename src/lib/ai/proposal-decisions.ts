import { notifyAppError } from "@/lib/notifications";
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
  ProposalReviewPreconditions,
} from "@/lib/ai/agent-types";
import { getChapterOutline } from "@/lib/outline/model";
import { storyOverviewFingerprint } from "@/lib/ai/agent-context";
import { PROJECT_AGENT_SESSION, type AgentSessionId } from "@/lib/ai/agent-types";
import {
  agentSessionStore,
  selectPendingProposal,
  proposalChangeIds,
  proposalWithReviewPreconditions,
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

type ProposalApplySuccess = Extract<AgentProposalApplyResult | AgentOutlineApplyResult, { status: "applied" }>;

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
  const state = agentSessionStore(sessionId).getState();
  const current = selectPendingProposal(state, proposal.id);
  if (
    current === null ||
    current.id !== proposal.id ||
    current.kind !== proposal.kind
  ) {
    throw new ProposalDecisionCorrelationError(proposal, state.pendingProposal);
  }
  return current;
}

function assertProposalKindExhausted(proposal: never): never {
  throw new Error(`Unsupported proposal kind: ${JSON.stringify(proposal)}`);
}

function capturedProposalForDecision(proposal: PendingProposal, sessionId: AgentSessionId): PendingProposal {
  const current = currentProposalForDecision(proposal, sessionId);
  const requested = proposalChangeIds(proposal);
  const pending = new Set(proposalChangeIds(current));
  if (requested.length === 0 || new Set(requested).size !== requested.length) {
    throw new Error("Select at least one distinct pending change before deciding this draft.");
  }
  for (const changeId of requested) {
    if (!pending.has(changeId)) throw new Error(`Pending proposal change not found: ${changeId}`);
  }
  if (current.kind === "overview") return current;
  const overviewChange = current.overviewChange && requested.includes(current.overviewChange.id) ? current.overviewChange : null;
  if (current.kind === "manuscript") return { ...current, changes: current.changes.filter((change) => requested.includes(change.id)), overviewChange };
  return { ...current, changes: current.changes.filter((change) => requested.includes(change.id)), overviewChange };
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
          notifyAppError("proposal-undo", "Proposal", useProjectStore.getState().project?.root ?? null, new Error("Outline has changed"));
        }
      },
    },
  });
}

function showProposalApplyFailure(result: ProposalApplyFailure): void {
  if (result.status === "stale") {
    notifyAppError("proposal-stale", "Proposal", useProjectStore.getState().project?.root ?? null, result);
    return;
  }
  notifyAppError("proposal-apply", "Proposal", useProjectStore.getState().project?.root ?? null, result);
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
  sessionId: AgentSessionId,
): ProposalApplySuccess | null {
  const projectState = useProjectStore.getState();
  if (proposalRequiresSourceNavigation(proposal) && proposal.changes.some((change) => changeIds.includes(change.id))) {
    toast.error("Open the source chapter before applying this draft");
    return null;
  }
  const record = agentSessionStore(sessionId).getState().proposalRecords.find((item) => item.proposal.id === proposal.id);
  if (record === undefined) throw new ProposalDecisionCorrelationError(proposal, null);
  const review = proposalWithReviewPreconditions(record);
  const overviewChange = review.overviewChange && record.decisions[review.overviewChange.id]?.status !== "applied" ? review.overviewChange : null;
  switch (proposal.kind) {
    case "manuscript": {
      if (review.kind !== "manuscript") throw new ProposalDecisionCorrelationError(proposal, review);
      const result = projectState.applyAgentManuscriptProposal(
        { ...review, changes: review.changes.filter((item) => record.decisions[item.id]?.status !== "applied"), overviewChange },
        changeIds,
      );
      if (result.status !== "applied") {
        showProposalApplyFailure(result);
        return null;
      }
      return result;
    }
    case "outline": {
      if (review.kind !== "outline") throw new ProposalDecisionCorrelationError(proposal, review);
      const result = projectState.applyAgentOutlineProposal(
        { ...review, changes: review.changes.filter((item) => record.decisions[item.id]?.status !== "applied"), overviewChange },
        changeIds,
      );
      if (result.status !== "applied") {
        showProposalApplyFailure(result);
        return null;
      }
      showOutlineUndo(result.undoToken);
      return result;
    }
    case "overview":
      return { status: "applied", appliedChangeIds: changeIds };
    default:
      return assertProposalKindExhausted(proposal);
  }
}

export function proposalRequiresSourceNavigation(proposal: PendingProposal): boolean {
  return proposal.kind === "manuscript" && proposal.changes.length > 0 &&
    useProjectStore.getState().activeChapterId !== proposal.chapterId;
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
        !projectState.project.chapters.some(
          (chapter) => chapter.id === proposal.chapterId,
        )
      ) {
        proposal.changes.forEach((change) => stale.add(change.id));
        return stale;
      }
      if (projectState.activeChapterId !== proposal.chapterId) return stale;
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
    let reviewPreconditions: ProposalReviewPreconditions | undefined;
    if (current.kind === "overview") {
      useProjectStore.getState().setOverview(current.overviewChange.after);
    } else {
      const result = applyProposalChanges(current, [changeId], sessionId);
      if (result === null) return;
      reviewPreconditions = result.reviewPreconditions;
    }
    agentSessionStore(sessionId).getState().decideProposalChanges(current.id, [changeId], { status: "applied", decidedAt: new Date().toISOString() }, reviewPreconditions);
    recordSessionProposalEvent(proposalEvent(current, "accepted", 1), sessionId);
    return;
  }
  const change = current.changes.find((item) => item.id === changeId);
  if (change === undefined) {
    throw new Error(`Pending proposal change not found: ${changeId}`);
  }
  const result = applyProposalChanges(current, [changeId], sessionId);
  if (result === null) return;
  agentSessionStore(sessionId).getState().decideProposalChanges(current.id, [changeId], { status: "applied", decidedAt: new Date().toISOString() }, result.reviewPreconditions);
  closeExhaustedManuscriptReview(current);
  recordSessionProposalEvent(proposalEvent(current, "accepted", 1), sessionId);
}

export function acceptAllProposalChanges(
  proposal: PendingProposal,
  requestedSessionId?: AgentSessionId,
): void {
  const sessionId = requestedSessionId ?? PROJECT_AGENT_SESSION;
  requireAgentSessionProject(sessionId, proposal.projectRoot);
  const current = capturedProposalForDecision(proposal, sessionId);
  const changeIds = [
    ...current.changes.map((change) => change.id),
    ...(current.overviewChange ? [current.overviewChange.id] : []),
  ];
  if (proposalStaleChangeIds(current).size > 0) return;
  let reviewPreconditions: ProposalReviewPreconditions | undefined;
  if (current.kind !== "overview") {
    const result = applyProposalChanges(current, changeIds, sessionId);
    if (result === null) return;
    reviewPreconditions = result.reviewPreconditions;
  }
  if (current.kind === "overview") {
    useProjectStore.getState().setOverview(current.overviewChange.after);
  }
  agentSessionStore(sessionId).getState().decideProposalChanges(current.id, changeIds, { status: "applied", decidedAt: new Date().toISOString() }, reviewPreconditions);
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
  agentSessionStore(sessionId).getState().decideProposalChanges(current.id, [changeId], { status: "dismissed", decidedAt: new Date().toISOString() });
  closeExhaustedManuscriptReview(current);
  recordSessionProposalEvent(proposalEvent(current, "rejected", 1), sessionId);
}

export function rejectAllProposalChanges(
  proposal: PendingProposal,
  requestedSessionId?: AgentSessionId,
): void {
  const sessionId = requestedSessionId ?? PROJECT_AGENT_SESSION;
  requireAgentSessionProject(sessionId, proposal.projectRoot);
  const current = capturedProposalForDecision(proposal, sessionId);
  const changeCount = current.changes.length + (current.overviewChange ? 1 : 0);
  const changeIds = proposalChangeIds(current);
  agentSessionStore(sessionId).getState().decideProposalChanges(current.id, changeIds, { status: "dismissed", decidedAt: new Date().toISOString() });
  closeExhaustedManuscriptReview(current);
  recordSessionProposalEvent(
    proposalEvent(current, "rejected-all", changeCount),
    sessionId,
  );
}
