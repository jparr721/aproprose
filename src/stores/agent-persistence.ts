import { reportNotification } from "@/lib/notifications";
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
  AgentProposalRecord,
  AgentPersistenceIssue,
  PendingProposal,
  PersistedAgentSnapshot,
  PersistedAgentProposalRecord,
  PersistedAgentState,
  PersistedPendingProposal,
  PersistedUsage,
} from "@/lib/ai/agent-types";
import {
  agentSessionKey,
  PROJECT_AGENT_SESSION,
} from "@/lib/ai/agent-types";
import { pathHash } from "@/lib/path-hash";
import { legacyAgentFailure } from "@/lib/ai/agent-failure";
import { readAppData, writeAppData } from "@/lib/tauri";
import {
  type AgentConsoleStore,
  type AgentPersistenceTransitionCapture,
  AgentConsoleOwnershipError,
  agentSessionStore,
  agentConsoleOwnershipStatus,
  characterAgentSessionEntries,
  clearCharacterAgentSessions,
  clearOutlineAgentSessions,
  outlineAgentSessionEntries,
  proposalChangeIds,
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
      anchorBlockId: z.string().nullable(),
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
      kind: z.literal("character-describe"),
      characterId: z.string().min(1),
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
    const changeIds = proposalChangeIds(proposal);
    if (new Set(changeIds).size !== changeIds.length) {
      context.addIssue({ code: "custom", message: "Proposal change IDs must be unique." });
    }
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

const proposalRecordSchema = z.object({
  proposal: pendingProposalSchema,
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("legacy") }).strict(),
    z.object({
      kind: z.literal("run"),
      runId: z.string().min(1),
      task: agentTaskSchema,
      text: z.string(),
    }).strict(),
  ]),
  decisions: z.record(z.string(), z.object({
    status: z.enum(["applied", "dismissed"]),
    decidedAt: z.string(),
  }).strict()),
  replacedByProposalId: z.string().nullable(),
}).strict().superRefine((record, context) => {
  const ids = proposalChangeIds(record.proposal);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Proposal change IDs must be unique." });
  }
  for (const id of Object.keys(record.decisions)) {
    if (!ids.includes(id)) {
      context.addIssue({ code: "custom", message: `Decision refers to unknown proposal change: ${id}` });
    }
  }
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
  "tool-update_character_profile",
]);

const messageEnvelopeSchema = z
  .object({
    id: z.string(),
    role: z.enum(["user", "assistant"]),
    metadata: messageMetadataSchema,
    parts: z.array(z.unknown()),
  })
  .strict();

const legacyPersistedAgentStateSchema = z
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

const persistedAgentStateSchema = legacyPersistedAgentStateSchema
  .omit({ pendingProposal: true })
  .extend({
    v: z.literal(4),
    proposalRecords: z.array(proposalRecordSchema),
    currentProposalId: z.string().nullable(),
  })
  .strict()
  .superRefine((state, context) => {
    const ids = state.proposalRecords.map((record) => record.proposal.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "Retained proposal IDs must be unique." });
    }
    if (state.currentProposalId !== null && !ids.includes(state.currentProposalId)) {
      context.addIssue({ code: "custom", message: "Current proposal ID has no retained record." });
    }
    for (const record of state.proposalRecords) {
      if (
        record.replacedByProposalId !== null &&
        (record.replacedByProposalId === record.proposal.id || !ids.includes(record.replacedByProposalId))
      ) {
        context.addIssue({ code: "custom", message: "Proposal replacement has no distinct retained record." });
      }
    }
  });

const persistedAgentSessionCollectionSchema = z
  .object({
    v: z.literal(1),
    sessions: z.record(z.string(), z.unknown()),
  })
  .strict();

interface LoadedAgentSessionCollection {
  project: PersistedAgentState;
  outlines: Record<string, PersistedAgentState>;
  characters: Record<string, PersistedAgentState>;
  corruptOutlineChapterIds: string[];
  corruptCharacterIds: string[];
}

type AgentSnapshotSource = Pick<
  ReturnType<typeof useAgentConsoleStore.getState>,
  | "mode"
  | "messages"
  | "summary"
  | "draftText"
  | "draftContextRefs"
  | "draftSourceLocators"
  | "proposalRecords"
  | "currentProposalId"
  | "lastUsage"
  | "interruptedRun"
>;

type ScopedAgentSessionId = Exclude<AgentSessionId, { kind: "project" }>;

interface ScopedSessionSource {
  sessionId: ScopedAgentSessionId;
  source: AgentSnapshotSource;
}

interface FailedScopedSave {
  sources: Record<string, ScopedSessionSource>;
  issue: AgentPersistenceIssue;
}

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
const failedScopedSaves = new Map<string, FailedScopedSave>();
let transition: Promise<void> = Promise.resolve();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let sessionCollectionSaveTimer: ReturnType<typeof setTimeout> | null = null;
const outlineHydrations = new Map<string, Promise<void>>();
const characterHydrations = new Map<string, Promise<void>>();
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
  reportNotification({ type: `conversation-${kind}`, source: "Conversation", projectRoot: root, provider: null });
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
  requestedStore?: AgentConsoleStore,
): void {
  clearSessionCollectionSaveTimer();
  const root = useAgentConsoleStore.getState().activeProjectRoot;
  if (root === null || writableRoot !== root) return;
  sessionCollectionSaveTimer = setTimeout(() => {
    sessionCollectionSaveTimer = null;
    if (writableRoot !== root) return;
    void saveAgentSessionCollection(root).then(
      () => {
        if (requestedStore === undefined) return;
        if (requestedStore.getState().persistenceIssue?.kind === "save") {
          requestedStore.getState().setPersistenceIssue(null);
        }
      },
      (error) => {
        if (requestedStore !== undefined) {
          requestedStore.getState().setPersistenceIssue({
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
    state.proposalRecords !== previous.proposalRecords ||
    state.currentProposalId !== previous.currentProposalId ||
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
    v: 4,
    mode: "writing",
    messages: [],
    summary: null,
    draftText: "",
    draftContextRefs: [],
    draftSourceLocators: {},
    proposalRecords: [],
    currentProposalId: null,
    lastUsage: null,
    interruptedRun: null,
  };
}

export function resetAgentConversation(
  root: string,
  requestedSessionId?: AgentSessionId,
): Promise<void> {
  const sessionId = requestedSessionId ?? PROJECT_AGENT_SESSION;
  if (sessionId.kind !== "project") {
    const store = agentSessionStore(sessionId);
    const state = store.getState();
    const ready = agentConsoleOwnershipStatus(state, root) === "ready";
    const failedLoad = state.persistenceTransition === null &&
      state.activeProjectRoot === root && state.requestedProjectRoot === root &&
      state.hydratedProjectRoot === null && state.persistenceIssue !== null &&
      state.persistenceIssue.projectRoot === root &&
      (state.persistenceIssue.kind === "load" || state.persistenceIssue.kind === "corrupt");
    if (useProjectStore.getState().project?.root !== root || (!ready && !failedLoad) || state.persistenceIssue?.scope === "collection") {
      throw new AgentConsoleOwnershipError();
    }
    const resetState: PersistedAgentState = {
      ...emptyPersistedAgentState(),
      proposalRecords: ready ? state.proposalRecords : [],
    };
    const capture = state.beginPersistenceTransition(root, "reset");
    state.activatePersistenceTransition(capture);
    return queueSessionCollectionWrite(root, async () => {
      try {
        const raw = await readAppData<unknown>(agentSessionCollectionKey(root));
        const collection = raw === null
          ? { v: 1 as const, sessions: {} }
          : persistedAgentSessionCollectionSchema.parse(raw);
        const snapshot = await snapshotFromSource(resetState);
        const sessions: Record<string, unknown> = { ...collection.sessions };
        delete sessions.project;
        sessions[agentSessionKey(sessionId)] = snapshot;
        await writeAppData(agentSessionCollectionKey(root), { v: 1, sessions });
        const recovery = failedScopedSaves.get(root);
        if (recovery !== undefined) {
          const remaining = Object.fromEntries(Object.entries(recovery.sources).filter(([key]) => key !== agentSessionKey(sessionId)));
          if (Object.keys(remaining).length === 0) failedScopedSaves.delete(root);
          else failedScopedSaves.set(root, { ...recovery, sources: remaining });
        }
      } catch (error) {
        if (store.getState().persistenceTransition?.generation === capture.generation) {
          store.getState().finishPersistenceTransition(capture);
          store.getState().setPersistenceIssue({
            kind: "save",
            projectRoot: root,
            message: errorMessage(error),
          });
        }
        throw error;
      }
      if (useProjectStore.getState().project?.root !== root || !scopedAgentSessionIsRegistered(sessionId, store)) return;
      store.getState().completePersistenceTransition(capture, resetState);
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
    initialState.persistenceIssue?.scope === "collection" ||
    (agentConsoleOwnershipStatus(initialState, root) !== "ready" &&
      !ownsFailedLoad)
  ) {
    throw new AgentConsoleOwnershipError();
  }
  const empty: PersistedAgentState = {
    ...emptyPersistedAgentState(),
    proposalRecords: ownsFailedLoad ? [] : initialState.proposalRecords,
  };
  clearSaveTimer();
  writableRoot = null;
  const capture = initialState.beginPersistenceTransition(root, "reset");
  return appendTransition(async () => {
    useAgentConsoleStore
      .getState()
      .activatePersistenceTransition(capture);
    try {
      await writeAppData(agentStateKey(root), await snapshotFromSource(empty));
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

export function canResetAgentSessionPersistence(issue: AgentPersistenceIssue): boolean {
  return issue.kind !== "save" && issue.scope !== "collection";
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
  if (agentConsoleOwnershipStatus(store.getState(), root) !== "ready") {
    await hydrateAgentScopedSessionOwned(root, sessionId);
    if (agentConsoleOwnershipStatus(store.getState(), root) !== "ready") {
      const issue = store.getState().persistenceIssue;
      throw issue === null ? new AgentConsoleOwnershipError() : new AgentPersistenceError(issue);
    }
    return;
  }
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
    proposalRecords: state.proposalRecords,
    currentProposalId: state.currentProposalId,
    lastUsage: state.lastUsage,
    interruptedRun: state.interruptedRun,
  });
}

function toPersistedPendingProposal(
  proposal: PendingProposal,
): PersistedPendingProposal {
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
  proposal: PersistedPendingProposal,
): PendingProposal {
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
    v: 4,
    mode: source.mode,
    messages: sanitizeAgentMessages(source.messages),
    summary: source.summary,
    draftText: source.draftText,
    draftContextRefs: source.draftContextRefs,
    draftSourceLocators: source.draftSourceLocators,
    proposalRecords: source.proposalRecords.map((record): PersistedAgentProposalRecord => ({
      ...record,
      proposal: toPersistedPendingProposal(record.proposal),
    })),
    currentProposalId: source.currentProposalId,
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
  const parsed = z.union([persistedAgentStateSchema, legacyPersistedAgentStateSchema]).parse(raw);
  const proposalRecords: PersistedAgentProposalRecord[] = parsed.v === 4
    ? parsed.proposalRecords
    : parsed.pendingProposal === null
      ? []
      : [{
          proposal: parsed.pendingProposal,
          source: { kind: "legacy" },
          decisions: {},
          replacedByProposalId: null,
        }];
  const currentProposalId = parsed.v === 4
    ? parsed.currentProposalId
    : parsed.pendingProposal === null ? null : parsed.pendingProposal.id;
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
    v: 4,
    mode: parsed.mode,
    messages: recoveredMessages,
    summary: parsed.summary,
    draftText: parsed.draftText,
    draftContextRefs: parsed.draftContextRefs,
    draftSourceLocators: parsed.draftSourceLocators,
    proposalRecords,
    currentProposalId,
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
    proposalRecords: snapshot.proposalRecords.map((record): AgentProposalRecord => ({
      ...record,
      proposal: restorePendingProposal(root, record.proposal),
    })),
  };
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
      characters: {},
      corruptOutlineChapterIds: [],
      corruptCharacterIds: [],
    };
  }
  const parsedCollection = persistedAgentSessionCollectionSchema.safeParse(raw);
  if (!parsedCollection.success) {
    throw new AgentPersistenceError({
      ...persistenceError("corrupt", root, parsedCollection.error).issue,
      scope: "collection",
    });
  }
  const collection = parsedCollection.data;
  const outlines: Record<string, PersistedAgentState> = {};
  const characters: Record<string, PersistedAgentState> = {};
  const corruptOutlineChapterIds: string[] = [];
  const corruptCharacterIds: string[] = [];
  for (const [key, snapshot] of Object.entries(collection.sessions)) {
    if (key.startsWith("outline:")) {
      const chapterId = key.slice("outline:".length);
      if (chapterId.length === 0) continue;
      try {
        outlines[chapterId] = restoreAgentSnapshot(
          root,
          await parseAgentSnapshot(snapshot),
        );
      } catch {
        reportNotification({ type: "conversation-corrupt", source: "Outline conversation", projectRoot: root, provider: null });
        corruptOutlineChapterIds.push(chapterId);
      }
      continue;
    }
    if (key.startsWith("character:")) {
      const characterId = key.slice("character:".length);
      if (characterId.length === 0) continue;
      try {
        characters[characterId] = restoreAgentSnapshot(
          root,
          await parseAgentSnapshot(snapshot),
        );
      } catch {
        reportNotification({ type: "conversation-corrupt", source: "Character conversation", projectRoot: root, provider: null });
        corruptCharacterIds.push(characterId);
      }
    }
  }
  return {
    project: migratedProject,
    outlines,
    characters,
    corruptOutlineChapterIds,
    corruptCharacterIds,
  };
}

function storedSessionHasProposals(snapshot: unknown): boolean {
  const parsed = z.union([persistedAgentStateSchema, legacyPersistedAgentStateSchema]).safeParse(snapshot);
  if (!parsed.success) return true;
  return parsed.data.v === 4
    ? parsed.data.proposalRecords.length > 0
    : parsed.data.pendingProposal !== null;
}

function captureScopedSessionSources(root: string): Record<string, ScopedSessionSource> {
  const sources: Record<string, ScopedSessionSource> = {};
  for (const [chapterId, store] of outlineAgentSessionEntries()) {
    if (agentConsoleOwnershipStatus(store.getState(), root) !== "ready") continue;
    const sessionId: ScopedAgentSessionId = { kind: "outline", chapterId };
    sources[agentSessionKey(sessionId)] = { sessionId, source: captureAgentSnapshotSource(sessionId) };
  }
  for (const [characterId, store] of characterAgentSessionEntries()) {
    if (agentConsoleOwnershipStatus(store.getState(), root) !== "ready") continue;
    const sessionId: ScopedAgentSessionId = { kind: "character", characterId };
    sources[agentSessionKey(sessionId)] = { sessionId, source: captureAgentSnapshotSource(sessionId) };
  }
  return sources;
}

async function saveAgentSessionCollectionNow(root: string, sources: Record<string, ScopedSessionSource>): Promise<void> {
  const raw = await readAppData<unknown>(agentSessionCollectionKey(root));
  const persisted =
    raw === null ? null : persistedAgentSessionCollectionSchema.parse(raw);
  const sessions: Record<string, unknown> = {
    ...(persisted?.sessions ?? {}),
  };
  delete sessions.project;
  const projectState = useProjectStore.getState();
  const project = projectState.project;
  const liveChapterIds =
    project?.root === root
      ? new Set(project.chapters.map((chapter) => chapter.id))
      : null;
  const liveCharacterIds =
    project?.root === root
      ? new Set(projectState.meta.characters.map((character) => character.id))
      : null;
  if (project?.root === root) {
    for (const key of Object.keys(sessions)) {
      if (
        key.startsWith("outline:") &&
        liveChapterIds !== null &&
        !liveChapterIds.has(key.slice("outline:".length)) &&
        !storedSessionHasProposals(sessions[key])
      ) {
        delete sessions[key];
      }
      if (
        key.startsWith("character:") &&
        liveCharacterIds !== null &&
        !liveCharacterIds.has(key.slice("character:".length)) &&
        !storedSessionHasProposals(sessions[key])
      ) {
        delete sessions[key];
      }
    }
  }
  for (const [key, { sessionId, source }] of Object.entries(sources)) {
    if (
      sessionId.kind === "character" &&
      liveCharacterIds !== null &&
      !liveCharacterIds.has(sessionId.characterId)
    ) continue;
    sessions[key] = await parseAgentSnapshot(await snapshotFromSource(source));
  }
  await writeAppData(agentSessionCollectionKey(root), { v: 1, sessions });
}

function queueSessionCollectionWrite(root: string, operation: () => Promise<void>): Promise<void> {
  const previous = sessionCollectionSaveQueues.get(root) ?? Promise.resolve();
  const save = previous
    .catch(() => undefined)
    .then(operation)
    .catch((error: unknown) => {
      throw error instanceof AgentPersistenceError && error.issue.kind === "save"
        ? error
        : persistenceError("save", root, error);
    });
  const tracked = save.finally(() => {
    if (sessionCollectionSaveQueues.get(root) === tracked) {
      sessionCollectionSaveQueues.delete(root);
    }
  });
  sessionCollectionSaveQueues.set(root, tracked);
  return tracked;
}

export function saveAgentSessionCollection(root: string): Promise<void> {
  const sources = {
    ...failedScopedSaves.get(root)?.sources,
    ...captureScopedSessionSources(root),
  };
  return queueSessionCollectionWrite(root, async () => {
    try {
      await saveAgentSessionCollectionNow(root, sources);
    } catch (error) {
      const failure = error instanceof AgentPersistenceError && error.issue.kind === "save"
        ? error
        : persistenceError("save", root, error);
      if (Object.keys(sources).length > 0) {
        failedScopedSaves.set(root, {
          sources: { ...failedScopedSaves.get(root)?.sources, ...sources },
          issue: failure.issue,
        });
      }
      throw failure;
    }
    failedScopedSaves.delete(root);
    for (const { sessionId } of Object.values(sources)) {
      const entry = sessionId.kind === "outline"
        ? outlineAgentSessionEntries().find(([chapterId]) => chapterId === sessionId.chapterId)
        : characterAgentSessionEntries().find(([characterId]) => characterId === sessionId.characterId);
      if (entry === undefined) continue;
      const store = entry[1];
      if (agentConsoleOwnershipStatus(store.getState(), root) === "ready" && store.getState().persistenceIssue?.kind === "save") {
        store.getState().setPersistenceIssue(null);
      }
    }
  });
}

function scopedAgentSessionIsRegistered(
  sessionId: ScopedAgentSessionId,
  store: ReturnType<typeof agentSessionStore>,
): boolean {
  switch (sessionId.kind) {
    case "outline":
      return outlineAgentSessionEntries().some(
        ([chapterId, candidateStore]) =>
          chapterId === sessionId.chapterId && candidateStore === store,
      );
    case "character":
      return characterAgentSessionEntries().some(
        ([characterId, candidateStore]) =>
          characterId === sessionId.characterId && candidateStore === store,
      );
  }
}

function failScopedHydration(
  store: AgentConsoleStore,
  capture: AgentPersistenceTransitionCapture,
  issue: AgentPersistenceIssue,
): void {
  const state = store.getState();
  if (state.persistenceTransition?.generation !== capture.generation) return;
  state.finishPersistenceTransition(capture);
  store.getState().setPersistenceIssue(issue);
}

async function hydrateAgentScopedSessionOwned(
  root: string,
  sessionId: ScopedAgentSessionId,
): Promise<void> {
  const store = agentSessionStore(sessionId);
  if (agentConsoleOwnershipStatus(store.getState(), root) === "ready") return;
  const capture = store.getState().beginPersistenceTransition(root, "load");
  store.getState().activatePersistenceTransition(capture);
  const ownsHydration = (): boolean => {
    const state = store.getState();
    return (
      useProjectStore.getState().project?.root === root &&
      state.persistenceTransition?.generation === capture.generation &&
      state.runStatus === "idle" &&
      state.activeRun === null &&
      scopedAgentSessionIsRegistered(sessionId, store)
    );
  };
  let raw: unknown;
  try {
    raw = await readAppData<unknown>(agentSessionCollectionKey(root));
  } catch (error) {
    if (ownsHydration()) failScopedHydration(store, capture, {
      ...persistenceError("load", root, error).issue,
      scope: "collection",
    });
    return;
  }
  if (!ownsHydration()) return;
  if (raw === null) {
    store.getState().completePersistenceTransition(capture, emptyPersistedAgentState());
    return;
  }
  const collection = persistedAgentSessionCollectionSchema.safeParse(raw);
  if (!collection.success) {
    failScopedHydration(store, capture, {
      ...persistenceError("corrupt", root, collection.error).issue,
      scope: "collection",
    });
    return;
  }
  const snapshot = collection.data.sessions[agentSessionKey(sessionId)];
  if (snapshot === undefined) {
    store.getState().completePersistenceTransition(capture, emptyPersistedAgentState());
    return;
  }
  try {
    const restored = restoreAgentSnapshot(root, await parseAgentSnapshot(snapshot));
    if (!ownsHydration()) return;
    store.getState().completePersistenceTransition(capture, restored);
  } catch (error) {
    if (ownsHydration()) failScopedHydration(store, capture, persistenceError("corrupt", root, error).issue);
  }
}

export function hydrateAgentOutlineSession(
  root: string,
  chapterId: string,
): Promise<void> {
  const key = JSON.stringify([root, chapterId]);
  const current = outlineHydrations.get(key);
  if (current !== undefined) return current;
  const hydration = hydrateAgentScopedSessionOwned(
    root,
    { kind: "outline", chapterId },
  ).finally(
    () => {
      if (outlineHydrations.get(key) === hydration) {
        outlineHydrations.delete(key);
      }
    },
  );
  outlineHydrations.set(key, hydration);
  return hydration;
}

export function hydrateAgentCharacterSession(
  root: string,
  characterId: string,
): Promise<void> {
  const key = JSON.stringify([root, characterId]);
  const current = characterHydrations.get(key);
  if (current !== undefined) return current;
  const hydration = hydrateAgentScopedSessionOwned(
    root,
    { kind: "character", characterId },
  ).finally(() => {
    if (characterHydrations.get(key) === hydration) {
      characterHydrations.delete(key);
    }
  });
  characterHydrations.set(key, hydration);
  return hydration;
}

async function hydrateScopedCollection(
  root: string,
  ownsTransition: () => boolean,
): Promise<AgentPersistenceIssue | null> {
  if (!ownsTransition() || useProjectStore.getState().project?.root !== root) return null;
  const recovery = failedScopedSaves.get(root);
  if (recovery !== undefined) {
    for (const { sessionId, source } of Object.values(recovery.sources)) {
      const store = agentSessionStore(sessionId);
      if (agentConsoleOwnershipStatus(store.getState(), root) === "ready") continue;
      store.getState().hydrate(root, stateFromSnapshotSource(root, source));
      store.getState().setPersistenceIssue(recovery.issue);
    }
  }
  let collection: LoadedAgentSessionCollection;
  try {
    collection = await loadAgentSessionCollection(root, emptyPersistedAgentState());
  } catch (error) {
    const issue = error instanceof AgentPersistenceError
      ? error.issue
      : persistenceError("load", root, error).issue;
    return { ...issue, scope: "collection" };
  }
  if (!ownsTransition() || useProjectStore.getState().project?.root !== root) return null;
  for (const [chapterId, state] of Object.entries(collection.outlines)) {
    const store = agentSessionStore({ kind: "outline", chapterId });
    if (agentConsoleOwnershipStatus(store.getState(), root) !== "ready") store.getState().hydrate(root, state);
  }
  for (const [characterId, state] of Object.entries(collection.characters)) {
    const store = agentSessionStore({ kind: "character", characterId });
    if (agentConsoleOwnershipStatus(store.getState(), root) !== "ready") store.getState().hydrate(root, state);
  }
  const unavailable: ScopedAgentSessionId[] = [
    ...collection.corruptOutlineChapterIds.map((chapterId): ScopedAgentSessionId => ({ kind: "outline", chapterId })),
    ...collection.corruptCharacterIds.map((characterId): ScopedAgentSessionId => ({ kind: "character", characterId })),
  ];
  for (const sessionId of unavailable) {
    const store = agentSessionStore(sessionId);
    if (agentConsoleOwnershipStatus(store.getState(), root) === "ready") continue;
    const capture = store.getState().beginPersistenceTransition(root, "load");
    store.getState().activatePersistenceTransition(capture);
    failScopedHydration(store, capture, persistenceError("corrupt", root, new Error(`Saved AI session could not be read: ${agentSessionKey(sessionId)}`)).issue);
  }
  return null;
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
    return stateFromSnapshotSource(root, failure.recovery.source);
  }
  if (failure.kind === "write") {
    return restoreAgentSnapshot(root, failure.snapshot);
  }
  return stateFromSnapshotSource(root, failure.source);
}

function stateFromSnapshotSource(root: string, source: AgentSnapshotSource): PersistedAgentState {
  return {
    v: 4,
    mode: source.mode,
    messages: source.messages,
    summary: source.summary,
    draftText: source.draftText,
    draftContextRefs: source.draftContextRefs,
    draftSourceLocators: source.draftSourceLocators,
    proposalRecords: source.proposalRecords.map((record) => ({
      ...record,
      proposal: restorePendingProposal(root, toPersistedPendingProposal(record.proposal)),
    })),
    currentProposalId: source.currentProposalId,
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
  const oldRootHasScopedSessions =
    oldRoot !== null &&
    [...outlineAgentSessionEntries(), ...characterAgentSessionEntries()].some(
      ([, store]) =>
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
  for (const [, store] of characterAgentSessionEntries()) {
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

    if (oldRoot !== null && oldRootHasScopedSessions) {
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
      clearCharacterAgentSessions();
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
      await hydrateScopedCollection(nextRoot, () => ownsPersistenceCapture(persistenceCapture));
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

    const scopedIssue = await hydrateScopedCollection(
      nextRoot,
      () => ownsPersistenceCapture(persistenceCapture),
    );
    const completion = useAgentConsoleStore
      .getState()
      .completePersistenceTransition(capture, loaded);
    if (completion.status === "stale") return;
    const hydratedRevision = nextRevision();
    activeRevision = hydratedRevision;
    persistedRevision = hydratedRevision;
    writableRoot = nextRoot;
    restoreFailedSaveIssue();
    if (scopedIssue !== null) useAgentConsoleStore.getState().setPersistenceIssue(scopedIssue);
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
    if (root !== null && state.persistenceIssue?.scope === "collection") {
      const issue = await hydrateScopedCollection(root, () =>
        agentConsoleOwnershipStatus(useAgentConsoleStore.getState(), root) === "ready",
      );
      if (useProjectStore.getState().project?.root !== root || agentConsoleOwnershipStatus(useAgentConsoleStore.getState(), root) !== "ready") return;
      useAgentConsoleStore.getState().setPersistenceIssue(issue);
      if (issue !== null) throw new AgentPersistenceError(issue);
      return;
    }
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
        if (
          outlineAgentSessionEntries().length > 0 ||
          characterAgentSessionEntries().length > 0
        ) {
          scheduleAgentSessionCollectionSave();
        }
      },
    );
    const outlineUnsubscribes = new Map<string, () => void>();
    const characterUnsubscribes = new Map<string, () => void>();
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
            scheduleAgentSessionCollectionSave(store);
          }),
        );
      }
    };
    const subscribeCharacterSessions = (): void => {
      const liveCharacterIds = new Set(
        characterAgentSessionEntries().map(([characterId]) => characterId),
      );
      for (const [characterId, unsubscribe] of characterUnsubscribes) {
        if (liveCharacterIds.has(characterId)) continue;
        unsubscribe();
        characterUnsubscribes.delete(characterId);
      }
      for (const [characterId, store] of characterAgentSessionEntries()) {
        if (characterUnsubscribes.has(characterId)) continue;
        characterUnsubscribes.set(
          characterId,
          store.subscribe((state, previous) => {
            if (!persistedFieldsChanged(state, previous)) return;
            scheduleAgentSessionCollectionSave(store);
          }),
        );
      }
    };
    subscribeOutlineSessions();
    subscribeCharacterSessions();
    const unsubscribeRegistry = subscribeAgentSessionRegistry(() => {
      subscribeOutlineSessions();
      subscribeCharacterSessions();
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
      if (agentConsoleOwnershipStatus(state, root) !== "ready") {
        return;
      }
      clearSaveTimer();
      if (writableRoot !== root) return;
      void captureActiveSnapshot(root);
      if (
        outlineAgentSessionEntries().length > 0 ||
        characterAgentSessionEntries().length > 0
      ) {
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
      characterUnsubscribes.forEach((unsubscribe) => unsubscribe());
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);
}
