import { beforeEach, describe, expect, it } from "vitest";
import type { ManuscriptPendingProposal, OverviewPendingProposal, ProposalSource } from "@/lib/ai/agent-types";
import { selectPendingProposal, useAgentConsoleStore } from "@/stores/agent-console-store";
import { emptyPersistedAgentState } from "@/stores/agent-persistence";

function proposal(id: string): OverviewPendingProposal {
  return {
    id,
    kind: "overview",
    projectRoot: "/book",
    chapterId: null,
    summary: id,
    createdAt: "2026-10-07T12:00:00.000Z",
    originatingMessageId: `message-${id}`,
    changes: [],
    overviewChange: {
      id: `change-${id}`,
      before: "Before",
      after: "After",
      reason: "Develop the story",
      sourceFingerprint: "original",
    },
  };
}

const legacySource: ProposalSource = { kind: "legacy" };

describe("retained agent proposals", () => {
  beforeEach(() => {
    useAgentConsoleStore.getState().resetProject();
    useAgentConsoleStore.getState().hydrate("/book", emptyPersistedAgentState());
  });

  it("retains independent proposals when a new result is staged", () => {
    const store = useAgentConsoleStore.getState();
    store.stageProposal(proposal("first"), legacySource);
    store.stageProposal(proposal("second"), legacySource);
    const current = useAgentConsoleStore.getState();
    expect(current.proposalRecords.map((record) => record.proposal.id)).toEqual(["first", "second"]);
    expect(selectPendingProposal(current, "first")).toEqual(proposal("first"));
    expect(current.pendingProposal).toEqual(proposal("second"));
  });

  it("retains exact content after applying and refuses applying the same change twice", () => {
    const store = useAgentConsoleStore.getState();
    store.stageProposal(proposal("first"), legacySource);
    store.decideProposalChanges("first", ["change-first"], {
      status: "applied",
      decidedAt: "2026-10-07T12:01:00.000Z",
    });
    const current = useAgentConsoleStore.getState();
    expect(current.proposalRecords[0].proposal).toEqual(proposal("first"));
    expect(current.pendingProposal).toBeNull();
    expect(() => current.decideProposalChanges("first", ["change-first"], {
      status: "applied",
      decidedAt: "2026-10-07T12:02:00.000Z",
    })).toThrow();
  });

  it("restores dismissed content with its original guards without retargeting chat", () => {
    const store = useAgentConsoleStore.getState();
    store.stageProposal(proposal("first"), legacySource);
    store.decideProposalChanges("first", ["change-first"], {
      status: "dismissed",
      decidedAt: "2026-10-07T12:01:00.000Z",
    });
    store.stageProposal(proposal("second"), legacySource);
    store.restoreProposalChanges("first", ["change-first"]);
    const current = useAgentConsoleStore.getState();
    expect(selectPendingProposal(current, "first")).toEqual(proposal("first"));
    expect(current.currentProposalId).toBe("second");
    expect(current.pendingProposal).toEqual(proposal("second"));
  });

  it("commits an explicit replacement and predecessor link atomically", () => {
    const store = useAgentConsoleStore.getState();
    store.stageProposal(proposal("first"), legacySource);
    store.commitProposalReplacement("first", proposal("second"), {
      kind: "run",
      runId: "follow-up",
      task: { kind: "proposal-follow-up", proposalId: "first" },
      text: "Refine the idea",
    });
    const current = useAgentConsoleStore.getState();
    expect(current.proposalRecords[0].replacedByProposalId).toBe("second");
    expect(selectPendingProposal(current, "first")).toBeNull();
    expect(current.pendingProposal).toEqual(proposal("second"));
  });

  it("keeps partial decisions pending and restores dismissed changes without replaying applied changes", () => {
    const manuscript: ManuscriptPendingProposal = {
      ...proposal("first"),
      kind: "manuscript",
      chapterId: "chapter-1",
      changes: [{
        id: "insert-1",
        change: { kind: "insert", blockId: null, afterId: null, type: "narration", speaker: null, newText: "A new scene", toIndex: null, reason: "Continue" },
        precondition: { kind: "insert", boundary: "immediate", anchor: null, expectedNext: null },
      }],
    };
    const store = useAgentConsoleStore.getState();
    store.stageProposal(manuscript, legacySource);
    store.decideProposalChanges("first", ["insert-1"], { status: "applied", decidedAt: "2026-10-07T12:01:00.000Z" });
    expect(useAgentConsoleStore.getState().pendingProposal).toMatchObject({ changes: [], overviewChange: manuscript.overviewChange });
    store.decideProposalChanges("first", ["change-first"], { status: "dismissed", decidedAt: "2026-10-07T12:02:00.000Z" });
    expect(() => store.restoreProposalChanges("first", ["insert-1", "change-first"])).toThrow();
    store.restoreProposalChanges("first", ["change-first"]);
    const current = useAgentConsoleStore.getState();
    expect(current.pendingProposal).toMatchObject({ changes: [], overviewChange: manuscript.overviewChange });
    expect(current.proposalRecords[0].decisions["insert-1"].status).toBe("applied");
  });

  it("refuses unknown decision IDs and cross-project staging without changing records", () => {
    const store = useAgentConsoleStore.getState();
    store.stageProposal(proposal("first"), legacySource);
    expect(() => store.decideProposalChanges("first", ["missing"], {
      status: "dismissed",
      decidedAt: "2026-10-07T12:01:00.000Z",
    })).toThrow();
    expect(() => store.stageProposal({ ...proposal("second"), projectRoot: "/other" }, legacySource)).toThrow();
    expect(useAgentConsoleStore.getState().proposalRecords).toHaveLength(1);
  });
});
