import { isEqual } from "es-toolkit";
import {
  AgentProposalError,
  blockLocator,
  resolveBlockLocator,
} from "@/lib/ai/agent-proposals";
import type {
  AgentMode,
  AgentProposalRecord,
  AgentTask,
  AgentUIMessage,
  ProposalOrigin,
  ProposalOriginIdentity,
  ProposalOriginMode,
  ProposalSource,
  SourceLocator,
} from "@/lib/ai/agent-types";
import type { Block } from "@/lib/types";

export class ProposalOriginError extends AgentProposalError {
  constructor(code: AgentProposalError["code"], message: string) {
    super(code, message);
    this.name = "ProposalOriginError";
  }
}

type OriginalTask = Exclude<AgentTask, { kind: "proposal-follow-up" }>;
type ScopedOrigin = Extract<ProposalOrigin, { kind: "selected-block-edit" | "bridge" }>;

export interface ResolvedProposalOrigin {
  origin: ProposalOrigin;
  mode: AgentMode;
  task: AgentTask;
}

function invalidOrigin(message: string): never {
  throw new ProposalOriginError("proposal-mismatch", `${message} Start the original action again to capture its scope.`);
}

function requireChapter(chapterId: string, targetChapterId: string | null): void {
  if (chapterId !== targetChapterId) invalidOrigin("The original proposal chapter does not match the frozen target.");
}

function requireProse(locator: SourceLocator): void {
  if (locator.sourceType !== "narration" && locator.sourceType !== "dialogue") {
    invalidOrigin(`The original write boundary is not prose: ${locator.sourceId}.`);
  }
}

function scopeLocators(origin: ScopedOrigin): SourceLocator[] {
  return origin.kind === "selected-block-edit" ? origin.blocks
    : [origin.anchor, origin.successor].filter((locator): locator is SourceLocator => locator !== null);
}

function originCore(origin: ProposalOrigin): ProposalOrigin {
  if (origin.kind === "legacy" || origin.kind === "task") return origin;
  const { identity: _identity, ...core } = origin;
  return core;
}

function validateIdentity(origin: ProposalOrigin): void {
  if (origin.kind === "legacy" || origin.kind === "task" || origin.identity === undefined) return;
  const { generation, blockIds, locators } = origin.identity;
  const original = scopeLocators(origin);
  const keys = new Set(original.map((locator) => locator.sourceId));
  if (generation === "" || blockIds.some((id) => id === "") || new Set(blockIds).size !== blockIds.length
    || Object.keys(locators).length !== keys.size || Object.keys(locators).some((key) => !keys.has(key))) {
    invalidOrigin("The saved source generation receipt is inconsistent.");
  }
  for (const source of original) {
    const latest = locators[source.sourceId];
    if (latest === undefined || !blockIds.includes(latest.sourceId) || latest.removed === true
      || source.removed === true || latest.fingerprint !== source.fingerprint
      || latest.sourceType !== source.sourceType || latest.exactText !== source.exactText) {
      invalidOrigin(`The saved source identity does not match its original boundary: ${source.sourceId}.`);
    }
  }
  const latestIds = Object.values(locators).map((locator) => locator.sourceId);
  if (new Set(latestIds).size !== latestIds.length) invalidOrigin("The saved source identities are duplicated.");
}

function captureIdentity(generation: string | null, blocks: Block[], locators: Record<string, SourceLocator>): ProposalOriginIdentity {
  if (generation === null || generation === "") invalidOrigin("The current chapter source generation is unavailable.");
  return { generation, blockIds: blocks.map((block) => block.id), locators };
}

function resolveBoundary(locator: SourceLocator, blocks: Block[]): string {
  const block = resolveBlockLocator(locator, blocks);
  if (block === null) {
    throw new ProposalOriginError("source-missing", `The original selected source is missing or changed: ${locator.sourceId}. Start the original action again to select the current source.`);
  }
  if (block.type !== locator.sourceType) invalidOrigin(`The original selected source type changed: ${locator.sourceId}.`);
  return block.id;
}

export function captureProposalOrigin(args: {
  task: OriginalTask;
  mode: AgentMode;
  blocks: Block[];
  sourceGeneration: string | null;
}): ProposalOrigin {
  const { task, mode, blocks } = args;
  if (task.kind === "selected-block-edit") {
    if (task.blockIds.length === 0 || new Set(task.blockIds).size !== task.blockIds.length) {
      invalidOrigin("The original selection must contain distinct source blocks.");
    }
    const locators = task.blockIds.map((id) => blockLocator(blocks, id));
    return { kind: task.kind, mode, chapterId: task.chapterId, operation: task.operation, blocks: locators,
      identity: captureIdentity(args.sourceGeneration, blocks, Object.fromEntries(locators.map((locator) => [locator.sourceId, locator]))) };
  }
  if (task.kind === "bridge") {
    const anchor = task.anchorBlockId === null ? null : blockLocator(blocks, task.anchorBlockId);
    const successor = task.successorBlockId === null ? null : blockLocator(blocks, task.successorBlockId);
    if (anchor !== null) requireProse(anchor);
    if (successor !== null) requireProse(successor);
    const locators = [anchor, successor].filter((locator): locator is SourceLocator => locator !== null);
    return { kind: task.kind, mode, chapterId: task.chapterId, anchor, successor,
      identity: captureIdentity(args.sourceGeneration, blocks, Object.fromEntries(locators.map((locator) => [locator.sourceId, locator]))) };
  }
  return { kind: "task", mode, task };
}

function retainedLocators(record: AgentProposalRecord): SourceLocator[] {
  if (record.proposal.kind !== "manuscript") return [];
  return record.proposal.changes.flatMap(({ precondition }) =>
    precondition.kind === "insert"
      ? [precondition.anchor, precondition.expectedNext].filter((locator): locator is SourceLocator => locator !== null)
      : [precondition.target],
  );
}

function recoverOriginalOrigin(record: AgentProposalRecord, mode: ProposalOriginMode): ProposalOrigin {
  if (record.source.kind === "legacy") return { kind: "legacy" };
  const task = record.source.task;
  if (task.kind === "proposal-follow-up") return invalidOrigin("The original proposal task is unavailable.");
  const locators = retainedLocators(record);
  const requireLocator = (id: string): SourceLocator => {
    const locator = locators.find((item) => item.sourceId === id);
    if (locator === undefined) invalidOrigin(`The saved proposal has no original boundary receipt for ${id}.`);
    return locator;
  };
  if (task.kind === "selected-block-edit") {
    return { kind: task.kind, mode, chapterId: task.chapterId, operation: task.operation, blocks: task.blockIds.map(requireLocator) };
  }
  if (task.kind === "bridge") {
    return { kind: task.kind, mode, chapterId: task.chapterId,
      anchor: task.anchorBlockId === null ? null : requireLocator(task.anchorBlockId),
      successor: task.successorBlockId === null ? null : requireLocator(task.successorBlockId) };
  }
  return { kind: "task", mode, task };
}

function originalTask(origin: Exclude<ProposalOrigin, { kind: "legacy" }>): OriginalTask {
  if (origin.kind === "task") return origin.task;
  if (origin.kind === "selected-block-edit") {
    return { kind: origin.kind, chapterId: origin.chapterId, operation: origin.operation, blockIds: origin.blocks.map((locator) => locator.sourceId) };
  }
  return {
    kind: origin.kind,
    chapterId: origin.chapterId,
    anchorBlockId: origin.anchor === null ? null : origin.anchor.sourceId,
    successorBlockId: origin.successor === null ? null : origin.successor.sourceId,
  };
}

interface RetainedOriginInput {
  proposalId: string;
  mode: AgentMode;
  projectRoot: string;
  records: AgentProposalRecord[];
  messages: AgentUIMessage[];
}

function originalMode(source: Extract<ProposalSource, { kind: "run" }>, messages: AgentUIMessage[]): ProposalOriginMode {
  const metadata = messages.flatMap((message) =>
    message.metadata !== undefined && message.metadata.runId === source.runId ? [message.metadata] : [],
  );
  if (metadata.length === 0) return "legacy";
  const mode = metadata[0].mode;
  if (metadata.some((item) => item.mode !== mode || !isEqual(item.task, source.task))) {
    invalidOrigin("The original run metadata disagrees about its mode or task.");
  }
  return mode;
}

function retainedProposalOrigin(args: RetainedOriginInput): ProposalOrigin {
  const ids = args.records.map((record) => record.proposal.id);
  if (new Set(ids).size !== ids.length) invalidOrigin("The retained proposal IDs are duplicated.");
  const selected = args.records.find((item) => item.proposal.id === args.proposalId);
  if (selected === undefined) invalidOrigin("The proposal being revised is no longer retained.");
  let record: AgentProposalRecord = selected;
  const target = record.proposal;
  const visited = new Set<string>();
  let retainedOrigin: ProposalOrigin | undefined;
  while (true) {
    if (visited.has(record.proposal.id)) invalidOrigin("The retained proposal replacement chain is cyclic.");
    visited.add(record.proposal.id);
    if (record.proposal.projectRoot !== args.projectRoot || record.proposal.chapterId !== target.chapterId || record.proposal.kind !== target.kind) {
      invalidOrigin("The retained proposal replacement chain crosses a project, chapter, or proposal kind.");
    }
    const source: ProposalSource = record.source;
    if (source.kind === "legacy") {
      if (retainedOrigin !== undefined && retainedOrigin.kind !== "legacy") invalidOrigin("The retained legacy proposal has a conflicting original task.");
      retainedOrigin = { kind: "legacy" };
      break;
    }
    if (source.origin !== undefined) {
      validateIdentity(source.origin);
      if (retainedOrigin !== undefined && !isEqual(originCore(retainedOrigin), originCore(source.origin))) invalidOrigin("The retained proposal origins disagree.");
      if (retainedOrigin !== undefined && "identity" in retainedOrigin && "identity" in source.origin
        && retainedOrigin.identity !== undefined && source.origin.identity !== undefined
        && retainedOrigin.identity.generation === source.origin.identity.generation) {
        for (const [id, locator] of Object.entries(source.origin.identity.locators)) {
          if (retainedOrigin.identity.locators[id].sourceId !== locator.sourceId) {
            invalidOrigin("The retained source identity changed within the same live generation.");
          }
        }
      }
      retainedOrigin ??= source.origin;
    }
    if (source.task.kind !== "proposal-follow-up") {
      const mode = originalMode(source, args.messages);
      retainedOrigin ??= recoverOriginalOrigin(record, mode);
      if (retainedOrigin.kind !== "legacy" && mode !== "legacy" && retainedOrigin.mode !== mode) {
        invalidOrigin("The original run metadata disagrees with its saved mode receipt.");
      }
      if (retainedOrigin.kind === "legacy" || !isEqual(originalTask(retainedOrigin), source.task)) {
        invalidOrigin("The saved original task does not match its proposal origin.");
      }
      break;
    }
    const predecessorId: string = source.task.proposalId;
    const predecessor: AgentProposalRecord | undefined = args.records.find((item) => item.proposal.id === predecessorId);
    if (predecessor === undefined) invalidOrigin("The original proposal predecessor is missing.");
    if (predecessor.replacedByProposalId !== record.proposal.id) invalidOrigin("The retained proposal predecessor does not name this replacement.");
    record = predecessor;
  }
  if (selected.replacedByProposalId !== null) invalidOrigin("The proposal being revised has already been replaced.");
  return retainedOrigin;
}

export function proposalOriginChapterId(args: RetainedOriginInput): string | null {
  const origin = retainedProposalOrigin(args);
  if (origin.kind === "legacy") return null;
  const task = originalTask(origin);
  if ("chapterId" in task) return task.chapterId;
  return task.kind === "conversation" ? task.targetChapterId : null;
}

export function resolveProposalOrigin(args: {
  task: AgentTask;
  mode: AgentMode;
  projectRoot: string;
  targetChapterId: string | null;
  blocks: Block[];
  sourceGeneration: string | null;
  records: AgentProposalRecord[];
  messages: AgentUIMessage[];
}): ResolvedProposalOrigin {
  if (args.task.kind !== "proposal-follow-up") {
    return { origin: captureProposalOrigin({ task: args.task, mode: args.mode, blocks: args.blocks, sourceGeneration: args.sourceGeneration }), mode: args.mode, task: args.task };
  }
  const retainedOrigin = retainedProposalOrigin({ ...args, proposalId: args.task.proposalId });
  if (retainedOrigin.kind === "legacy") return { origin: retainedOrigin, mode: args.mode, task: args.task };
  const mode = retainedOrigin.mode === "legacy" ? args.mode : retainedOrigin.mode;
  if (retainedOrigin.kind === "task") {
    const task = retainedOrigin.task;
    if ("chapterId" in task) requireChapter(task.chapterId, args.targetChapterId);
    if (task.kind === "conversation" && task.targetChapterId !== null) requireChapter(task.targetChapterId, args.targetChapterId);
    return { origin: retainedOrigin, mode, task };
  }
  requireChapter(retainedOrigin.chapterId, args.targetChapterId);
  const identity = retainedOrigin.identity;
  const canRelocate = identity !== undefined && args.sourceGeneration !== null
    && identity.generation !== args.sourceGeneration
    && !args.blocks.some((block) => identity.blockIds.includes(block.id));
  const resolvedLocators: Record<string, SourceLocator> = {};
  for (const original of scopeLocators(retainedOrigin)) {
    if (retainedOrigin.kind === "bridge") requireProse(original);
    const latest = identity === undefined ? original : identity.locators[original.sourceId];
    if (!canRelocate && !args.blocks.some((block) => block.id === latest.sourceId)) {
      throw new ProposalOriginError("source-missing", `The original selected source was removed, or its old receipt cannot prove a reload: ${latest.sourceId}. Start the original action again to select the current source.`);
    }
    const id = resolveBoundary(latest, args.blocks);
    resolvedLocators[original.sourceId] = blockLocator(args.blocks, id);
  }
  const origin = { ...retainedOrigin, identity: captureIdentity(args.sourceGeneration, args.blocks, resolvedLocators) };
  if (retainedOrigin.kind === "selected-block-edit") {
    if (retainedOrigin.blocks.length === 0 || new Set(retainedOrigin.blocks.map((item) => item.sourceId)).size !== retainedOrigin.blocks.length) invalidOrigin("The saved original selection is empty or duplicated.");
    return {
      origin,
      mode,
      task: {
        kind: retainedOrigin.kind,
        chapterId: retainedOrigin.chapterId,
        operation: retainedOrigin.operation,
        blockIds: retainedOrigin.blocks.map((locator) => resolvedLocators[locator.sourceId].sourceId),
      },
    };
  }
  return {
    origin,
    mode,
    task: {
      kind: "bridge",
      chapterId: retainedOrigin.chapterId,
      anchorBlockId: retainedOrigin.anchor === null ? null : resolvedLocators[retainedOrigin.anchor.sourceId].sourceId,
      successorBlockId: retainedOrigin.successor === null ? null : resolvedLocators[retainedOrigin.successor.sourceId].sourceId,
    },
  };
}
