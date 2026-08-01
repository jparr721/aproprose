import type {
  AgentRun,
  ManuscriptPendingChange,
  ManuscriptPendingProposal,
  OutlinePendingChange,
  OutlinePendingProposal,
  PendingProposal,
  PendingProposalToolValue,
  SourceLocator,
} from "@/lib/ai/agent-types";
import {
  blockFingerprint,
  blockOrderFingerprint,
  blockSnapshotText,
  cardFingerprint,
  cardSnapshotText,
  outlineOrderFingerprint,
} from "@/lib/ai/agent-context";
import { sanitizeProposal, sanitizeSculpt } from "@/lib/ai/operations";
import type {
  Block,
  BlockChange,
  Card,
  ManuscriptProposal,
  SculptChange,
  SculptProposal,
} from "@/lib/types";

export class AgentProposalError extends Error {
  readonly code:
    | "task-boundary"
    | "source-missing"
    | "proposal-mismatch"
    | "invalid-proposal"
    | "wrong-chapter";

  constructor(
    code: AgentProposalError["code"],
    message: string,
  ) {
    super(message);
    this.name = "AgentProposalError";
    this.code = code;
  }
}

export function conflictingTargetChangeIds(
  changes: readonly { changeId: string; targetId: string | null }[],
): string[] {
  const targetCounts = new Map<string, number>();
  for (const change of changes) {
    if (change.targetId !== null) {
      targetCounts.set(
        change.targetId,
        (targetCounts.get(change.targetId) ?? 0) + 1,
      );
    }
  }
  return changes.flatMap((change) =>
    change.targetId !== null && (targetCounts.get(change.targetId) ?? 0) > 1
      ? [change.changeId]
      : [],
  );
}

function assertNoDroppedChanges(
  rawCount: number,
  sanitizedCount: number,
  kind: PendingProposal["kind"],
): void {
  if (rawCount === sanitizedCount) return;
  throw new AgentProposalError(
    "invalid-proposal",
    `The proposal contains an invalid ${kind} change.`,
  );
}

function blockLocator(blocks: Block[], sourceId: string): SourceLocator {
  const order = blocks.findIndex((block) => block.id === sourceId);
  if (order < 0) {
    throw new AgentProposalError("source-missing", `Block not found: ${sourceId}`);
  }
  return {
    sourceId,
    order,
    fingerprint: blockFingerprint(blocks[order]),
    sourceType: blocks[order].type,
    label: `${blocks[order].type} block`,
    exactText: blocks[order].text,
    previewText: blockSnapshotText(blocks[order]),
  };
}

function cardLocator(cards: Card[], sourceId: string): SourceLocator {
  const order = cards.findIndex((card) => card.id === sourceId);
  if (order < 0) {
    throw new AgentProposalError("source-missing", `Outline card not found: ${sourceId}`);
  }
  return {
    sourceId,
    order,
    fingerprint: cardFingerprint(cards[order]),
    sourceType: "outline-card",
    label: cards[order].title,
    exactText: `${cards[order].title}\n${cards[order].intention}`.trim(),
    previewText: cardSnapshotText(cards[order]),
  };
}

function targetChapter(run: AgentRun): string | null {
  if (run.task.kind === "conversation") return run.task.targetChapterId;
  if (run.task.kind === "proposal-follow-up") return null;
  return run.task.chapterId;
}

function assertFollowUpMatches(
  run: AgentRun,
  currentPending: PendingProposal | null,
  expectedKind: PendingProposal["kind"],
): void {
  if (run.task.kind !== "proposal-follow-up") return;
  if (
    currentPending === null ||
    currentPending.id !== run.task.proposalId ||
    currentPending.kind !== expectedKind
  ) {
    throw new AgentProposalError(
      "proposal-mismatch",
      "The pending proposal does not match this follow-up run.",
    );
  }
}

function assertManuscriptTask(
  run: AgentRun,
  currentPending: PendingProposal | null,
): void {
  if (run.task.kind === "chapter-analysis" || run.task.kind === "outline-sculpt") {
    throw new AgentProposalError("task-boundary", "This task is read-only for manuscript changes.");
  }
  assertFollowUpMatches(run, currentPending, "manuscript");
}

function assertManuscriptChange(run: AgentRun, change: BlockChange): void {
  if (run.task.kind === "bridge") {
    if (change.kind !== "insert" || change.afterId !== run.task.anchorBlockId) {
      throw new AgentProposalError(
        "task-boundary",
        "A bridge may insert only after its frozen anchor.",
      );
    }
    return;
  }
  if (run.task.kind === "selected-block-edit") {
    const target =
      change.kind === "insert" ? change.afterId : change.blockId;
    if (target === null || !run.task.blockIds.includes(target)) {
      throw new AgentProposalError(
        "task-boundary",
        "The change is outside the frozen block selection.",
      );
    }
  }
}

function bridgePrecondition(
  change: BlockChange,
  blocks: Block[],
  successorBlockId: string | null,
): ManuscriptPendingChange["precondition"] {
  if (change.kind !== "insert") {
    throw new AgentProposalError(
      "task-boundary",
      "A bridge may insert only after its frozen anchor.",
    );
  }
  return {
    kind: "insert",
    anchor:
      change.afterId === null ? null : blockLocator(blocks, change.afterId),
    expectedNext:
      successorBlockId === null ? null : blockLocator(blocks, successorBlockId),
  };
}

function assertOutlineTask(
  run: AgentRun,
  currentPending: PendingProposal | null,
): void {
  if (run.task.kind === "proposal-follow-up") {
    assertFollowUpMatches(run, currentPending, "outline");
    return;
  }
  if (run.task.kind !== "outline-sculpt") {
    throw new AgentProposalError(
      "task-boundary",
      "Only an outline-sculpt task may stage outline changes.",
    );
  }
}

function manuscriptPrecondition(
  change: BlockChange,
  blocks: Block[],
): ManuscriptPendingChange["precondition"] {
  if (change.kind === "insert") {
    const anchor =
      change.afterId === null ? null : blockLocator(blocks, change.afterId);
    const anchorOrder = anchor === null ? blocks.length - 1 : anchor.order;
    const nextBlock = blocks[anchorOrder + 1];
    return {
      kind: "insert",
      anchor,
      expectedNext:
        nextBlock === undefined ? null : blockLocator(blocks, nextBlock.id),
    };
  }
  if (change.blockId === null) {
    throw new AgentProposalError(
      "source-missing",
      `${change.kind} requires a block id.`,
    );
  }
  const target = blockLocator(blocks, change.blockId);
  return change.kind === "move"
    ? {
        kind: "move",
        target,
        orderFingerprint: blockOrderFingerprint(blocks),
      }
    : { kind: "target", target };
}

function outlinePrecondition(
  change: SculptChange,
  cards: Card[],
): OutlinePendingChange["precondition"] {
  const orderFingerprint = outlineOrderFingerprint(cards);
  if (change.kind === "add") {
    return { kind: "outline-order", orderFingerprint };
  }
  if (change.cardId === null) {
    throw new AgentProposalError(
      "source-missing",
      `${change.kind} requires a card id.`,
    );
  }
  const target = cardLocator(cards, change.cardId);
  if (change.kind === "move") {
    return { kind: "outline-move", target, orderFingerprint };
  }
  return { kind: "card", target };
}

export function buildManuscriptPendingProposal(args: {
  run: AgentRun;
  raw: ManuscriptProposal;
  blocks: Block[];
  currentPending: PendingProposal | null;
  originatingMessageId: string;
  makeId: () => string;
  now: string;
}): ManuscriptPendingProposal {
  const task = args.run.task;
  assertManuscriptTask(args.run, args.currentPending);
  const chapterId =
    task.kind === "proposal-follow-up" && args.currentPending !== null
      ? args.currentPending.chapterId
      : targetChapter(args.run);
  if (chapterId === null || chapterId !== args.raw.chapterId) {
    throw new AgentProposalError(
      "wrong-chapter",
      "A manuscript proposal must target the frozen chapter.",
    );
  }
  const sanitized = sanitizeProposal(
    args.raw,
    args.blocks.map((block) => ({ id: block.id, text: block.text })),
    null,
  );
  assertNoDroppedChanges(
    args.raw.changes.length,
    sanitized.changes.length,
    "manuscript",
  );
  for (const change of sanitized.changes) {
    assertManuscriptChange(args.run, change);
  }
  if (
    task.kind === "bridge" &&
    task.successorBlockId !== null &&
    !args.blocks.some((block) => block.id === task.successorBlockId)
  ) {
    throw new AgentProposalError(
      "source-missing",
      "The frozen bridge successor is no longer present.",
    );
  }
  const proposalId = args.makeId();
  const changes = sanitized.changes.map((change) => ({
    id: args.makeId(),
    change,
    precondition:
      task.kind === "bridge"
        ? bridgePrecondition(change, args.blocks, task.successorBlockId)
        : manuscriptPrecondition(change, args.blocks),
  }));
  const conflicts = conflictingTargetChangeIds(
    changes.map((item) => ({
      changeId: item.id,
      targetId: item.change.kind === "insert" ? null : item.change.blockId,
    })),
  );
  if (conflicts.length > 0) {
    throw new AgentProposalError(
      "invalid-proposal",
      "A manuscript proposal cannot change the same manuscript source more than once.",
    );
  }
  return {
    id: proposalId,
    kind: "manuscript",
    projectRoot: args.run.projectRoot,
    chapterId,
    summary: sanitized.summary,
    createdAt: args.now,
    originatingMessageId: args.originatingMessageId,
    changes,
  };
}

export function buildOutlinePendingProposal(args: {
  run: AgentRun;
  raw: SculptProposal;
  cards: Card[];
  currentPending: PendingProposal | null;
  originatingMessageId: string;
  makeId: () => string;
  now: string;
}): OutlinePendingProposal {
  assertOutlineTask(args.run, args.currentPending);
  const chapterId =
    args.run.task.kind === "proposal-follow-up" && args.currentPending !== null
      ? args.currentPending.chapterId
      : targetChapter(args.run);
  if (chapterId === null || chapterId !== args.raw.chapterId) {
    throw new AgentProposalError(
      "wrong-chapter",
      "An outline proposal must target the frozen chapter.",
    );
  }
  const sanitized = sanitizeSculpt(
    args.raw,
    args.cards.map((card) => card.id),
  );
  assertNoDroppedChanges(
    args.raw.changes.length,
    sanitized.changes.length,
    "outline",
  );
  const proposalId = args.makeId();
  const changes = sanitized.changes.map((change) => ({
    id: args.makeId(),
    change,
    precondition: outlinePrecondition(change, args.cards),
  }));
  const conflicts = conflictingTargetChangeIds(
    changes.map((item) => ({
      changeId: item.id,
      targetId: item.change.kind === "add" ? null : item.change.cardId,
    })),
  );
  if (conflicts.length > 0) {
    throw new AgentProposalError(
      "invalid-proposal",
      "An outline proposal cannot change the same outline card more than once.",
    );
  }
  return {
    id: proposalId,
    kind: "outline",
    projectRoot: args.run.projectRoot,
    chapterId,
    summary: sanitized.summary,
    createdAt: args.now,
    originatingMessageId: args.originatingMessageId,
    changes,
  };
}

export type ProposalStaleReason =
  | "target-changed"
  | "target-missing"
  | "anchor-changed"
  | "successor-changed"
  | "order-changed"
  | "outline-order-changed";

export interface StaleProposalChange {
  changeId: string;
  reason: ProposalStaleReason;
}

function resolveBlockLocator(
  locator: SourceLocator,
  blocks: Block[],
): Block | null {
  const byId = blocks.find((block) => block.id === locator.sourceId);
  if (byId !== undefined) {
    return blockFingerprint(byId) === locator.fingerprint ? byId : null;
  }
  const byOrder = blocks[locator.order];
  return byOrder !== undefined &&
    blockFingerprint(byOrder) === locator.fingerprint
    ? byOrder
    : null;
}

function resolveCardLocator(
  locator: SourceLocator,
  cards: Card[],
): Card | null {
  const byId = cards.find((card) => card.id === locator.sourceId);
  if (byId !== undefined && cardFingerprint(byId) === locator.fingerprint) {
    return byId;
  }
  const byOrder = cards[locator.order];
  return byOrder !== undefined &&
    cardFingerprint(byOrder) === locator.fingerprint
    ? byOrder
    : null;
}

function validateManuscriptChange(
  item: ManuscriptPendingChange,
  blocks: Block[],
): ProposalStaleReason | null {
  const precondition = item.precondition;
  if (precondition.kind === "target") {
    return resolveBlockLocator(precondition.target, blocks) === null
      ? blocks.some((block) => block.id === precondition.target.sourceId)
        ? "target-changed"
        : "target-missing"
      : null;
  }
  if (precondition.kind === "move") {
    if (resolveBlockLocator(precondition.target, blocks) === null) {
      return "target-changed";
    }
    return blockOrderFingerprint(blocks) === precondition.orderFingerprint
      ? null
      : "order-changed";
  }
  const anchor =
    precondition.anchor === null
      ? null
      : resolveBlockLocator(precondition.anchor, blocks);
  if (precondition.anchor !== null && anchor === null) return "anchor-changed";
  const anchorOrder =
    anchor === null ? blocks.length - 1 : blocks.findIndex((block) => block.id === anchor.id);
  const next =
    precondition.expectedNext === null ||
    precondition.expectedNext.sourceType === "narration" ||
    precondition.expectedNext.sourceType === "dialogue"
      ? blocks
          .slice(anchorOrder + 1)
          .find((block) => block.type === "narration" || block.type === "dialogue")
      : blocks[anchorOrder + 1];
  if (precondition.expectedNext === null) {
    return next === undefined ? null : "successor-changed";
  }
  const expectedNext = resolveBlockLocator(precondition.expectedNext, blocks);
  return next !== undefined &&
    expectedNext !== null &&
    next.id === expectedNext.id
    ? null
    : "successor-changed";
}

export function validateManuscriptChanges(
  proposal: ManuscriptPendingProposal,
  blocks: Block[],
): StaleProposalChange[] {
  return proposal.changes.flatMap((item) => {
    const reason = validateManuscriptChange(item, blocks);
    return reason === null ? [] : [{ changeId: item.id, reason }];
  });
}

export function validateOutlineChanges(
  proposal: OutlinePendingProposal,
  cards: Card[],
): StaleProposalChange[] {
  const order = outlineOrderFingerprint(cards);
  return proposal.changes.flatMap((item): StaleProposalChange[] => {
    const precondition = item.precondition;
    if (
      precondition.kind === "outline-order" ||
      precondition.kind === "outline-move"
    ) {
      if (order !== precondition.orderFingerprint) {
        return [{ changeId: item.id, reason: "outline-order-changed" as const }];
      }
    }
    if (precondition.kind === "outline-order") return [];
    return resolveCardLocator(precondition.target, cards) !== null
      ? []
      : [{ changeId: item.id, reason: "target-changed" as const }];
  });
}

export function materializeManuscriptChanges(
  proposal: ManuscriptPendingProposal,
  changeIds: string[],
  blocks: Block[],
): BlockChange[] {
  const selected = new Set(changeIds);
  const stale = validateManuscriptChanges(
    { ...proposal, changes: proposal.changes.filter((item) => selected.has(item.id)) },
    blocks,
  );
  if (stale.length > 0) {
    throw new AgentProposalError(
      "source-missing",
      `Proposal preconditions failed: ${stale.map((item) => item.changeId).join(", ")}`,
    );
  }
  return proposal.changes
    .filter((item) => selected.has(item.id))
    .map((item) => {
      const precondition = item.precondition;
      if (item.change.kind === "insert") {
        const anchor =
          precondition.kind === "insert" && precondition.anchor !== null
            ? resolveBlockLocator(precondition.anchor, blocks)
            : null;
        return { ...item.change, afterId: anchor?.id ?? null };
      }
      const locator =
        precondition.kind === "target" || precondition.kind === "move"
          ? precondition.target
          : null;
      if (locator === null) {
        throw new AgentProposalError("source-missing", "A target locator is required.");
      }
      const target = resolveBlockLocator(locator, blocks);
      if (target === null) {
        throw new AgentProposalError("source-missing", "The proposal target changed.");
      }
      return { ...item.change, blockId: target.id };
    });
}

export function pendingProposalForModel(
  proposal: PendingProposal,
): PendingProposalToolValue {
  return {
    id: proposal.id,
    kind: proposal.kind,
    chapterId: proposal.chapterId,
    summary: proposal.summary,
    changes: proposal.changes.map((item) => ({
      id: item.id,
      change: item.change,
      precondition: item.precondition,
    })),
  };
}
