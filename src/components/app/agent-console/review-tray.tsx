import { useState } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconX,
} from "@tabler/icons-react";
import { ManuscriptReview } from "@/components/app/agent-console/manuscript-review";
import { OutlineReview } from "@/components/app/agent-console/outline-review";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  TypographyEyebrow,
  TypographyMuted,
} from "@/components/ui/typography";
import { recordProposalEvent } from "@/lib/ai/agent-controller";
import { navigateToProposalChange } from "@/lib/ai/agent-navigation";
import {
  validateManuscriptChanges,
  validateOutlineChanges,
} from "@/lib/ai/agent-proposals";
import type {
  OutlineUndoToken,
  PendingProposal,
  ProposalEventData,
} from "@/lib/ai/agent-types";
import { useAgentConsoleStore } from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { toast } from "sonner";

type ProposalDecisionAction = Exclude<
  ProposalEventData["action"],
  "staged"
>;

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

function proposalStaleIds(proposal: PendingProposal): Set<string> {
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
  if (proposal.kind === "manuscript") {
    if (projectState.activeChapterId !== proposal.chapterId) {
      return new Set(proposal.changes.map((change) => change.id));
    }
    return new Set(
      validateManuscriptChanges(proposal, projectState.blocks).map(
        (stale) => stale.changeId,
      ),
    );
  }
  const chapter = projectState.meta.chapters[proposal.chapterId];
  if (chapter === undefined) {
    return new Set(proposal.changes.map((change) => change.id));
  }
  return new Set(
    validateOutlineChanges(proposal, chapter.cards).map(
      (stale) => stale.changeId,
    ),
  );
}

export function ReviewTray() {
  const [expanded, setExpanded] = useState(false);
  const proposal = useAgentConsoleStore((state) => state.pendingProposal);
  const removePendingChanges = useAgentConsoleStore(
    (state) => state.removePendingChanges,
  );
  const clearPendingProposal = useAgentConsoleStore(
    (state) => state.clearPendingProposal,
  );
  useProjectStore((state) => state.project);
  useProjectStore((state) => state.activeChapterId);
  useProjectStore((state) => state.blocks);
  useProjectStore((state) => state.meta);

  if (proposal === null) return null;

  const staleChangeIds = proposalStaleIds(proposal);
  const proposalType = proposal.kind === "manuscript" ? "Manuscript" : "Outline";
  const remaining = proposal.changes.length;
  const remainingLabel = `${remaining} ${remaining === 1 ? "change" : "changes"}`;

  const record = (
    action: ProposalDecisionAction,
    count: number,
  ): void => {
    recordProposalEvent(proposalEvent(proposal, action, count));
  };

  const acceptOne = (changeId: string): void => {
    const change = proposal.changes.find((item) => item.id === changeId);
    if (change === undefined) {
      throw new Error(`Pending proposal change not found: ${changeId}`);
    }
    if (proposal.kind === "manuscript") {
      const result = useProjectStore
        .getState()
        .applyAgentManuscriptProposal(proposal, [changeId]);
      if (result.status === "stale") return;
    } else {
      const result = useProjectStore
        .getState()
        .applyAgentOutlineProposal(proposal, [changeId]);
      if (result.status === "stale") return;
      showOutlineUndo(result.undoToken);
    }
    removePendingChanges([changeId]);
    record("accepted", 1);
  };

  const acceptAll = (): void => {
    const changeIds = proposal.changes.map((change) => change.id);
    if (proposal.kind === "manuscript") {
      const result = useProjectStore
        .getState()
        .applyAgentManuscriptProposal(proposal, changeIds);
      if (result.status === "stale") return;
    } else {
      const result = useProjectStore
        .getState()
        .applyAgentOutlineProposal(proposal, changeIds);
      if (result.status === "stale") return;
      showOutlineUndo(result.undoToken);
    }
    clearPendingProposal();
    record("accepted-all", changeIds.length);
  };

  const rejectOne = (changeId: string): void => {
    if (!proposal.changes.some((change) => change.id === changeId)) {
      throw new Error(`Pending proposal change not found: ${changeId}`);
    }
    removePendingChanges([changeId]);
    record("rejected", 1);
  };

  const rejectAll = (): void => {
    clearPendingProposal();
    record("rejected-all", remaining);
  };

  const navigate = (changeId: string): void => {
    const change = proposal.changes.find((item) => item.id === changeId);
    if (change === undefined) {
      throw new Error(`Pending proposal change not found: ${changeId}`);
    }
    void navigateToProposalChange(proposal.chapterId, change).catch((error) => {
      toast.error("Couldn't open proposal context", {
        description: String(error),
      });
    });
  };

  return (
    <Card data-agent-review-tray size="sm">
      <Collapsible onOpenChange={setExpanded} open={expanded}>
        <CardHeader>
          <div className="flex flex-col gap-1">
            <TypographyEyebrow>{proposalType}</TypographyEyebrow>
            <CardTitle>{proposal.summary}</CardTitle>
            <TypographyMuted>{remainingLabel}</TypographyMuted>
          </div>
          {remaining === 0 ? null : (
            <CardAction>
              <CollapsibleTrigger asChild>
                <Button
                  aria-label={
                    expanded
                      ? "Collapse proposal review"
                      : "Expand proposal review"
                  }
                  size="icon-sm"
                  variant="ghost"
                >
                  {expanded ? <IconChevronUp /> : <IconChevronDown />}
                </Button>
              </CollapsibleTrigger>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {remaining === 0 ? (
            <Button onClick={rejectAll} size="sm" variant="outline">
              Dismiss
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                disabled={staleChangeIds.size > 0}
                onClick={acceptAll}
                size="sm"
              >
                <IconCheck data-icon="inline-start" />
                Accept All
              </Button>
              <Button onClick={rejectAll} size="sm" variant="outline">
                <IconX data-icon="inline-start" />
                Reject All
              </Button>
            </div>
          )}
          <CollapsibleContent>
            <ScrollArea className="h-80 pr-3">
              {proposal.kind === "manuscript" ? (
                <ManuscriptReview
                  onAccept={acceptOne}
                  onNavigate={navigate}
                  onReject={rejectOne}
                  proposal={proposal}
                  staleChangeIds={staleChangeIds}
                />
              ) : (
                <OutlineReview
                  onAccept={acceptOne}
                  onNavigate={navigate}
                  onReject={rejectOne}
                  proposal={proposal}
                  staleChangeIds={staleChangeIds}
                />
              )}
            </ScrollArea>
          </CollapsibleContent>
        </CardContent>
      </Collapsible>
    </Card>
  );
}
