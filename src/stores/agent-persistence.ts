import { useEffect } from "react";
import { z } from "zod";
import { abortAgentRunForProjectSwitch } from "@/lib/ai/agent-controller";
import {
  sanitizeAgentMessages,
  validateAgentMessages,
} from "@/lib/ai/agent-messages";
import type {
  AgentPersistenceIssue,
  PersistedAgentState,
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
  projectRoot: z.string(),
  chapterId: z.string(),
  summary: z.string(),
  createdAt: z.string(),
  originatingMessageId: z.string(),
};

const pendingProposalSchema = z.discriminatedUnion("kind", [
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
]);

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

interface FailedAgentSave {
  root: string;
  snapshot: PersistedAgentState;
}

const SAVE_DEBOUNCE_MS = 400;

let activeRoot: string | null = null;
let writableRoot: string | null = null;
let requestedRoot: string | null = null;
let failedSave: FailedAgentSave | null = null;
let transition: Promise<void> = Promise.resolve();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

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
        (part.type === "dynamic-tool" || part.type.startsWith("tool-")) &&
        "state" in part &&
        part.state === "output-available"
      ) {
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

function failedSaveIssue(root: string): AgentPersistenceIssue {
  return {
    kind: "save",
    projectRoot: root,
    message: `Failed to save agent conversation for ${root}. Retry to preserve the captured conversation.`,
  };
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

export function emptyPersistedAgentState(): PersistedAgentState {
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

export async function toAgentSnapshot(): Promise<PersistedAgentState> {
  const state = useAgentConsoleStore.getState();
  const snapshot: PersistedAgentState = {
    v: 3,
    mode: state.mode,
    messages: sanitizeAgentMessages(state.messages),
    summary: state.summary,
    draftText: state.draftText,
    draftContextRefs: state.draftContextRefs,
    draftSourceLocators: state.draftSourceLocators,
    pendingProposal: state.pendingProposal,
    lastUsage: state.lastUsage,
    interruptedRun: state.interruptedRun,
  };
  return structuredClone(snapshot);
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
  } catch (error) {
    throw persistenceError("corrupt", root, error);
  }
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
  snapshot: PersistedAgentState,
): Promise<void> {
  const captured = structuredClone(snapshot);
  let safeSnapshot: PersistedAgentState;
  try {
    safeSnapshot = await fromAgentSnapshot(root, captured);
  } catch (error) {
    throw saveIssue(root, error);
  }
  try {
    await writeAppData(agentStateKey(root), safeSnapshot);
    if (failedSave?.root === root) failedSave = null;
    if (activeRoot === root && requestedRoot === root) writableRoot = root;
    const currentIssue = useAgentConsoleStore.getState().persistenceIssue;
    if (currentIssue !== null && currentIssue.projectRoot === root) {
      useAgentConsoleStore.getState().setPersistenceIssue(null);
    }
  } catch (error) {
    const failure = saveIssue(root, error);
    if (failedSave === null || failedSave.root === root) {
      failedSave = { root, snapshot: captured };
    }
    throw failure;
  }
}

function captureActiveSnapshot(root: string): Promise<void> {
  const snapshot = toAgentSnapshot();
  return appendTransition(async () => {
    try {
      await saveAgentState(root, await snapshot);
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
    requestedRoot !== root ||
    failedSave !== null
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
    requestedRoot !== root ||
    failedSave !== null
  ) {
    return;
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (
      activeRoot !== root ||
      writableRoot !== root ||
      requestedRoot !== root ||
      failedSave !== null
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
    const oldRootWasWritable = oldRoot !== null && writableRoot === oldRoot;
    writableRoot = null;
    if (oldRoot !== null) {
      abortAgentRunForProjectSwitch(oldRoot, "project-switch");
    }

    if (oldRoot !== null && oldRootWasWritable) {
      try {
        const snapshot = await toAgentSnapshot();
        await saveAgentState(oldRoot, snapshot);
      } catch (error) {
        logPersistenceFailure(oldRoot, error);
      }
    }

    useAgentConsoleStore.getState().resetProject();
    activeRoot = nextRoot;
    if (nextRoot === null) return;

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
      return;
    }
    if (requestedRoot !== nextRoot) return;

    useAgentConsoleStore.getState().hydrate(nextRoot, loaded);
    writableRoot = nextRoot;
    if (failedSave !== null) {
      useAgentConsoleStore
        .getState()
        .setPersistenceIssue(failedSaveIssue(failedSave.root));
    }
  });
}

export function retryAgentPersistence(): Promise<void> {
  return appendTransition(async () => {
    if (failedSave !== null) {
      const retry = failedSave;
      await saveAgentState(retry.root, retry.snapshot);
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
    await saveAgentState(root, await toAgentSnapshot());
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
        if (persistedFieldsChanged(state, previous)) scheduleAgentSave();
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
