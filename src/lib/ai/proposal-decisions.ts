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
import {
  requireAgentConsoleProject,
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
): PendingProposal {
  const current = useAgentConsoleStore.getState().pendingProposal;
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
  const subject = kind === "manuscript" ? "manuscript" : "outline";
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
    default:
      return assertProposalKindExhausted(proposal);
  }
}

export function proposalStaleChangeIds(
  proposal: PendingProposal,
): Set<string> {
  const projectState = useProjectStore.getState();
  if (
    projectState.project === null ||
    projectState.project.root !== proposal.projectRoot ||
    !projectState.project.chapters.some(
      (chapter) => chapter.id === proposal.chapterId,
    )
  ) {
    return new Set(proposal.changes.map((change) => change.id));
  }
  switch (proposal.kind) {
    case "manuscript":
      if (projectState.activeChapterId !== proposal.chapterId) {
        return new Set(proposal.changes.map((change) => change.id));
      }
      return new Set(
        validateManuscriptChanges(proposal, projectState.blocks).map(
          (stale) => stale.changeId,
        ),
      );
    case "outline": {
      const chapter = getChapterOutline(
        projectState.meta.chapters,
        proposal.chapterId,
      );
      return new Set(
        validateOutlineChanges(proposal, chapter.cards).map(
          (stale) => stale.changeId,
        ),
      );
    }
    default:
      return assertProposalKindExhausted(proposal);
  }
}

export function acceptProposalChange(
  proposal: PendingProposal,
  changeId: string,
): void {
  requireAgentConsoleProject(proposal.projectRoot);
  const current = currentProposalForDecision(proposal);
  const change = current.changes.find((item) => item.id === changeId);
  if (change === undefined) {
    throw new Error(`Pending proposal change not found: ${changeId}`);
  }
  if (!applyProposalChanges(current, [changeId])) return;
  useAgentConsoleStore.getState().removePendingChanges([changeId]);
  closeExhaustedManuscriptReview(current);
  recordProposalEvent(proposalEvent(current, "accepted", 1));
}

export function acceptAllProposalChanges(proposal: PendingProposal): void {
  requireAgentConsoleProject(proposal.projectRoot);
  const current = currentProposalForDecision(proposal);
  const changeIds = current.changes.map((change) => change.id);
  if (!applyProposalChanges(current, changeIds)) return;
  useAgentConsoleStore.getState().clearPendingProposal();
  closeExhaustedManuscriptReview(current);
  recordProposalEvent(
    proposalEvent(current, "accepted-all", changeIds.length),
  );
}

export function rejectProposalChange(
  proposal: PendingProposal,
  changeId: string,
): void {
  requireAgentConsoleProject(proposal.projectRoot);
  const current = currentProposalForDecision(proposal);
  if (!current.changes.some((change) => change.id === changeId)) {
    throw new Error(`Pending proposal change not found: ${changeId}`);
  }
  useAgentConsoleStore.getState().removePendingChanges([changeId]);
  closeExhaustedManuscriptReview(current);
  recordProposalEvent(proposalEvent(current, "rejected", 1));
}

export function rejectAllProposalChanges(proposal: PendingProposal): void {
  requireAgentConsoleProject(proposal.projectRoot);
  const current = currentProposalForDecision(proposal);
  const changeCount = current.changes.length;
  useAgentConsoleStore.getState().clearPendingProposal();
  closeExhaustedManuscriptReview(current);
  recordProposalEvent(
    proposalEvent(current, "rejected-all", changeCount),
  );
}
