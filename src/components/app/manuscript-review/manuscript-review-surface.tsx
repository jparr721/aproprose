import { useEffect, useMemo, useRef, useState } from "react";
import { ManuscriptReviewChange } from "@/components/app/manuscript-review/manuscript-review-change";
import { ManuscriptReviewHeader } from "@/components/app/manuscript-review/manuscript-review-header";
import type { ManuscriptPendingProposal } from "@/lib/ai/agent-types";
import {
  acceptAllProposalChanges,
  acceptProposalChange,
  rejectAllProposalChanges,
  rejectProposalChange,
} from "@/lib/ai/proposal-decisions";
import {
  projectManuscriptReview,
  type ManuscriptReviewRow,
} from "@/lib/ai/manuscript-review-projection";
import { cn } from "@/lib/utils";
import {
  agentConsoleOwnershipStatus,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";

export interface ManuscriptReviewSurfaceProps {
  proposal: ManuscriptPendingProposal;
}

function decisionChangeId(row: ManuscriptReviewRow): string | null {
  switch (row.kind) {
    case "rewrite":
    case "insert":
    case "remove":
    case "move-destination":
    case "stale":
      return row.changeId;
    case "unchanged":
    case "move-source":
      return null;
  }
}

function reviewRowClass(row: ManuscriptReviewRow): string {
  const changed =
    "scroll-mt-24 rounded-r-lg border-l-2 px-4 py-3 data-[active-review-change=true]:ring-1 data-[active-review-change=true]:ring-ring/30";
  switch (row.kind) {
    case "unchanged":
      return "py-1.5";
    case "rewrite":
    case "insert":
    case "move-destination":
      return cn(changed, "border-success bg-success/10");
    case "remove":
    case "stale":
      return cn(changed, "border-destructive bg-destructive/10");
    case "move-source":
      return cn(changed, "border-border bg-muted/30");
  }
}

function requireCurrentProposal(proposalId: string): ManuscriptPendingProposal {
  const current = useAgentConsoleStore.getState().pendingProposal;
  if (
    current === null ||
    current.kind !== "manuscript" ||
    current.id !== proposalId
  ) {
    throw new Error(
      `Cannot decide manuscript proposal ${proposalId}: it is no longer current.`,
    );
  }
  return current;
}

export function ManuscriptReviewSurface({
  proposal,
}: ManuscriptReviewSurfaceProps) {
  const pendingProposal = useAgentConsoleStore(
    (state) => state.pendingProposal,
  );
  if (
    pendingProposal === null ||
    pendingProposal.kind !== "manuscript" ||
    pendingProposal.id !== proposal.id
  ) {
    return null;
  }
  return (
    <ActiveManuscriptReviewSurface
      key={pendingProposal.id}
      proposal={pendingProposal}
    />
  );
}

function ActiveManuscriptReviewSurface({
  proposal,
}: ManuscriptReviewSurfaceProps) {
  const blocks = useProjectStore((state) => state.blocks);
  const characters = useProjectStore((state) => state.meta.characters);
  const updatePendingManuscriptText = useAgentConsoleStore(
    (state) => state.updatePendingManuscriptText,
  );
  const ownershipStatus = useAgentConsoleStore((state) =>
    agentConsoleOwnershipStatus(state, proposal.projectRoot),
  );
  const closeManuscriptReview = useViewStore(
    (state) => state.closeManuscriptReview,
  );
  const projection = useMemo(
    () => projectManuscriptReview(blocks, proposal),
    [blocks, proposal],
  );
  const [activeChangeId, setActiveChangeId] = useState<string | null>(
    projection.navigationChangeIds[0] ?? null,
  );
  const [editingRewriteId, setEditingRewriteId] = useState<string | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActiveChangeId(projection.navigationChangeIds[0] ?? null);
    setEditingRewriteId(null);
  }, [proposal.id]);

  useEffect(() => {
    if (
      activeChangeId !== null &&
      projection.navigationChangeIds.includes(activeChangeId)
    ) {
      return;
    }
    setActiveChangeId(projection.navigationChangeIds[0] ?? null);
  }, [activeChangeId, projection.navigationChangeIds]);

  const activeIndex =
    activeChangeId === null
      ? -1
      : projection.navigationChangeIds.indexOf(activeChangeId);
  const decisionsDisabled = ownershipStatus !== "ready";

  const navigate = (offset: -1 | 1): void => {
    const decisionRows = Array.from(
      surfaceRef.current?.querySelectorAll<HTMLElement>(
        "[data-agent-decision-change-id]",
      ) ?? [],
    );
    const currentIndex = decisionRows.findIndex(
      (row) => row.dataset.agentDecisionChangeId === activeChangeId,
    );
    const target = decisionRows[currentIndex + offset];
    if (target === undefined) return;
    const targetId = target.dataset.agentDecisionChangeId;
    if (targetId === undefined) {
      throw new Error("Manuscript review decision row is missing its change ID.");
    }
    setActiveChangeId(targetId);
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div ref={surfaceRef}>
      <ManuscriptReviewHeader
        summary={proposal.summary}
        remaining={proposal.changes.length}
        previousDisabled={activeIndex <= 0}
        nextDisabled={
          activeIndex < 0 ||
          activeIndex >= projection.navigationChangeIds.length - 1
        }
        acceptAllDisabled={
          decisionsDisabled || projection.staleChangeIds.size > 0
        }
        decisionsDisabled={decisionsDisabled}
        onPrevious={() => navigate(-1)}
        onNext={() => navigate(1)}
        onAcceptAll={() =>
          acceptAllProposalChanges(requireCurrentProposal(proposal.id))
        }
        onRejectAll={() =>
          rejectAllProposalChanges(requireCurrentProposal(proposal.id))
        }
        onClose={closeManuscriptReview}
      />
      <div className="flex flex-col gap-3">
        {projection.rows.map((row) => {
          const changeId = decisionChangeId(row);
          return (
            <div
              data-active-review-change={
                changeId === activeChangeId ? "true" : undefined
              }
              data-agent-change-id={
                row.kind === "unchanged" ? undefined : row.changeId
              }
              data-agent-decision-change-id={changeId ?? undefined}
              data-review-row-kind={row.kind}
              className={reviewRowClass(row)}
              key={`${proposal.id}:${row.key}`}
            >
              <ManuscriptReviewChange
                characters={characters}
                disabled={decisionsDisabled}
                editingRewrite={
                  row.kind === "rewrite" && editingRewriteId === row.changeId
                }
                onAccept={(changeId) =>
                  acceptProposalChange(
                    requireCurrentProposal(proposal.id),
                    changeId,
                  )
                }
                onBeginRewriteEdit={setEditingRewriteId}
                onEndRewriteEdit={() => setEditingRewriteId(null)}
                onReject={(changeId) =>
                  rejectProposalChange(
                    requireCurrentProposal(proposal.id),
                    changeId,
                  )
                }
                onTextChange={(changeId, newText) =>
                  updatePendingManuscriptText({
                    proposalId: proposal.id,
                    changeId,
                    newText,
                  })
                }
                row={row}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
