import { useEffect } from "react";
import { isEqual } from "es-toolkit";
import { z } from "zod";
import { abortAgentRunForProjectSwitch } from "@/lib/ai/agent-controller";
import {
  hasAssistantOutput,
  sanitizeAgentMessages,
  validateAgentMessages,
} from "@/lib/ai/agent-messages";
import { invalidProposalCorrelationIds } from "@/lib/ai/agent-proposals";
import type {
  AgentSessionId,
  AgentPersistenceIssue,
  PendingProposal,
  PersistedAgentSnapshot,
  PersistedAgentState,
  PersistedPendingProposal,
  PersistedUsage,
} from "@/lib/ai/agent-types";
import { PROJECT_AGENT_SESSION } from "@/lib/ai/agent-types";
import { pathHash } from "@/lib/path-hash";
import { legacyAgentFailure } from "@/lib/ai/agent-failure";
import { readAppData, writeAppData } from "@/lib/tauri";
import {
  type AgentPersistenceTransitionCapture,
  AgentConsoleOwnershipError,
  agentSessionStore,
  agentConsoleOwnershipStatus,
  clearOutlineAgentSessions,
  outlineAgentSessionEntries,
  subscribeAgentSessionRegistry,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";

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
      boundary: z.enum(["immediate", "next-prose"]),
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

const overviewChangeSchema = z
  .object({
    id: z.string(),
    before: z.string(),
    after: z.string(),
    reason: z.string(),
    sourceFingerprint: z.string(),
  })
  .strict();

const pendingProposalBase = {
  id: z.string(),
  chapterId: z.string(),
  summary: z.string(),
  createdAt: z.string(),
  originatingMessageId: z.string(),
  overviewChange: overviewChangeSchema.nullable().optional(),
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
        kind: z.literal("overview"),
        chapterId: z.null(),
        changes: z.tuple([]),
        overviewChange: overviewChangeSchema,
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

const agentFailureSchema = z
  .object({
    reason: z.enum([
      "model-unselected",
      "key-missing",
      "key-rejected",
      "model-unavailable",
      "settings-unavailable",
      "quota",
      "transport",
      "tool",
      "compaction",
      "transition",
      "unknown",
    ]),
    message: z.string(),
    action: z
      .enum(["retry", "add-key", "replace-key", "choose-model"])
      .nullable(),
    settingsTarget: z.enum(["key", "model"]).nullable(),
  })
  .strict();

const messageMetadataSchema = z
  .object({
    runId: z.string(),
    mode: agentModeSchema,
    task: agentTaskSchema,
    state: z.enum(["complete", "stopped", "error"]),
    createdAt: z.string(),
    failure: agentFailureSchema.nullable().optional(),
    error: z.string().nullable().optional(),
    errorCode: z
      .enum([
        "configuration",
        "quota",
        "transport",
        "tool",
        "compaction",
        "transition",
        "unknown",
      ])
      .nullable()
      .optional(),
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
  "tool-stage_overview_proposal",
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

const persistedAgentSessionCollectionSchema = z
  .object({
    v: z.literal(1),
    sessions: z.record(z.string(), z.unknown()),
  })
  .strict();

interface LoadedAgentSessionCollection {
  project: PersistedAgentState;
  outlines: Record<string, PersistedAgentState>;
  corruptOutlineChapterIds: string[];
}

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

let writableRoot: string | null = null;
let recoveryRoot: string | null = null;
const failedSaves = new Map<string, FailedAgentSave>();
let transition: Promise<void> = Promise.resolve();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let sessionCollectionSaveTimer: ReturnType<typeof setTimeout> | null = null;
const outlineHydrations = new Map<string, Promise<void>>();
const sessionCollectionSaveQueues = new Map<string, Promise<void>>();
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
        if (
          !("state" in part) ||
          (part.state !== "output-available" &&
            part.state !== "output-error" &&
            part.state !== "output-denied")
        ) {
          throw new Error("Incomplete agent tool calls cannot be persisted.");
        }
        if (part.state === "output-available") {
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

function ownsPersistenceCapture(
  capture: AgentPersistenceTransitionCapture,
): boolean {
  const transitionState =
    useAgentConsoleStore.getState().persistenceTransition;
  return (
    transitionState?.generation === capture.generation &&
    transitionState.projectRoot === capture.projectRoot
  );
}

function clearSaveTimer(): void {
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
}

function clearSessionCollectionSaveTimer(): void {
  if (sessionCollectionSaveTimer === null) return;
  clearTimeout(sessionCollectionSaveTimer);
  sessionCollectionSaveTimer = null;
}

function scheduleAgentSessionCollectionSave(
  requestedChapterId?: string | null,
): void {
  const chapterId = requestedChapterId ?? null;
  clearSessionCollectionSaveTimer();
  const root = useAgentConsoleStore.getState().activeProjectRoot;
  if (root === null || writableRoot !== root) return;
  sessionCollectionSaveTimer = setTimeout(() => {
    sessionCollectionSaveTimer = null;
    if (writableRoot !== root) return;
    void saveAgentSessionCollection(root).then(
      () => {
        if (chapterId === null) return;
        const store = agentSessionStore({ kind: "outline", chapterId });
        if (store.getState().persistenceIssue?.kind === "save") {
          store.getState().setPersistenceIssue(null);
        }
      },
      (error) => {
        if (chapterId !== null) {
          agentSessionStore({ kind: "outline", chapterId })
            .getState()
            .setPersistenceIssue({
              kind: "save",
              projectRoot: root,
              message: errorMessage(error),
            });
        }
        logPersistenceFailure(root, error);
      },
    );
  }, SAVE_DEBOUNCE_MS);
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
  const activeProjectRoot =
    useAgentConsoleStore.getState().activeProjectRoot;
  if (activeProjectRoot !== null) {
    const activeFailure = failedSaveForRoot(activeProjectRoot);
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

export function agentSessionCollectionKey(root: string): string {
  return `ai-sessions-${pathHash(root)}`;
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

export function resetAgentConversation(
  root: string,
  requestedSessionId?: AgentSessionId,
): Promise<void> {
  const sessionId = requestedSessionId ?? PROJECT_AGENT_SESSION;
  if (sessionId.kind === "outline") {
    const store = agentSessionStore(sessionId);
    if (agentConsoleOwnershipStatus(store.getState(), root) !== "ready") {
      throw new AgentConsoleOwnershipError();
    }
    store.getState().hydrate(root, emptyPersistedAgentState());
    return saveAgentSessionCollection(root).catch((error) => {
      store.getState().setPersistenceIssue({
        kind: "save",
        projectRoot: root,
        message: errorMessage(error),
      });
      throw error;
    });
  }
  const initialState = useAgentConsoleStore.getState();
  const ownsExactRoot =
    initialState.activeProjectRoot === root &&
    initialState.requestedProjectRoot === root;
  const issue = initialState.persistenceIssue;
  const ownsFailedLoad =
    initialState.persistenceTransition === null &&
    initialState.hydratedProjectRoot === null &&
    issue !== null &&
    issue.projectRoot === root &&
    (issue.kind === "load" || issue.kind === "corrupt");
  if (
    !ownsExactRoot ||
    (agentConsoleOwnershipStatus(initialState, root) !== "ready" &&
      !ownsFailedLoad)
  ) {
    throw new AgentConsoleOwnershipError();
  }
  const empty = emptyPersistedAgentState();
  clearSaveTimer();
  writableRoot = null;
  const capture = initialState.beginPersistenceTransition(root, "reset");
  return appendTransition(async () => {
    useAgentConsoleStore
      .getState()
      .activatePersistenceTransition(capture);
    try {
      await writeAppData(agentStateKey(root), empty);
    } catch (error) {
      useAgentConsoleStore.getState().finishPersistenceTransition(capture);
      throw error;
    }
    failedSaves.delete(root);
    const currentState = useAgentConsoleStore.getState();
    if (
      currentState.activeProjectRoot !== root ||
      currentState.requestedProjectRoot !== root
    ) {
      useAgentConsoleStore.getState().finishPersistenceTransition(capture);
      return;
    }
    const completion = useAgentConsoleStore
      .getState()
      .completePersistenceTransition(capture, empty);
    if (completion.status === "stale") return;
    const resetRevision = nextRevision();
    recoveryRoot = null;
    writableRoot = root;
    activeRevision = resetRevision;
    persistedRevision = resetRevision;
  });
}

export async function retryAgentSessionPersistence(
  root: string,
  sessionId: AgentSessionId,
): Promise<void> {
  if (sessionId.kind === "project") {
    await retryAgentPersistence();
    return;
  }
  const store = agentSessionStore(sessionId);
  await saveAgentSessionCollection(root);
  store.getState().setPersistenceIssue(null);
}

function captureAgentSnapshotSource(
  requestedSessionId?: AgentSessionId,
): AgentSnapshotSource {
  const sessionId = requestedSessionId ?? PROJECT_AGENT_SESSION;
  const state = agentSessionStore(sessionId).getState();
  return structuredClone({
    mode: state.mode,
    messages: state.messages,
    summary: state.summary,
    draftText: state.draftText,
    draftContextRefs: state.draftContextRefs,
    draftSourceLocators: state.draftSourceLocators,
    pendingProposal: state.pendingProposal,
    lastUsage: state.lastUsage,
    interruptedRun: state.interruptedRun,
  });
}

function toPersistedPendingProposal(
  proposal: PendingProposal | null,
): PersistedPendingProposal | null {
  if (proposal === null) return null;
  const base = {
    id: proposal.id,
    summary: proposal.summary,
    createdAt: proposal.createdAt,
    originatingMessageId: proposal.originatingMessageId,
    ...(proposal.overviewChange
      ? { overviewChange: proposal.overviewChange }
      : {}),
  };
  if (proposal.kind === "manuscript") {
    return {
      ...base,
      kind: proposal.kind,
      chapterId: proposal.chapterId,
      changes: proposal.changes,
    };
  }
  if (proposal.kind === "outline") {
    return {
      ...base,
      kind: proposal.kind,
      chapterId: proposal.chapterId,
      changes: proposal.changes,
    };
  }
  return {
    ...base,
    kind: proposal.kind,
    chapterId: null,
    changes: proposal.changes,
    overviewChange: proposal.overviewChange,
  };
}

function restorePendingProposal(
  root: string,
  proposal: PersistedPendingProposal | null,
): PendingProposal | null {
  if (proposal === null) return null;
  if (proposal.kind === "manuscript") {
    return { ...proposal, projectRoot: root };
  }
  if (proposal.kind === "outline") {
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
  const normalizedMessages = parsed.messages.map((message) => {
    const {
      error: _error,
      errorCode: _errorCode,
      failure,
      usage,
      ...metadata
    } = message.metadata;
    return {
      ...message,
      metadata: {
        ...metadata,
        failure:
          failure ??
          (metadata.state === "error" ? legacyAgentFailure() : null),
        usage: usage === null ? null : normalizedUsage(usage),
      },
    };
  });
  validatePersistedParts(normalizedMessages);
  const messages = await validateAgentMessages(normalizedMessages);
  const recoveredMessages = messages.map((message) =>
    message.role === "assistant" &&
    message.metadata?.state === "complete" &&
    !hasAssistantOutput(message)
      ? {
          ...message,
          metadata: {
            ...message.metadata,
            state: "error" as const,
            failure: legacyAgentFailure(),
            usage: null,
          },
        }
      : message,
  );
  const sanitizedMessages = sanitizeAgentMessages(recoveredMessages);
  const persistedToolParts = messages.flatMap((message) =>
    message.parts.filter(
      (part) => part.type === "dynamic-tool" || part.type.startsWith("tool-"),
    ),
  );
  const sanitizedToolParts = sanitizedMessages.flatMap((message) =>
    message.parts.filter(
      (part) => part.type === "dynamic-tool" || part.type.startsWith("tool-"),
    ),
  );
  if (!isEqual(sanitizedToolParts, persistedToolParts)) {
    throw new Error("Persisted agent messages must use safe settled projections.");
  }
  return {
    v: 3,
    mode: parsed.mode,
    messages: recoveredMessages,
    summary: parsed.summary,
    draftText: parsed.draftText,
    draftContextRefs: parsed.draftContextRefs,
    draftSourceLocators: parsed.draftSourceLocators,
    pendingProposal: parsed.pendingProposal,
    lastUsage:
      recoveredMessages.at(-1) !== messages.at(-1) || parsed.lastUsage === null
        ? null
        : normalizedUsage(parsed.lastUsage),
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

async function snapshotForSession(
  sessionId: AgentSessionId,
): Promise<PersistedAgentSnapshot> {
  return parseAgentSnapshot(
    await snapshotFromSource(captureAgentSnapshotSource(sessionId)),
  );
}

export async function loadAgentSessionCollection(
  root: string,
  migratedProject: PersistedAgentState,
): Promise<LoadedAgentSessionCollection> {
  const raw = await readAppData<unknown>(agentSessionCollectionKey(root));
  if (raw === null) {
    return {
      project: migratedProject,
      outlines: {},
      corruptOutlineChapterIds: [],
    };
  }
  const parsedCollection = persistedAgentSessionCollectionSchema.safeParse(raw);
  if (!parsedCollection.success) {
    return {
      project: migratedProject,
      outlines: {},
      corruptOutlineChapterIds: [],
    };
  }
  const collection = parsedCollection.data;
  let project = migratedProject;
  const projectRaw = collection.sessions.project;
  if (projectRaw !== undefined) {
    project = restoreAgentSnapshot(root, await parseAgentSnapshot(projectRaw));
  }
  const outlines: Record<string, PersistedAgentState> = {};
  const corruptOutlineChapterIds: string[] = [];
  for (const [key, snapshot] of Object.entries(collection.sessions)) {
    if (!key.startsWith("outline:")) continue;
    const chapterId = key.slice("outline:".length);
    if (chapterId.length === 0) continue;
    try {
      outlines[chapterId] = restoreAgentSnapshot(
        root,
        await parseAgentSnapshot(snapshot),
      );
    } catch {
      outlines[chapterId] = emptyPersistedAgentState();
      corruptOutlineChapterIds.push(chapterId);
    }
  }
  return {
    project,
    outlines,
    corruptOutlineChapterIds,
  };
}

async function saveAgentSessionCollectionNow(root: string): Promise<void> {
  const raw = await readAppData<unknown>(agentSessionCollectionKey(root));
  const persisted =
    raw === null ? null : persistedAgentSessionCollectionSchema.parse(raw);
  const sessions: Record<string, unknown> = {
    ...(persisted?.sessions ?? {}),
    project: await snapshotForSession(PROJECT_AGENT_SESSION),
  };
  const project = useProjectStore.getState().project;
  if (project?.root === root) {
    const liveChapterIds = new Set(project.chapters.map((chapter) => chapter.id));
    for (const key of Object.keys(sessions)) {
      if (
        key.startsWith("outline:") &&
        !liveChapterIds.has(key.slice("outline:".length))
      ) {
        delete sessions[key];
      }
    }
  }
  for (const [chapterId, store] of outlineAgentSessionEntries()) {
    if (agentConsoleOwnershipStatus(store.getState(), root) !== "ready") {
      continue;
    }
    sessions[`outline:${chapterId}`] = await snapshotForSession({
      kind: "outline",
      chapterId,
    });
  }
  await writeAppData(agentSessionCollectionKey(root), {
    v: 1,
    sessions,
  });
}

export function saveAgentSessionCollection(root: string): Promise<void> {
  const previous = sessionCollectionSaveQueues.get(root) ?? Promise.resolve();
  const save = previous
    .catch(() => undefined)
    .then(() => saveAgentSessionCollectionNow(root));
  const tracked = save.finally(() => {
    if (sessionCollectionSaveQueues.get(root) === tracked) {
      sessionCollectionSaveQueues.delete(root);
    }
  });
  sessionCollectionSaveQueues.set(root, tracked);
  return tracked;
}

async function hydrateAgentOutlineSessionOwned(
  root: string,
  chapterId: string,
): Promise<void> {
  const sessionId = { kind: "outline" as const, chapterId };
  const store = agentSessionStore(sessionId);
  if (agentConsoleOwnershipStatus(store.getState(), root) === "ready") return;
  const ownsHydration = (): boolean => {
    const state = store.getState();
    return (
      useProjectStore.getState().project?.root === root &&
      state.runStatus === "idle" &&
      state.activeRun === null &&
      outlineAgentSessionEntries().some(
        ([candidateChapterId, candidateStore]) =>
          candidateChapterId === chapterId && candidateStore === store,
      )
    );
  };
  let raw: unknown;
  try {
    raw = await readAppData<unknown>(agentSessionCollectionKey(root));
  } catch (error) {
    if (!ownsHydration()) return;
    store.getState().hydrate(root, emptyPersistedAgentState());
    store.getState().setPersistenceIssue({
      kind: "load",
      projectRoot: root,
      message: errorMessage(error),
    });
    return;
  }
  if (!ownsHydration()) return;
  const collection = persistedAgentSessionCollectionSchema.safeParse(raw);
  const snapshot = collection.success
    ? collection.data.sessions[`outline:${chapterId}`]
    : undefined;
  if (snapshot === undefined) {
    store.getState().hydrate(root, emptyPersistedAgentState());
    return;
  }
  try {
    const restored = restoreAgentSnapshot(
      root,
      await parseAgentSnapshot(snapshot),
    );
    if (!ownsHydration()) return;
    store.getState().hydrate(root, restored);
  } catch (error) {
    if (!ownsHydration()) return;
    store.getState().hydrate(root, emptyPersistedAgentState());
    store.getState().setPersistenceIssue({
      kind: "corrupt",
      projectRoot: root,
      message: errorMessage(error),
    });
  }
}

export function hydrateAgentOutlineSession(
  root: string,
  chapterId: string,
): Promise<void> {
  const key = JSON.stringify([root, chapterId]);
  const current = outlineHydrations.get(key);
  if (current !== undefined) return current;
  const hydration = hydrateAgentOutlineSessionOwned(root, chapterId).finally(
    () => {
      if (outlineHydrations.get(key) === hydration) {
        outlineHydrations.delete(key);
      }
    },
  );
  outlineHydrations.set(key, hydration);
  return hydration;
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

export function saveAgentState(
  root: string,
  snapshot: PersistedAgentSnapshot,
): Promise<void> {
  const frozenSnapshot = structuredClone(snapshot);
  const revision = nextRevision();
  const initialState = useAgentConsoleStore.getState();
  const resetsActiveRecovery =
    recoveryRoot === root &&
    agentConsoleOwnershipStatus(initialState, root) === "ready";
  const recoveryFailure = resetsActiveRecovery
    ? failedSaveForRoot(root)
    : null;
  if (resetsActiveRecovery && recoveryFailure === null) {
    throw new Error(`Agent recovery state is missing for ${root}.`);
  }
  const recoveryFailureRevision =
    recoveryFailure === null ? null : failedSaveRevision(recoveryFailure);
  const recoveryCapture = resetsActiveRecovery
    ? useAgentConsoleStore
        .getState()
        .beginPersistenceTransition(root, "recovery")
    : null;
  if (recoveryCapture !== null) {
    clearSaveTimer();
    writableRoot = null;
  }
  return appendTransition(async () => {
    const ownsBookkeeping = (): boolean =>
      recoveryCapture === null || ownsPersistenceCapture(recoveryCapture);
    let safeSnapshot: PersistedAgentSnapshot;
    try {
      safeSnapshot = await parseAgentSnapshot(frozenSnapshot);
    } catch (error) {
      const recordsFailure = ownsBookkeeping();
      if (recoveryCapture !== null) {
        useAgentConsoleStore
          .getState()
          .finishPersistenceTransition(recoveryCapture);
      }
      throw recordsFailure
        ? saveIssue(root, error)
        : persistenceError("save", root, error);
    }
    try {
      await writeAgentSnapshot(
        root,
        safeSnapshot,
        revision,
        ownsBookkeeping,
      );
    } catch (error) {
      if (recoveryCapture !== null) {
        useAgentConsoleStore
          .getState()
          .finishPersistenceTransition(recoveryCapture);
      }
      throw error;
    }
    if (recoveryCapture !== null) {
      if (!ownsPersistenceCapture(recoveryCapture)) {
        const currentFailure = failedSaveForRoot(root);
        if (
          recoveryFailure !== null &&
          recoveryFailureRevision !== null &&
          currentFailure === recoveryFailure &&
          failedSaveRevision(currentFailure) === recoveryFailureRevision
        ) {
          failedSaves.delete(root);
        }
        return;
      }
      if (
        !useAgentConsoleStore
          .getState()
          .activatePersistenceTransition(recoveryCapture)
      ) {
        return;
      }
      if (
        !ownsPersistenceCapture(recoveryCapture) ||
        useAgentConsoleStore.getState().activeProjectRoot !== root ||
        useAgentConsoleStore.getState().requestedProjectRoot !== root ||
        failedSaveForRoot(root) !== null
      ) {
        useAgentConsoleStore
          .getState()
          .finishPersistenceTransition(recoveryCapture);
        return;
      }
      const completion = useAgentConsoleStore
        .getState()
        .completePersistenceTransition(
          recoveryCapture,
          restoreAgentSnapshot(root, safeSnapshot),
        );
      if (completion.status === "stale") return;
      recoveryRoot = null;
      writableRoot = root;
      activeRevision = revision;
      persistedRevision = revision;
      restoreFailedSaveIssue();
      return;
    }
    const currentState = useAgentConsoleStore.getState();
    if (
      agentConsoleOwnershipStatus(currentState, root) === "ready" &&
      failedSaveForRoot(root) === null
    ) {
      recoveryRoot = null;
      writableRoot = root;
    }
  });
}

function markRevisionPersisted(root: string, revision: number): void {
  if (
    root !== useAgentConsoleStore.getState().activeProjectRoot ||
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
  ownsBookkeeping: () => boolean,
): Promise<void> {
  try {
    await writeAppData(agentStateKey(root), snapshot);
    if (ownsBookkeeping()) {
      clearRecoveredFailure(root, revision);
      markRevisionPersisted(root, revision);
    }
  } catch (error) {
    const failure = ownsBookkeeping()
      ? saveIssue(root, error)
      : persistenceError("save", root, error);
    if (ownsBookkeeping()) {
      recordFailedSave({
        kind: "write",
        root,
        snapshot: structuredClone(snapshot),
        issue: failure.issue,
        revision,
        recovery: null,
      });
    }
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
  ownsBookkeeping: () => boolean,
): Promise<void> {
  let snapshot: PersistedAgentSnapshot;
  try {
    snapshot = await snapshotFromSource(source);
    snapshot = await parseAgentSnapshot(snapshot);
  } catch (error) {
    throw ownsBookkeeping()
      ? recordSnapshotFailure(root, source, revision, error)
      : persistenceError("save", root, error);
  }
  await writeAgentSnapshot(
    root,
    snapshot,
    revision,
    ownsBookkeeping,
  );
}

function captureActiveSnapshot(root: string): Promise<void> {
  const source = captureAgentSnapshotSource();
  const revision = nextRevision();
  if (useAgentConsoleStore.getState().activeProjectRoot === root) {
    activeRevision = revision;
  }
  return appendTransition(async () => {
    try {
      await persistSnapshotSource(root, source, revision, () => true);
    } catch (error) {
      logPersistenceFailure(root, error);
    }
  });
}

function flushActiveSnapshot(): void {
  clearSaveTimer();
  const state = useAgentConsoleStore.getState();
  const root = state.activeProjectRoot;
  if (
    root === null ||
    writableRoot !== root ||
    agentConsoleOwnershipStatus(state, root) !== "ready"
  ) {
    return;
  }
  void captureActiveSnapshot(root);
}

function scheduleAgentSave(): void {
  clearSaveTimer();
  const state = useAgentConsoleStore.getState();
  const root = state.activeProjectRoot;
  if (
    root === null ||
    writableRoot !== root ||
    agentConsoleOwnershipStatus(state, root) !== "ready"
  ) {
    return;
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const currentState = useAgentConsoleStore.getState();
    if (
      writableRoot !== root ||
      agentConsoleOwnershipStatus(currentState, root) !== "ready"
    ) {
      return;
    }
    void captureActiveSnapshot(root);
  }, SAVE_DEBOUNCE_MS);
}

export function transitionAgentProject(nextRoot: string | null): Promise<void> {
  useViewStore.getState().closeManuscriptReview();
  clearSaveTimer();
  clearSessionCollectionSaveTimer();
  const consoleBeforeSwitch = useAgentConsoleStore.getState();
  const oldRoot = consoleBeforeSwitch.activeProjectRoot;
  const ownsOldConsole =
    oldRoot !== null &&
    agentConsoleOwnershipStatus(consoleBeforeSwitch, oldRoot) === "ready";
  const oldRootWasWritable =
    ownsOldConsole && writableRoot === oldRoot;
  const resetOwnsOldRoot =
    oldRoot !== null &&
    consoleBeforeSwitch.persistenceTransition?.kind === "reset" &&
    consoleBeforeSwitch.persistenceTransition.projectRoot === oldRoot;
  const oldRootWasRecovering =
    ownsOldConsole && recoveryRoot === oldRoot && !resetOwnsOldRoot;
  const oldRootHasOutlineSessions =
    oldRoot !== null &&
    outlineAgentSessionEntries().some(([, store]) =>
      agentConsoleOwnershipStatus(store.getState(), oldRoot) === "ready",
    );
  writableRoot = null;
  const rootsWithActiveSessions = new Set<string>();
  if (oldRoot !== null) rootsWithActiveSessions.add(oldRoot);
  for (const [, store] of outlineAgentSessionEntries()) {
    const activeProjectRoot = store.getState().activeProjectRoot;
    if (activeProjectRoot !== null) {
      rootsWithActiveSessions.add(activeProjectRoot);
    }
  }
  for (const root of rootsWithActiveSessions) {
    abortAgentRunForProjectSwitch(root, "project-switch");
  }
  const oldSource =
    oldRootWasWritable || oldRootWasRecovering
      ? captureAgentSnapshotSource()
      : null;
  const oldRevision = oldSource === null ? null : nextRevision();
  if (oldRevision !== null) activeRevision = oldRevision;
  const ownsTargetConsole =
    nextRoot !== null &&
    agentConsoleOwnershipStatus(consoleBeforeSwitch, nextRoot) === "ready";
  const persistenceCapture = consoleBeforeSwitch.beginPersistenceTransition(
    nextRoot,
    "load",
  );

  return appendTransition(async () => {
    if (
      oldRoot !== null &&
      oldRootWasWritable &&
      oldSource !== null &&
      oldRevision !== null
    ) {
      try {
        await persistSnapshotSource(
          oldRoot,
          oldSource,
          oldRevision,
          () => true,
        );
      } catch (error) {
        logPersistenceFailure(oldRoot, error);
      }
    }

    if (
      oldRoot !== null &&
      oldRootWasRecovering &&
      oldSource !== null &&
      oldRevision !== null
    ) {
      recordRecoveryState(oldRoot, oldSource, oldRevision);
    }

    if (oldRoot !== null && oldRootHasOutlineSessions) {
      try {
        await saveAgentSessionCollection(oldRoot);
      } catch (error) {
        logPersistenceFailure(oldRoot, error);
      }
    }

    if (!ownsPersistenceCapture(persistenceCapture)) {
      return;
    }
    if (!ownsTargetConsole) {
      useAgentConsoleStore.getState().resetProject();
      clearOutlineAgentSessions();
    }
    if (
      !useAgentConsoleStore
        .getState()
        .activatePersistenceTransition(persistenceCapture)
    ) {
      return;
    }
    recoveryRoot = null;
    activeRevision = 0;
    persistedRevision = 0;
    if (nextRoot === null) {
      useAgentConsoleStore
        .getState()
        .finishPersistenceTransition(persistenceCapture);
      restoreFailedSaveIssue();
      return;
    }

    const retainedFailure = failedSaveForRoot(nextRoot);
    if (retainedFailure !== null) {
      const retainedState = stateFromFailedSave(nextRoot, retainedFailure);
      const completion = useAgentConsoleStore
        .getState()
        .completePersistenceTransition(persistenceCapture, retainedState);
      if (completion.status === "stale") return;
      recoveryRoot = nextRoot;
      activeRevision = failedSaveRevision(retainedFailure);
      persistedRevision = 0;
      useAgentConsoleStore
        .getState()
        .setPersistenceIssue(retainedFailure.issue);
      return;
    }

    const capture = persistenceCapture;
    let loaded: PersistedAgentState;
    try {
      loaded = await loadAgentState(nextRoot);
    } catch (error) {
      if (
        useAgentConsoleStore.getState().requestedProjectRoot === nextRoot &&
        ownsPersistenceCapture(capture)
      ) {
        const failure =
          error instanceof AgentPersistenceError
            ? error
            : persistenceError("load", nextRoot, error);
        useAgentConsoleStore.getState().setPersistenceIssue(failure.issue);
      }
      useAgentConsoleStore.getState().finishPersistenceTransition(capture);
      return;
    }
    if (
      useAgentConsoleStore.getState().requestedProjectRoot !== nextRoot ||
      !ownsPersistenceCapture(capture)
    ) {
      useAgentConsoleStore.getState().finishPersistenceTransition(capture);
      return;
    }

    const completion = useAgentConsoleStore
      .getState()
      .completePersistenceTransition(capture, loaded);
    if (completion.status === "stale") return;
    const hydratedRevision = nextRevision();
    activeRevision = hydratedRevision;
    persistedRevision = hydratedRevision;
    writableRoot = nextRoot;
    restoreFailedSaveIssue();
  });
}

export function retryAgentPersistence(): Promise<void> {
  return appendTransition(async () => {
    const retry = failedSaveForRetry();
    if (retry !== null) {
      const state = useAgentConsoleStore.getState();
      const recoveringActiveRoot =
        recoveryRoot === retry.root &&
        agentConsoleOwnershipStatus(state, retry.root) === "ready";
      if (retry.kind === "write") {
        await writeAgentSnapshot(
          retry.root,
          retry.snapshot,
          retry.revision,
          () => true,
        );
      } else {
        await persistSnapshotSource(
          retry.root,
          retry.source,
          retry.revision,
          () => true,
        );
      }
      if (retry.recovery !== null) {
        await persistSnapshotSource(
          retry.root,
          retry.recovery.source,
          retry.recovery.revision,
          () => true,
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
    const state = useAgentConsoleStore.getState();
    const root = state.activeProjectRoot;
    if (
      root === null ||
      writableRoot !== root ||
      agentConsoleOwnershipStatus(state, root) !== "ready"
    ) {
      return;
    }
    const revision = nextRevision();
    activeRevision = revision;
    await persistSnapshotSource(
      root,
      captureAgentSnapshotSource(),
      revision,
      () => true,
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
          state.activeProjectRoot !== null &&
          agentConsoleOwnershipStatus(
            state,
            state.activeProjectRoot,
          ) === "ready"
        ) {
          activeRevision = nextRevision();
        }
        scheduleAgentSave();
        if (outlineAgentSessionEntries().length > 0) {
          scheduleAgentSessionCollectionSave();
        }
      },
    );
    const outlineUnsubscribes = new Map<string, () => void>();
    const subscribeOutlineSessions = (): void => {
      const liveChapterIds = new Set(
        outlineAgentSessionEntries().map(([chapterId]) => chapterId),
      );
      for (const [chapterId, unsubscribe] of outlineUnsubscribes) {
        if (liveChapterIds.has(chapterId)) continue;
        unsubscribe();
        outlineUnsubscribes.delete(chapterId);
      }
      for (const [chapterId, store] of outlineAgentSessionEntries()) {
        if (outlineUnsubscribes.has(chapterId)) continue;
        outlineUnsubscribes.set(
          chapterId,
          store.subscribe((state, previous) => {
            if (!persistedFieldsChanged(state, previous)) return;
            scheduleAgentSessionCollectionSave(chapterId);
          }),
        );
      }
    };
    subscribeOutlineSessions();
    const unsubscribeRegistry = subscribeAgentSessionRegistry(() => {
      subscribeOutlineSessions();
      scheduleAgentSessionCollectionSave();
    });
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") flushActiveSnapshot();
    };
    const onPageHide = (): void => {
      clearSaveTimer();
      const state = useAgentConsoleStore.getState();
      const root =
        useProjectStore.getState().project?.root ?? state.activeProjectRoot;
      if (root === null) return;
      abortAgentRunForProjectSwitch(root, "app-exit");
      if (
        agentConsoleOwnershipStatus(state, root) !== "ready"
      ) {
        return;
      }
      clearSaveTimer();
      if (writableRoot !== root) return;
      void captureActiveSnapshot(root);
      if (outlineAgentSessionEntries().length > 0) {
        void saveAgentSessionCollection(root).catch((error) => {
          logPersistenceFailure(root, error);
        });
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearSaveTimer();
      clearSessionCollectionSaveTimer();
      unsubscribeProject();
      unsubscribeConsole();
      unsubscribeRegistry();
      outlineUnsubscribes.forEach((unsubscribe) => unsubscribe());
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);
}
