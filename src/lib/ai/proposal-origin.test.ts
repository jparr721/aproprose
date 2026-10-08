import { describe, expect, it } from "vitest";
import { buildManuscriptPendingProposal, blockLocator } from "@/lib/ai/agent-proposals";
import { captureProposalOrigin, resolveProposalOrigin } from "@/lib/ai/proposal-origin";
import type { AgentProposalRecord, AgentTask, ProposalOrigin } from "@/lib/ai/agent-types";
import { parseChapter } from "@/lib/latex";
import type { Block } from "@/lib/types";

const source = "First paragraph.\n\nSelected paragraph.\n\nLast paragraph.\n";
const blocks = parseChapter(source);
const task: Extract<AgentTask, { kind: "selected-block-edit" }> = {
  kind: "selected-block-edit", chapterId: "ch1", blockIds: [blocks[1].id], operation: "clean",
};

function record(): AgentProposalRecord {
  let nextId = 0;
  return {
    proposal: buildManuscriptPendingProposal({
      run: { id: "original-run", mode: "edit", task, projectRoot: "/book", userMessageId: "user", attachments: [], startedAt: "now" },
      raw: { chapterId: "ch1", summary: "Clean the selection", changes: [{ kind: "rewrite", blockId: blocks[1].id, afterId: null, type: "narration", speaker: null, newText: "Precise prose.", toIndex: null, reason: "Clean" }] },
      blocks, currentPending: null, originatingMessageId: "assistant", now: "now", makeId: () => `proposal-${++nextId}`, currentOverview: "",
    }),
    source: { kind: "run", runId: "original-run", task, text: "Clean", origin: captureProposalOrigin({ task, mode: "edit", blocks }) },
    decisions: {}, replacedByProposalId: null,
  };
}

function resolve(records: AgentProposalRecord[], liveBlocks: Block[], proposalId: string) {
  return resolveProposalOrigin({ task: { kind: "proposal-follow-up", proposalId }, mode: "writing", projectRoot: "/book", targetChapterId: "ch1", blocks: liveBlocks, records, messages: [] });
}

describe("proposal origin receipts", () => {
  it("captures the entire selection even when a proposal changes only one selected block", () => {
    const original = record();
    const wholeTask = { ...task, blockIds: [blocks[0].id, blocks[1].id] };
    original.source = { kind: "run", runId: "original-run", task: wholeTask, text: "Clean both", origin: captureProposalOrigin({ task: wholeTask, mode: "edit", blocks }) };
    const renewed = parseChapter(source);
    expect(resolve([original], renewed, original.proposal.id)).toMatchObject({ mode: "edit", task: { blockIds: [renewed[0].id, renewed[1].id] } });
  });

  it("reconstructs pre-receipt run sources from original canonical preconditions", () => {
    const original = record();
    original.source = { kind: "run", runId: "original-run", task, text: "Clean" };
    const renewed = parseChapter(source);
    expect(resolve([original], renewed, original.proposal.id)).toMatchObject({ task: { operation: "clean", blockIds: [renewed[1].id] } });
  });

  it("rejects missing receipts for unchanged members of an old selection", () => {
    const original = record();
    original.source = { kind: "run", runId: "original-run", task: { ...task, blockIds: [blocks[0].id, blocks[1].id] }, text: "Clean both" };
    expect(() => resolve([original], parseChapter(source), original.proposal.id)).toThrow("no original boundary receipt");
  });

  it("preserves an explicit legacy branch through retained replacements", () => {
    const original = record();
    original.source = { kind: "legacy" };
    const replacement: AgentProposalRecord = {
      ...record(), proposal: { ...record().proposal, id: "replacement" },
      source: { kind: "run", runId: "replacement-run", task: { kind: "proposal-follow-up", proposalId: original.proposal.id }, text: "Improve", origin: { kind: "legacy" } },
    };
    original.replacedByProposalId = replacement.proposal.id;
    expect(resolve([original, replacement], blocks, replacement.proposal.id)).toEqual({ origin: { kind: "legacy" }, mode: "writing", task: { kind: "proposal-follow-up", proposalId: replacement.proposal.id } });
  });

  it.each(["changed", "missing", "changed-identical-neighbor"] as const)("rejects a %s source instead of broadening the selection", (kind) => {
    const original = record();
    const liveBlocks = kind === "missing" ? blocks.filter((item) => item.id !== blocks[1].id)
      : blocks.map((item, index) => index === 1 ? { ...item, text: "Author's changed prose." }
        : kind === "changed-identical-neighbor" && index === 0 ? { ...blocks[1], id: item.id } : item);
    expect(() => resolve([original], liveBlocks, original.proposal.id)).toThrow("original selected source is missing or changed");
  });

  it("rejects stale ordinal receipts after renewed IDs and changed order", () => {
    const original = record();
    const renewed = parseChapter("Selected paragraph.\n\nFirst paragraph.\n\nLast paragraph.\n");
    expect(() => resolve([original], renewed, original.proposal.id)).toThrow("original selected source is missing or changed");
  });

  it.each(["missing", "mismatched", "root", "chapter", "kind", "origin"] as const)("rejects a %s predecessor chain", (kind) => {
    const original = record();
    const replacement: AgentProposalRecord = {
      ...record(), proposal: { ...record().proposal, id: "replacement" },
      source: { kind: "run", runId: "replacement-run", task: { kind: "proposal-follow-up", proposalId: original.proposal.id }, text: "Improve", origin: original.source.kind === "run" ? original.source.origin : undefined },
    };
    original.replacedByProposalId = replacement.proposal.id;
    if (kind === "mismatched") original.replacedByProposalId = "another";
    if (kind === "root") original.proposal.projectRoot = "/another-book";
    if (kind === "chapter") original.proposal.chapterId = "ch2";
    if (kind === "kind") original.proposal = { ...original.proposal, kind: "overview", chapterId: null, changes: [], overviewChange: { id: "overview", before: "", after: "New", reason: "Revise", sourceFingerprint: "source" } };
    if (kind === "origin" && replacement.source.kind === "run") replacement.source.origin = { kind: "legacy" };
    expect(() => resolve(kind === "missing" ? [replacement] : [original, replacement], blocks, replacement.proposal.id)).toThrowError(expect.objectContaining({ name: "ProposalOriginError", code: "proposal-mismatch" }));
  });

  it("rejects a cyclic retained replacement chain explicitly", () => {
    const first = record();
    const second = { ...record(), proposal: { ...record().proposal, id: "second" } };
    first.source = { kind: "run", runId: "first", task: { kind: "proposal-follow-up", proposalId: second.proposal.id }, text: "Again" };
    second.source = { kind: "run", runId: "second", task: { kind: "proposal-follow-up", proposalId: first.proposal.id }, text: "Again" };
    first.replacedByProposalId = second.proposal.id;
    second.replacedByProposalId = first.proposal.id;
    expect(() => resolve([first, second], blocks, first.proposal.id)).toThrow("chain is cyclic");
  });

  it.each(["operation", "chapter", "source-kind", "selection"] as const)("rejects a mismatched original %s", (kind) => {
    const original = record();
    if (original.source.kind !== "run") throw new Error("Expected run source");
    const origin = captureProposalOrigin({ task, mode: "edit", blocks });
    if (origin.kind !== "selected-block-edit") throw new Error("Expected selected origin");
    if (kind === "operation") origin.operation = "structure";
    if (kind === "chapter") origin.chapterId = "ch2";
    if (kind === "source-kind") origin.blocks[0] = { ...origin.blocks[0], sourceType: "scratchpad" };
    if (kind === "selection") origin.blocks = [blockLocator(blocks, blocks[0].id)];
    original.source.origin = origin;
    expect(() => resolve([original], blocks, original.proposal.id)).toThrowError(expect.objectContaining({ name: "ProposalOriginError", code: "proposal-mismatch" }));
  });

  it("rejects an already replaced target and absent retained target", () => {
    const original = record();
    original.replacedByProposalId = "replacement";
    expect(() => resolve([original], blocks, original.proposal.id)).toThrow("already been replaced");
    expect(() => resolve([], blocks, "absent")).toThrow("no longer retained");
  });

  it("reconstructs bridge boundary receipts from a pre-receipt original proposal", () => {
    const bridgeTask = { kind: "bridge", chapterId: "ch1", anchorBlockId: blocks[1].id, successorBlockId: blocks[2].id } satisfies AgentTask;
    const original = record();
    const anchor = blockLocator(blocks, blocks[1].id);
    const successor = blockLocator(blocks, blocks[2].id);
    original.source = { kind: "run", runId: "bridge", task: bridgeTask, text: "Bridge" };
    if (original.proposal.kind !== "manuscript") throw new Error("Expected manuscript");
    original.proposal.changes[0] = { ...original.proposal.changes[0], precondition: { kind: "insert", boundary: "next-prose", anchor, expectedNext: successor } };
    const renewed = parseChapter(source);
    expect(resolve([original], renewed, original.proposal.id).task).toEqual({ ...bridgeTask, anchorBlockId: renewed[1].id, successorBlockId: renewed[2].id });
  });

  it("freezes the original writing mode for a general writer follow-up", () => {
    const original = record();
    const origin: ProposalOrigin = { kind: "task", mode: "writing", task: { kind: "conversation", targetChapterId: "ch1" } };
    original.source = { kind: "run", runId: "writer", task: origin.task, text: "Write", origin };
    expect(resolve([original], blocks, original.proposal.id)).toMatchObject({ mode: "writing", task: origin.task });
  });
});


describe("selection source types", () => {
  it.each(["chapter", "narration", "dialogue", "lore", "scratchpad", "latex"] as const)("preserves actual %s selection type on strict relocation", (type) => {
    const originalBlock: Block = { id: "original", type, text: "Selected source text.", raw: "", dirty: false };
    const currentBlock: Block = { ...originalBlock, id: "reopened" };
    const selection = { ...task, blockIds: [originalBlock.id] };
    const original = record();
    original.source = { kind: "run", runId: "selection", task: selection, text: "Clean", origin: captureProposalOrigin({ task: selection, mode: "edit", blocks: [originalBlock] }) };
    expect(resolve([original], [currentBlock], original.proposal.id).task).toMatchObject({ blockIds: [currentBlock.id] });
  });

  it.each(["anchor", "successor"] as const)("rejects a non-prose bridge %s", (boundary) => {
    const sourceBlocks = [blocks[0], { ...blocks[1], type: "scratchpad" } satisfies Block];
    const bridgeTask = { kind: "bridge", chapterId: "ch1", anchorBlockId: sourceBlocks[boundary === "anchor" ? 1 : 0].id, successorBlockId: boundary === "anchor" ? null : sourceBlocks[1].id } satisfies AgentTask;
    expect(() => captureProposalOrigin({ task: bridgeTask, mode: "writing", blocks: sourceBlocks })).toThrow("boundary is not prose");
  });
});
