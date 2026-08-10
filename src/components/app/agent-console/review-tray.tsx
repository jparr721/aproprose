import { useState } from "react";
import {
  Check as IconCheck,
  ChevronDown as IconChevronDown,
  ChevronUp as IconChevronUp,
  PenLine as IconWriting,
  X as IconX,
} from "lucide-react";
import { OutlineReview } from "@/components/app/agent-console/outline-review";
import { AgentDiffPreview } from "@/components/app/agent-console/diff-preview";
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
import {
  navigateToProposalChange,
  openManuscriptProposalInEditor,
} from "@/lib/ai/agent-navigation";
import {
  acceptAllProposalChanges,
  acceptProposalChange,
  proposalStaleChangeIds,
  rejectAllProposalChanges,
  rejectProposalChange,
} from "@/lib/ai/proposal-decisions";
import type {
  ManuscriptPendingProposal,
  AgentSessionId,
  OutlinePendingProposal,
  OverviewPendingChange,
  PendingProposal,
} from "@/lib/ai/agent-types";
import { PROJECT_AGENT_SESSION } from "@/lib/ai/agent-types";
import {
  agentConsoleOwnershipStatus,
  useAgentSessionStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { toast } from "sonner";

interface ManuscriptReviewTrayProps {
  proposal: ManuscriptPendingProposal;
  staleChangeIds: Set<string>;
  authorMutationsDisabled: boolean;
  sessionId: AgentSessionId;
}

function OverviewChangeReview(props: {
  change: OverviewPendingChange;
  proposal: PendingProposal;
  stale: boolean;
  disabled: boolean;
  sessionId: AgentSessionId;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <TypographyEyebrow>Story Overview</TypographyEyebrow>
      <AgentDiffPreview before={props.change.before} after={props.change.after} />
      <TypographyMuted>{props.change.reason}</TypographyMuted>
      <div className="flex gap-2">
        <Button
          disabled={props.disabled || props.stale}
          onClick={() =>
            acceptProposalChange(props.proposal, props.change.id, props.sessionId)
          }
          size="sm"
        >
          <IconCheck /> Accept overview
        </Button>
        <Button
          disabled={props.disabled}
          onClick={() =>
            rejectProposalChange(props.proposal, props.change.id, props.sessionId)
          }
          size="sm"
          variant="outline"
        >
          <IconX /> Reject overview
        </Button>
      </div>
    </div>
  );
}

function ManuscriptReviewTray({
  proposal,
  staleChangeIds,
  authorMutationsDisabled,
  sessionId,
}: ManuscriptReviewTrayProps) {
  const remaining = proposal.changes.length + (proposal.overviewChange ? 1 : 0);
  const remainingLabel = `${remaining} ${remaining === 1 ? "change" : "changes"}`;

  const openReview = (): void => {
    void openManuscriptProposalInEditor(proposal)
      .then((opened) => {
        if (!opened) toast.error("Couldn't open proposal context");
      })
      .catch((error) => {
        toast.error("Couldn't open proposal context", {
          description: String(error),
        });
      });
  };

  return (
    <Card data-agent-review-tray size="sm">
      <CardHeader>
        <div className="flex flex-col gap-1">
          <TypographyEyebrow>Manuscript</TypographyEyebrow>
          <CardTitle>{proposal.summary}</CardTitle>
          <TypographyMuted>{remainingLabel}</TypographyMuted>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button onClick={openReview} size="sm" variant="outline">
          <IconWriting data-icon="inline-start" />
          Review in editor
        </Button>
        <Button
          disabled={authorMutationsDisabled || staleChangeIds.size > 0}
          onClick={() => acceptAllProposalChanges(proposal, sessionId)}
          size="sm"
        >
          <IconCheck data-icon="inline-start" />
          Accept All
        </Button>
        <Button
          disabled={authorMutationsDisabled}
          onClick={() => rejectAllProposalChanges(proposal, sessionId)}
          size="sm"
          variant="outline"
        >
          <IconX data-icon="inline-start" />
          Reject All
        </Button>
      </CardContent>
      {proposal.overviewChange ? (
        <CardContent>
          <OverviewChangeReview
            change={proposal.overviewChange}
            disabled={authorMutationsDisabled}
            proposal={proposal}
            sessionId={sessionId}
            stale={staleChangeIds.has(proposal.overviewChange.id)}
          />
        </CardContent>
      ) : null}
    </Card>
  );
}

interface OutlineReviewTrayProps {
  proposal: OutlinePendingProposal;
  staleChangeIds: Set<string>;
  authorMutationsDisabled: boolean;
  sessionId: AgentSessionId;
}

function OutlineReviewTray({
  proposal,
  staleChangeIds,
  authorMutationsDisabled,
  sessionId,
}: OutlineReviewTrayProps) {
  const [expanded, setExpanded] = useState(false);
  const remaining = proposal.changes.length + (proposal.overviewChange ? 1 : 0);
  const remainingLabel = `${remaining} ${remaining === 1 ? "change" : "changes"}`;

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
            <TypographyEyebrow>Outline</TypographyEyebrow>
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
            <Button
              disabled={authorMutationsDisabled}
              onClick={() => rejectAllProposalChanges(proposal, sessionId)}
              size="sm"
              variant="outline"
            >
              Dismiss
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                disabled={
                  authorMutationsDisabled || staleChangeIds.size > 0
                }
                onClick={() => acceptAllProposalChanges(proposal, sessionId)}
                size="sm"
              >
                <IconCheck data-icon="inline-start" />
                Accept All
              </Button>
              <Button
                disabled={authorMutationsDisabled}
                onClick={() => rejectAllProposalChanges(proposal, sessionId)}
                size="sm"
                variant="outline"
              >
                <IconX data-icon="inline-start" />
                Reject All
              </Button>
            </div>
          )}
          <CollapsibleContent>
            <ScrollArea className="h-80 pr-3">
              <OutlineReview
                disabled={authorMutationsDisabled}
                onAccept={(changeId) =>
                  acceptProposalChange(proposal, changeId, sessionId)
                }
                onNavigate={navigate}
                onReject={(changeId) =>
                  rejectProposalChange(proposal, changeId, sessionId)
                }
                proposal={proposal}
                staleChangeIds={staleChangeIds}
              />
            </ScrollArea>
          </CollapsibleContent>
          {proposal.overviewChange ? (
            <OverviewChangeReview
              change={proposal.overviewChange}
              disabled={authorMutationsDisabled}
              proposal={proposal}
              sessionId={sessionId}
              stale={staleChangeIds.has(proposal.overviewChange.id)}
            />
          ) : null}
        </CardContent>
      </Collapsible>
    </Card>
  );
}

export function ReviewTray({
  sessionId: requestedSessionId,
}: { sessionId?: AgentSessionId }) {
  const sessionId = requestedSessionId ?? PROJECT_AGENT_SESSION;
  const proposal = useAgentSessionStore(sessionId, (state) => state.pendingProposal);
  const projectRoot = useProjectStore(
    (state) => state.project?.root ?? null,
  );
  const authorMutationsDisabled = useAgentSessionStore(sessionId,
    (state) => agentConsoleOwnershipStatus(state, projectRoot) !== "ready",
  );
  useProjectStore((state) => state.activeChapterId);
  useProjectStore((state) => state.blocks);
  useProjectStore((state) => state.meta);

  if (proposal === null) return null;

  const staleChangeIds = proposalStaleChangeIds(proposal);
  if (proposal.kind === "overview") {
    return (
      <Card data-agent-review-tray size="sm">
        <CardHeader>
          <CardTitle>{proposal.summary}</CardTitle>
        </CardHeader>
        <CardContent>
          <OverviewChangeReview
            change={proposal.overviewChange}
            disabled={authorMutationsDisabled}
            proposal={proposal}
            sessionId={sessionId}
            stale={staleChangeIds.has(proposal.overviewChange.id)}
          />
        </CardContent>
      </Card>
    );
  }
  return proposal.kind === "manuscript" ? (
    <ManuscriptReviewTray
      authorMutationsDisabled={authorMutationsDisabled}
      proposal={proposal}
      sessionId={sessionId}
      staleChangeIds={staleChangeIds}
    />
  ) : (
    <OutlineReviewTray
      authorMutationsDisabled={authorMutationsDisabled}
      proposal={proposal}
      sessionId={sessionId}
      staleChangeIds={staleChangeIds}
    />
  );
}
