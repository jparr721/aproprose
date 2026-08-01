import { useEffect } from "react";
import { z } from "zod";
import { abortAgentRunForProjectSwitch } from "@/lib/ai/agent-controller";
import {
  sanitizeAgentMessages,
  validateAgentMessages,
} from "@/lib/ai/agent-messages";
import { invalidProposalCorrelationIds } from "@/lib/ai/agent-proposals";
import type {
  AgentPersistenceIssue,
  PendingProposal,
  PersistedAgentSnapshot,
  PersistedAgentState,
  PersistedPendingProposal,
  PersistedUsage,
} from "@/lib/ai/agent-types";
import { pathHash } from "@/lib/path-hash";
import { readAppData, writeAppData } from "@/lib/tauri";
import { useAgentConsoleStore } from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";

const agentModeSchema = z.enum(["writing", "edit"]);

const agentTaskSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("conversation"),
      targetChapterId: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("bridge"),
      chapterId: z.string(),
      anchorBlockId: z.string(),
      successorBlockId: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("selected-block-edit"),
      chapterId: z.string(),
      blockIds: z.array(z.string()),
      operation: z.enum(["clean", "structure", "custom"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("chapter-analysis"),
      chapterId: z.string(),
      analysis: z.enum(["critique", "continuity"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("outline-sculpt"),
      chapterId: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("proposal-follow-up"),
      proposalId: z.string(),
    })
    .strict(),
]);

const draftContextRefSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("block"),
      chapterId: z.string(),
      blockId: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("outline-card"),
      chapterId: z.string(),
      cardId: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("finding"),
      chapterId: z.string(),
      findingId: z.string(),
    })
    .strict(),
]);

const draftSourceLocatorSchema = z
  .object({
    order: z.number().int(),
    sourceFingerprint: z.string(),
  })
  .strict();

const contextSnapshotSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["block", "outline-card", "finding"]),
    chapterId: z.string(),
    sourceId: z.string(),
    order: z.number().int(),
    sourceType: z.string(),
    label: z.string(),
    exactText: z.string(),
    sourceFingerprint: z.string(),
  })
  .strict();

const sourceLocatorSchema = z
  .object({
    sourceId: z.string(),
    order: z.number().int(),
    fingerprint: z.string(),
    sourceType: z.string(),
    label: z.string(),
    exactText: z.string(),
    previewText: z.string(),
  })
  .strict();

const blockChangeSchema = z
  .object({
    kind: z.enum(["rewrite", "insert", "remove", "move"]),
    blockId: z.string().nullable(),
    afterId: z.string().nullable(),
    type: z.enum(["narration", "dialogue"]).nullable(),
    speaker: z.string().nullable(),
    segments: z
      .array(
        z
          .object({
            kind: z.enum(["beat", "quote"]),
            text: z.string(),
          })
          .strict(),
      )
      .optional(),
    newText: z.string().nullable(),
    toIndex: z.number().int().nullable(),
    reason: z.string(),
  })
  .strict();

const sculptChangeSchema = z
  .object({
    kind: z.enum(["rewrite", "add", "move", "remove"]),
    cardId: z.string().nullable(),
    title: z.string().nullable(),
    intention: z.string().nullable(),
    toIndex: z.number().int().nullable(),
    reason: z.string(),
  })
  .strict();

const manuscriptPreconditionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("target"),
      target: sourceLocatorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("insert"),
      anchor: sourceLocatorSchema.nullable(),
      expectedNext: sourceLocatorSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("move"),
      target: sourceLocatorSchema,
      orderFingerprint: z.string(),
    })
    .strict(),
]);

const outlinePreconditionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("card"),
      target: sourceLocatorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("outline-order"),
      orderFingerprint: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("outline-move"),
      target: sourceLocatorSchema,
      orderFingerprint: z.string(),
    })
    .strict(),
]);

const pendingProposalBase = {
  id: z.string(),
  chapterId: z.string(),
  summary: z.string(),
  createdAt: z.string(),
  originatingMessageId: z.string(),
};

const pendingProposalSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...pendingProposalBase,
        kind: z.literal("manuscript"),
        changes: z.array(
          z
            .object({
              id: z.string(),
              change: blockChangeSchema,
              precondition: manuscriptPreconditionSchema,
            })
            .strict(),
        ),
      })
      .strict(),
    z
      .object({
        ...pendingProposalBase,
        kind: z.literal("outline"),
        changes: z.array(
          z
            .object({
              id: z.string(),
              change: sculptChangeSchema,
              precondition: outlinePreconditionSchema,
            })
            .strict(),
        ),
      })
      .strict(),
  ])
  .superRefine((proposal, context) => {
    const invalidChangeIds = new Set(
      invalidProposalCorrelationIds(proposal),
    );
    proposal.changes.forEach((change, index) => {
      if (!invalidChangeIds.has(change.id)) return;
      context.addIssue({
        code: "custom",
        message: "Proposal change and precondition kinds do not match.",
        path: ["changes", index, "precondition"],
      });
    });
  });

const languageModelUsageSchema = z
  .object({
    inputTokens: z.number().optional(),
    inputTokenDetails: z
      .object({
        noCacheTokens: z.number().optional(),
        cacheReadTokens: z.number().optional(),
        cacheWriteTokens: z.number().optional(),
      })
      .strict(),
    outputTokens: z.number().optional(),
    outputTokenDetails: z
      .object({
        textTokens: z.number().optional(),
        reasoningTokens: z.number().optional(),
      })
      .strict(),
    totalTokens: z.number().optional(),
    reasoningTokens: z.number().optional(),
    cachedInputTokens: z.number().optional(),
    raw: z.record(z.string(), z.json()).optional(),
  })
  .strict();

const persistedUsageSchema = z
  .object({
    modelId: z.string(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    contextWindow: z.number().int().positive(),
    raw: languageModelUsageSchema,
  })
  .strict();

const messageMetadataSchema = z
  .object({
    runId: z.string(),
    mode: agentModeSchema,
    task: agentTaskSchema,
    state: z.enum(["complete", "stopped", "error"]),
    createdAt: z.string(),
    error: z.string().nullable(),
    errorCode: z
      .enum(["configuration", "transport", "tool", "compaction", "unknown"])
      .nullable(),
    retryOf: z.string().nullable(),
    usage: persistedUsageSchema.nullable(),
  })
  .strict();

const critiqueNoteSchema = z
  .object({
    kind: z.enum(["strength", "watch", "idea"]),
    tag: z.string(),
    text: z.string(),
    blockIds: z.array(z.string()),
  })
  .strict();

const continuityFlagSchema = z
  .object({
    sev: z.enum(["ok", "warn", "flag"]),
    tag: z.string(),
    text: z.string(),
    blockIds: z.array(z.string()),
  })
  .strict();

const dataPartSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("data-context"),
      id: z.string().optional(),
      data: z
        .object({ snapshots: z.array(contextSnapshotSchema) })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("data-proposal-event"),
      id: z.string().optional(),
      data: z
        .object({
          proposalId: z.string(),
          action: z.enum([
            "staged",
            "accepted",
            "accepted-all",
            "rejected",
            "rejected-all",
          ]),
          changeCount: z.number().int().nonnegative(),
          text: z.string(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("data-compaction"),
      id: z.string().optional(),
      data: z
        .object({
          throughMessageId: z.string(),
          text: z.string(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("data-findings"),
      id: z.string().optional(),
      data: z.discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("critique"),
            chapterId: z.string(),
            items: z.array(critiqueNoteSchema),
          })
          .strict(),
        z
          .object({
            kind: z.literal("continuity"),
            chapterId: z.string(),
            items: z.array(continuityFlagSchema),
          })
          .strict(),
      ]),
    })
    .strict(),
]);

const agentToolSummarySchema = z
  .object({
    label: z.string(),
    target: z.string(),
    detail: z.string(),
    itemCount: z.number().int().nonnegative(),
  })
  .strict();

const persistedToolOutputSchema = z
  .object({
    kind: z.literal("summary"),
    summary: agentToolSummarySchema,
  })
  .strict();

const persistablePartTypes = new Set<string>([
  "text",
  "source-url",
  "source-document",
  "file",
  "step-start",
  "data-context",
  "data-proposal-event",
  "data-compaction",
  "data-findings",
  "dynamic-tool",
  "tool-read_chapter",
  "tool-read_outline",
  "tool-read_lore",
  "tool-run_critique",
  "tool-run_continuity",
  "tool-read_conversation_context",
  "tool-read_pending_proposal",
  "tool-stage_manuscript_proposal",
  "tool-stage_outline_proposal",
]);

const messageEnvelopeSchema = z
  .object({
    id: z.string(),
    role: z.enum(["user", "assistant"]),
    metadata: messageMetadataSchema,
    parts: z.array(z.unknown()),
  })
  .strict();

const persistedAgentStateSchema = z
  .object({
    v: z.literal(3),
    mode: agentModeSchema,
    messages: z.array(messageEnvelopeSchema),
    summary: z
      .object({
        text: z.string(),
        throughMessageId: z.string(),
      })
      .strict()
      .nullable(),
    draftText: z.string(),
    draftContextRefs: z.array(draftContextRefSchema),
    draftSourceLocators: z.record(z.string(), draftSourceLocatorSchema),
    pendingProposal: pendingProposalSchema.nullable(),
    lastUsage: persistedUsageSchema.nullable(),
    interruptedRun: z
      .object({
        runId: z.string(),
        userMessageId: z.string(),
        assistantMessageId: z.string().nullable(),
        reason: z.enum(["stopped", "project-switch", "app-exit"]),
        interruptedAt: z.string(),
      })
      .strict()
      .nullable(),
  })
  .strict();

type AgentSnapshotSource = Pick<
  ReturnType<typeof useAgentConsoleStore.getState>,
  | "mode"
  | "messages"
  | "summary"
  | "draftText"
  | "draftContextRefs"
  | "draftSourceLocators"
  | "pendingProposal"
  | "lastUsage"
  | "interruptedRun"
>;

interface FailedRecoveryState {
  source: AgentSnapshotSource;
  revision: number;
}

interface FailedWriteSave {
  kind: "write";
  root: string;
  snapshot: PersistedAgentSnapshot;
  issue: AgentPersistenceIssue;
  revision: number;
  recovery: FailedRecoveryState | null;
}

interface FailedSnapshotSave {
  kind: "snapshot";
  root: string;
  source: AgentSnapshotSource;
  issue: AgentPersistenceIssue;
  revision: number;
  recovery: FailedRecoveryState | null;
}

type FailedAgentSave = FailedWriteSave | FailedSnapshotSave;

const SAVE_DEBOUNCE_MS = 400;

let activeRoot: string | null = null;
let writableRoot: string | null = null;
let requestedRoot: string | null = null;
let recoveryRoot: string | null = null;
const failedSaves = new Map<string, FailedAgentSave>();
let transition: Promise<void> = Promise.resolve();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let activeRevision = 0;
let persistedRevision = 0;
let revisionSequence = 0;

export class AgentPersistenceError extends Error {
  readonly issue: AgentPersistenceIssue;

  constructor(issue: AgentPersistenceIssue) {
    super(issue.message);
    this.name = "AgentPersistenceError";
    this.issue = issue;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function persistenceError(
  kind: AgentPersistenceIssue["kind"],
  root: string,
  error: unknown,
): AgentPersistenceError {
  return new AgentPersistenceError({
    kind,
    projectRoot: root,
    message: `Failed to ${kind} agent conversation for ${root}: ${errorMessage(error)}`,
  });
}

function isVersion(raw: unknown, version: number): boolean {
  return (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    "v" in raw &&
    Number.isInteger(raw.v) &&
    raw.v === version
  );
}

function validatePersistedParts(messages: Array<{ parts: unknown[] }>): void {
  for (const message of messages) {
    for (const part of message.parts) {
      if (
        typeof part !== "object" ||
        part === null ||
        !("type" in part) ||
        typeof part.type !== "string" ||
        !persistablePartTypes.has(part.type)
      ) {
        throw new Error("Unknown agent message part cannot be persisted.");
      }
      if (part.type.startsWith("data-")) {
        dataPartSchema.parse(part);
      }
      if (
        part.type === "text" &&
        "state" in part &&
        part.state !== "done"
      ) {
        throw new Error("Persisted agent text must be settled.");
      }
      if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
        if (!("state" in part) || part.state !== "output-available") {
          throw new Error("Incomplete agent tool calls cannot be persisted.");
        }
        if ("preliminary" in part && part.preliminary === true) {
          throw new Error("Preliminary agent tool results cannot be persisted.");
        }
        if (!("output" in part)) {
          throw new Error("Completed agent tool output is missing.");
        }
        persistedToolOutputSchema.parse(part.output);
      }
    }
  }
}

function normalizedUsage(
  usage: z.infer<typeof persistedUsageSchema>,
): PersistedUsage {
  return {
    modelId: usage.modelId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    contextWindow: usage.contextWindow,
    raw: {
      inputTokens: usage.raw.inputTokens,
      inputTokenDetails: {
        noCacheTokens: usage.raw.inputTokenDetails.noCacheTokens,
        cacheReadTokens: usage.raw.inputTokenDetails.cacheReadTokens,
        cacheWriteTokens: usage.raw.inputTokenDetails.cacheWriteTokens,
      },
      outputTokens: usage.raw.outputTokens,
      outputTokenDetails: {
        textTokens: usage.raw.outputTokenDetails.textTokens,
        reasoningTokens: usage.raw.outputTokenDetails.reasoningTokens,
      },
      totalTokens: usage.raw.totalTokens,
      reasoningTokens: usage.raw.reasoningTokens,
      cachedInputTokens: usage.raw.cachedInputTokens,
      raw: usage.raw.raw,
    },
  };
}

function appendTransition(work: () => Promise<void>): Promise<void> {
  const pending = transition.then(work, work);
  transition = pending.catch(() => undefined);
  return pending;
}

function clearSaveTimer(): void {
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
}

function saveIssue(root: string, error: unknown): AgentPersistenceError {
  const failure =
    error instanceof AgentPersistenceError && error.issue.kind === "save"
      ? error
      : persistenceError("save", root, error);
  useAgentConsoleStore.getState().setPersistenceIssue(failure.issue);
  return failure;
}

function firstFailedSave(): FailedAgentSave | null {
  const first = failedSaves.values().next();
  return first.done ? null : first.value;
}

function failedSaveForRoot(root: string): FailedAgentSave | null {
  return failedSaves.get(root) ?? null;
}

function failedSaveForRetry(): FailedAgentSave | null {
  if (activeRoot !== null) {
    const activeFailure = failedSaveForRoot(activeRoot);
    if (activeFailure !== null) return activeFailure;
  }
  return firstFailedSave();
}

function nextRevision(): number {
  revisionSequence += 1;
  return revisionSequence;
}

function failedSaveRevision(failure: FailedAgentSave): number {
  if (failure.recovery === null) return failure.revision;
  return Math.max(failure.revision, failure.recovery.revision);
}

function recordFailedSave(failure: FailedAgentSave): void {
  const retainedFailure = failedSaveForRoot(failure.root);
  if (
    retainedFailure !== null &&
    failedSaveRevision(retainedFailure) > failedSaveRevision(failure)
  ) {
    useAgentConsoleStore
      .getState()
      .setPersistenceIssue(retainedFailure.issue);
    return;
  }
  failedSaves.set(failure.root, failure);
  useAgentConsoleStore.getState().setPersistenceIssue(failure.issue);
}

function recordRecoveryState(
  root: string,
  source: AgentSnapshotSource,
  revision: number,
): void {
  const failure = failedSaveForRoot(root);
  if (failure === null) {
    throw new Error(`Agent recovery state is missing for ${root}.`);
  }
  if (
    failure.recovery !== null &&
    failure.recovery.revision > revision
  ) {
    return;
  }
  failedSaves.set(root, {
    ...failure,
    recovery: { source, revision },
  });
}

function clearRecoveredFailure(
  root: string,
  savedRevision: number,
): void {
  const failure = failedSaveForRoot(root);
  if (
    failure !== null &&
    failedSaveRevision(failure) > savedRevision
  ) {
    return;
  }
  if (failure !== null) failedSaves.delete(root);
  const currentIssue = useAgentConsoleStore.getState().persistenceIssue;
  if (currentIssue === null || currentIssue.projectRoot !== root) return;
  useAgentConsoleStore
    .getState()
    .setPersistenceIssue(firstFailedSave()?.issue ?? null);
}

function restoreFailedSaveIssue(): void {
  const failure = firstFailedSave();
  if (failure === null) return;
  useAgentConsoleStore.getState().setPersistenceIssue(failure.issue);
}

function logPersistenceFailure(root: string, error: unknown): void {
  console.error("Agent persistence operation failed", { root, error });
}

function persistedFieldsChanged(
  state: ReturnType<typeof useAgentConsoleStore.getState>,
  previous: ReturnType<typeof useAgentConsoleStore.getState>,
): boolean {
  return (
    state.mode !== previous.mode ||
    state.messages !== previous.messages ||
    state.summary !== previous.summary ||
    state.draftText !== previous.draftText ||
    state.draftContextRefs !== previous.draftContextRefs ||
    state.draftSourceLocators !== previous.draftSourceLocators ||
    state.pendingProposal !== previous.pendingProposal ||
    state.lastUsage !== previous.lastUsage ||
    state.interruptedRun !== previous.interruptedRun
  );
}

export function agentStateKey(root: string): string {
  return `ai-${pathHash(root)}`;
}

export function emptyPersistedAgentState(): PersistedAgentSnapshot &
  PersistedAgentState {
  return {
    v: 3,
    mode: "writing",
    messages: [],
    summary: null,
    draftText: "",
    draftContextRefs: [],
    draftSourceLocators: {},
    pendingProposal: null,
    lastUsage: null,
    interruptedRun: null,
  };
}

export async function resetAgentConversation(root: string): Promise<void> {
  const empty = emptyPersistedAgentState();
  const capture = useAgentConsoleStore
    .getState()
    .beginPersistenceTransition(root, "reset");
  try {
    await writeAppData(agentStateKey(root), empty);
  } catch (error) {
    useAgentConsoleStore.getState().finishPersistenceTransition(capture);
    throw error;
  }
  if (activeRoot !== root || requestedRoot !== root) {
    useAgentConsoleStore.getState().finishPersistenceTransition(capture);
    return;
  }
  const rebasedMutation = useAgentConsoleStore
    .getState()
    .completePersistenceTransition(capture, empty);
  const resetRevision = nextRevision();
  recoveryRoot = null;
  writableRoot = root;
  activeRevision = rebasedMutation ? nextRevision() : resetRevision;
  persistedRevision = resetRevision;
  if (rebasedMutation) scheduleAgentSave();
}

function captureAgentSnapshotSource(): AgentSnapshotSource {
  const state = useAgentConsoleStore.getState();
  return {
    mode: state.mode,
    messages: state.messages,
    summary: state.summary,
    draftText: state.draftText,
    draftContextRefs: state.draftContextRefs,
    draftSourceLocators: state.draftSourceLocators,
    pendingProposal: state.pendingProposal,
    lastUsage: state.lastUsage,
    interruptedRun: state.interruptedRun,
  };
}

function toPersistedPendingProposal(
  proposal: PendingProposal | null,
): PersistedPendingProposal | null {
  if (proposal === null) return null;
  const base = {
    id: proposal.id,
    chapterId: proposal.chapterId,
    summary: proposal.summary,
    createdAt: proposal.createdAt,
    originatingMessageId: proposal.originatingMessageId,
  };
  if (proposal.kind === "manuscript") {
    return { ...base, kind: proposal.kind, changes: proposal.changes };
  }
  return { ...base, kind: proposal.kind, changes: proposal.changes };
}

function restorePendingProposal(
  root: string,
  proposal: PersistedPendingProposal | null,
): PendingProposal | null {
  if (proposal === null) return null;
  if (proposal.kind === "manuscript") {
    return { ...proposal, projectRoot: root };
  }
  return { ...proposal, projectRoot: root };
}

async function snapshotFromSource(
  source: AgentSnapshotSource,
): Promise<PersistedAgentSnapshot> {
  const snapshot: PersistedAgentSnapshot = {
    v: 3,
    mode: source.mode,
    messages: sanitizeAgentMessages(source.messages),
    summary: source.summary,
    draftText: source.draftText,
    draftContextRefs: source.draftContextRefs,
    draftSourceLocators: source.draftSourceLocators,
    pendingProposal: toPersistedPendingProposal(source.pendingProposal),
    lastUsage: source.lastUsage,
    interruptedRun: source.interruptedRun,
  };
  return structuredClone(snapshot);
}

export function toAgentSnapshot(): Promise<PersistedAgentSnapshot> {
  return snapshotFromSource(captureAgentSnapshotSource());
}

async function parseAgentSnapshot(
  raw: unknown,
): Promise<PersistedAgentSnapshot> {
  const parsed = persistedAgentStateSchema.parse(raw);
  const normalizedMessages = parsed.messages.map((message) => ({
    ...message,
    metadata: {
      ...message.metadata,
      usage:
        message.metadata.usage === null
          ? null
          : normalizedUsage(message.metadata.usage),
    },
  }));
  validatePersistedParts(normalizedMessages);
  const messages = await validateAgentMessages(normalizedMessages);
  return {
    v: 3,
    mode: parsed.mode,
    messages,
    summary: parsed.summary,
    draftText: parsed.draftText,
    draftContextRefs: parsed.draftContextRefs,
    draftSourceLocators: parsed.draftSourceLocators,
    pendingProposal: parsed.pendingProposal,
    lastUsage:
      parsed.lastUsage === null ? null : normalizedUsage(parsed.lastUsage),
    interruptedRun: parsed.interruptedRun,
  };
}

function restoreAgentSnapshot(
  root: string,
  snapshot: PersistedAgentSnapshot,
): PersistedAgentState {
  return {
    ...snapshot,
    pendingProposal: restorePendingProposal(
      root,
      snapshot.pendingProposal,
    ),
  };
}

export async function fromAgentSnapshot(
  root: string,
  raw: unknown,
): Promise<PersistedAgentState> {
  if (raw === null) return emptyPersistedAgentState();
  if (isVersion(raw, 1) || isVersion(raw, 2)) {
    return emptyPersistedAgentState();
  }
  try {
    const parsed = await parseAgentSnapshot(raw);
    return restoreAgentSnapshot(root, parsed);
  } catch (error) {
    throw persistenceError("corrupt", root, error);
  }
}

function stateFromFailedSave(
  root: string,
  failure: FailedAgentSave,
): PersistedAgentState {
  if (failure.recovery !== null) {
    const source = failure.recovery.source;
    return {
      v: 3,
      mode: source.mode,
      messages: source.messages,
      summary: source.summary,
      draftText: source.draftText,
      draftContextRefs: source.draftContextRefs,
      draftSourceLocators: source.draftSourceLocators,
      pendingProposal: restorePendingProposal(
        root,
        toPersistedPendingProposal(source.pendingProposal),
      ),
      lastUsage: source.lastUsage,
      interruptedRun: source.interruptedRun,
    };
  }
  if (failure.kind === "write") {
    return restoreAgentSnapshot(root, failure.snapshot);
  }
  const source = failure.source;
  return {
    v: 3,
    mode: source.mode,
    messages: source.messages,
    summary: source.summary,
    draftText: source.draftText,
    draftContextRefs: source.draftContextRefs,
    draftSourceLocators: source.draftSourceLocators,
    pendingProposal: restorePendingProposal(
      root,
      toPersistedPendingProposal(source.pendingProposal),
    ),
    lastUsage: source.lastUsage,
    interruptedRun: source.interruptedRun,
  };
}

export async function loadAgentState(
  root: string,
): Promise<PersistedAgentState> {
  let raw: unknown;
  try {
    raw = await readAppData<unknown>(agentStateKey(root));
  } catch (error) {
    throw persistenceError("load", root, error);
  }
  return fromAgentSnapshot(root, raw);
}

export async function saveAgentState(
  root: string,
  snapshot: PersistedAgentSnapshot,
): Promise<void> {
  const revision = nextRevision();
  const resetsActiveRecovery =
    recoveryRoot === root &&
    activeRoot === root &&
    requestedRoot === root;
  const recoveryCapture = resetsActiveRecovery
    ? useAgentConsoleStore
        .getState()
        .beginPersistenceTransition(root, "recovery")
    : null;
  let safeSnapshot: PersistedAgentSnapshot;
  try {
    safeSnapshot = await parseAgentSnapshot(structuredClone(snapshot));
  } catch (error) {
    if (recoveryCapture !== null) {
      useAgentConsoleStore
        .getState()
        .finishPersistenceTransition(recoveryCapture);
    }
    throw saveIssue(root, error);
  }
  try {
    await writeAgentSnapshot(root, safeSnapshot, revision);
  } catch (error) {
    if (recoveryCapture !== null) {
      useAgentConsoleStore
        .getState()
        .finishPersistenceTransition(recoveryCapture);
    }
    throw error;
  }
  if (resetsActiveRecovery && failedSaveForRoot(root) === null) {
    if (
      activeRoot !== root ||
      requestedRoot !== root ||
      recoveryCapture === null
    ) {
      if (recoveryCapture !== null) {
        useAgentConsoleStore
          .getState()
          .finishPersistenceTransition(recoveryCapture);
      }
      return;
    }
    const rebasedMutation = useAgentConsoleStore
      .getState()
      .completePersistenceTransition(
        recoveryCapture,
        restoreAgentSnapshot(root, safeSnapshot),
      );
    recoveryRoot = null;
    writableRoot = root;
    activeRevision = rebasedMutation ? nextRevision() : revision;
    persistedRevision = revision;
    restoreFailedSaveIssue();
    if (rebasedMutation) scheduleAgentSave();
    return;
  }
  if (recoveryCapture !== null) {
    useAgentConsoleStore
      .getState()
      .finishPersistenceTransition(recoveryCapture);
  }
  if (
    activeRoot === root &&
    requestedRoot === root &&
    failedSaveForRoot(root) === null
  ) {
    recoveryRoot = null;
    writableRoot = root;
  }
}

function markRevisionPersisted(root: string, revision: number): void {
  if (
    root !== activeRoot ||
    revision !== activeRevision
  ) {
    return;
  }
  persistedRevision = revision;
}

async function writeAgentSnapshot(
  root: string,
  snapshot: PersistedAgentSnapshot,
  revision: number,
): Promise<void> {
  try {
    await writeAppData(agentStateKey(root), snapshot);
    clearRecoveredFailure(root, revision);
    markRevisionPersisted(root, revision);
  } catch (error) {
    const failure = saveIssue(root, error);
    recordFailedSave({
      kind: "write",
      root,
      snapshot: structuredClone(snapshot),
      issue: failure.issue,
      revision,
      recovery: null,
    });
    throw failure;
  }
}

function recordSnapshotFailure(
  root: string,
  source: AgentSnapshotSource,
  revision: number,
  error: unknown,
): AgentPersistenceError {
  const failure = saveIssue(root, error);
  recordFailedSave({
    kind: "snapshot",
    root,
    source,
    issue: failure.issue,
    revision,
    recovery: null,
  });
  return failure;
}

async function persistSnapshotSource(
  root: string,
  source: AgentSnapshotSource,
  revision: number,
): Promise<void> {
  let snapshot: PersistedAgentSnapshot;
  try {
    snapshot = await snapshotFromSource(source);
    snapshot = await parseAgentSnapshot(snapshot);
  } catch (error) {
    throw recordSnapshotFailure(root, source, revision, error);
  }
  await writeAgentSnapshot(root, snapshot, revision);
}

function captureActiveSnapshot(root: string): Promise<void> {
  const source = captureAgentSnapshotSource();
  const revision = nextRevision();
  if (activeRoot === root) activeRevision = revision;
  return appendTransition(async () => {
    try {
      await persistSnapshotSource(root, source, revision);
    } catch (error) {
      logPersistenceFailure(root, error);
    }
  });
}

function flushActiveSnapshot(): void {
  clearSaveTimer();
  const root = activeRoot;
  if (
    root === null ||
    writableRoot !== root ||
    requestedRoot !== root
  ) {
    return;
  }
  void captureActiveSnapshot(root);
}

function scheduleAgentSave(): void {
  clearSaveTimer();
  const root = activeRoot;
  if (
    root === null ||
    writableRoot !== root ||
    requestedRoot !== root
  ) {
    return;
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (
      activeRoot !== root ||
      writableRoot !== root ||
      requestedRoot !== root
    ) {
      return;
    }
    void captureActiveSnapshot(root);
  }, SAVE_DEBOUNCE_MS);
}

export function transitionAgentProject(nextRoot: string | null): Promise<void> {
  requestedRoot = nextRoot;
  clearSaveTimer();
  return appendTransition(async () => {
    const oldRoot = activeRoot;
    const keepsRootOwnership = oldRoot !== null && oldRoot === nextRoot;
    let persistenceCapture =
      keepsRootOwnership && nextRoot !== null
        ? useAgentConsoleStore
            .getState()
            .beginPersistenceTransition(nextRoot, "load")
        : null;
    const oldRootWasWritable = oldRoot !== null && writableRoot === oldRoot;
    const oldRootWasRecovering = oldRoot !== null && recoveryRoot === oldRoot;
    writableRoot = null;
    if (oldRoot !== null) {
      abortAgentRunForProjectSwitch(oldRoot, "project-switch");
    }

    if (oldRoot !== null && oldRootWasWritable) {
      const source = captureAgentSnapshotSource();
      const revision = nextRevision();
      activeRevision = revision;
      try {
        await persistSnapshotSource(oldRoot, source, revision);
      } catch (error) {
        logPersistenceFailure(oldRoot, error);
      }
    }

    if (oldRoot !== null && oldRootWasRecovering) {
      const revision = nextRevision();
      activeRevision = revision;
      recordRecoveryState(
        oldRoot,
        captureAgentSnapshotSource(),
        revision,
      );
    }

    if (!keepsRootOwnership) {
      useAgentConsoleStore.getState().resetProject();
    }
    activeRoot = nextRoot;
    recoveryRoot = null;
    activeRevision = 0;
    persistedRevision = 0;
    if (nextRoot === null) {
      restoreFailedSaveIssue();
      return;
    }

    const retainedFailure = failedSaveForRoot(nextRoot);
    if (retainedFailure !== null) {
      const retainedState = stateFromFailedSave(nextRoot, retainedFailure);
      if (requestedRoot !== nextRoot) {
        if (persistenceCapture !== null) {
          useAgentConsoleStore
            .getState()
            .finishPersistenceTransition(persistenceCapture);
        }
        return;
      }
      if (persistenceCapture === null) {
        useAgentConsoleStore.getState().hydrate(nextRoot, retainedState);
      } else {
        useAgentConsoleStore
          .getState()
          .completePersistenceTransition(persistenceCapture, retainedState);
      }
      recoveryRoot = nextRoot;
      activeRevision = failedSaveRevision(retainedFailure);
      persistedRevision = 0;
      useAgentConsoleStore
        .getState()
        .setPersistenceIssue(retainedFailure.issue);
      return;
    }

    if (persistenceCapture === null) {
      persistenceCapture = useAgentConsoleStore
        .getState()
        .beginPersistenceTransition(nextRoot, "load");
    }
    const capture = persistenceCapture;
    let loaded: PersistedAgentState;
    try {
      loaded = await loadAgentState(nextRoot);
    } catch (error) {
      if (requestedRoot === nextRoot) {
        const failure =
          error instanceof AgentPersistenceError
            ? error
            : persistenceError("load", nextRoot, error);
        useAgentConsoleStore.getState().setPersistenceIssue(failure.issue);
      }
      useAgentConsoleStore.getState().finishPersistenceTransition(capture);
      return;
    }
    if (requestedRoot !== nextRoot) {
      useAgentConsoleStore.getState().finishPersistenceTransition(capture);
      return;
    }

    const rebasedMutation = useAgentConsoleStore
      .getState()
      .completePersistenceTransition(capture, loaded);
    const hydratedRevision = nextRevision();
    activeRevision = rebasedMutation ? nextRevision() : hydratedRevision;
    persistedRevision = hydratedRevision;
    writableRoot = nextRoot;
    restoreFailedSaveIssue();
    if (rebasedMutation) scheduleAgentSave();
  });
}

export function retryAgentPersistence(): Promise<void> {
  return appendTransition(async () => {
    const retry = failedSaveForRetry();
    if (retry !== null) {
      const recoveringActiveRoot =
        recoveryRoot === retry.root &&
        activeRoot === retry.root &&
        requestedRoot === retry.root;
      if (retry.kind === "write") {
        await writeAgentSnapshot(
          retry.root,
          retry.snapshot,
          retry.revision,
        );
      } else {
        await persistSnapshotSource(
          retry.root,
          retry.source,
          retry.revision,
        );
      }
      if (retry.recovery !== null) {
        await persistSnapshotSource(
          retry.root,
          retry.recovery.source,
          retry.recovery.revision,
        );
      }
      if (
        recoveringActiveRoot &&
        failedSaveForRoot(retry.root) === null
      ) {
        recoveryRoot = null;
        writableRoot = retry.root;
      }
      if (activeRevision !== persistedRevision) scheduleAgentSave();
      return;
    }
    const root = activeRoot;
    if (
      root === null ||
      writableRoot !== root ||
      requestedRoot !== root
    ) {
      return;
    }
    const revision = nextRevision();
    activeRevision = revision;
    await persistSnapshotSource(
      root,
      captureAgentSnapshotSource(),
      revision,
    );
  });
}

export function useAgentPersistence(): void {
  useEffect(() => {
    const initialRoot = useProjectStore.getState().project?.root ?? null;
    void transitionAgentProject(initialRoot).catch((error: unknown) => {
      logPersistenceFailure(initialRoot ?? "closed project", error);
    });

    const unsubscribeProject = useProjectStore.subscribe((state, previous) => {
      const root = state.project?.root ?? null;
      const previousRoot = previous.project?.root ?? null;
      if (root === previousRoot) return;
      void transitionAgentProject(root).catch((error: unknown) => {
        logPersistenceFailure(root ?? "closed project", error);
      });
    });
    const unsubscribeConsole = useAgentConsoleStore.subscribe(
      (state, previous) => {
        if (!persistedFieldsChanged(state, previous)) return;
        if (
          activeRoot !== null &&
          state.hydratedProjectRoot === activeRoot
        ) {
          activeRevision = nextRevision();
        }
        scheduleAgentSave();
      },
    );
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") flushActiveSnapshot();
    };
    const onPageHide = (): void => {
      clearSaveTimer();
      const root = activeRoot;
      if (root === null || requestedRoot !== root) return;
      abortAgentRunForProjectSwitch(root, "app-exit");
      clearSaveTimer();
      if (writableRoot !== root) return;
      void captureActiveSnapshot(root);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearSaveTimer();
      unsubscribeProject();
      unsubscribeConsole();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);
}
