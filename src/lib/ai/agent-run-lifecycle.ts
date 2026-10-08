import type { LanguageModel } from "ai";
import type { AuthorPreferences } from "@/lib/ai/author-preferences";
import {
  compactionTokenTarget,
  compactConversation,
  messagesForNextRequest,
  shouldCompactConversation,
} from "@/lib/ai/agent-compaction";
import {
  agentFailureDiagnosticCode,
  failureFromError,
  modelUnselectedFailure,
  type AgentFailurePhase,
} from "@/lib/ai/agent-failure";
import { settleAgentMessages } from "@/lib/ai/agent-messages";
import { compileAgentPolicy } from "@/lib/ai/agent-prompts";
import { AgentProposalError } from "@/lib/ai/agent-proposals";
import {
  ProposalOriginError,
  proposalOriginChapterId,
  resolveProposalOrigin,
} from "@/lib/ai/proposal-origin";
import type {
  AgentToolFailure,
  StreamAgentRunInput,
  StreamAgentRunResult,
} from "@/lib/ai/agent-runtime";
import {
  characterDescribeGrounding,
  invalidateDraftSourceRefreshes,
  loadChapterSnapshot,
  OutlinePlannerGroundingError,
  refreshAttachedDraftSources,
  requireBridgeAnchor,
  resolveOutlinePlannerGroundingInput,
  type SubmissionCapture,
} from "@/lib/ai/agent-submission-context";
import {
  createAgentToolEnvironment,
  errorDetails,
  isAbortError,
  taggedError,
} from "@/lib/ai/agent-tool-environment";
import type {
  AgentFailure,
  AgentMessageMetadata,
  AgentRun,
  AgentSessionId,
  AgentTask,
  AgentUIMessage,
  ContextSnapshot,
  PendingProposal,
} from "@/lib/ai/agent-types";
import { agentSessionKey, PROJECT_AGENT_SESSION } from "@/lib/ai/agent-types";
import { buildOutlinePlannerGrounding } from "@/lib/outline/planner-grounding";
import { reportAiError } from "@/lib/notifications";
import type { AgentFailureLogEntry } from "@/lib/tauri";
import type { AiProvider } from "@/lib/types";
import {
  agentConsoleOwnershipStatus,
  agentSessionStore,
  selectPendingProposal,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";

export interface AgentControllerDependencies {
  now: () => string;
  id: () => string;
  getModel: (
    provider: AiProvider,
    modelId: string,
  ) => Promise<LanguageModel>;
  getContextWindow: (
    provider: AiProvider,
    modelId: string,
  ) => Promise<number>;
  summarize: (
    model: LanguageModel,
    source: string,
    signal: AbortSignal,
    preferences: AuthorPreferences,
  ) => Promise<string>;
  stream: (input: StreamAgentRunInput) => Promise<StreamAgentRunResult>;
  recordFailure: (entry: AgentFailureLogEntry) => Promise<void>;
}

export type AgentSubmissionOutcome =
  | { status: "success" }
  | { status: "stopped" }
  | { status: "failure"; failure: AgentFailure };

interface AgentRunLifecycle {
  runSubmission: (capture: SubmissionCapture) => Promise<AgentSubmissionOutcome>;
  stopAgentRun: (requestedSessionId?: AgentSessionId) => void;
  abortAgentRunForProjectSwitch: (
    projectRoot: string,
    reason: "project-switch" | "app-exit",
  ) => void;
}

interface ActiveController {
  projectRoot: string;
  sessionId: AgentSessionId;
  runId: string;
  userMessageId: string;
  assistantMessageId: string;
  controller: AbortController;
}

class AgentDraftCompletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentDraftCompletionError";
  }
}

function recordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnosticString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function diagnosticInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function toolFailureChangeTargets(
  toolName: string,
  input: unknown,
): AgentFailureLogEntry["changeTargets"] {
  if (
    toolName !== "stage_manuscript_proposal" &&
    toolName !== "stage_outline_proposal"
  ) {
    return null;
  }
  if (!recordValue(input) || !Array.isArray(input.changes)) return null;
  return input.changes.flatMap((change) => {
    if (!recordValue(change) || typeof change.kind !== "string") return [];
    const blockId = diagnosticString(change.blockId);
    const cardId = diagnosticString(change.cardId);
    return [
      {
        kind: change.kind,
        targetId: blockId === null ? cardId : blockId,
        afterId: diagnosticString(change.afterId),
        toIndex: diagnosticInteger(change.toIndex),
      },
    ];
  });
}

function failureErrorText(error: unknown): string {
  if (error instanceof Error) return (error.message || error.name).slice(0, 2_000);
  if (typeof error === "string") return error.slice(0, 2_000);
  return String(error).slice(0, 2_000);
}

function toolFailureLogEntry(args: {
  failure: AgentToolFailure;
  occurredAt: string;
  provider: AiProvider;
  modelId: string;
  run: AgentRun;
}): AgentFailureLogEntry {
  return {
    kind: "tool",
    occurredAt: args.occurredAt,
    runId: args.run.id,
    provider: args.provider,
    modelId: args.modelId,
    task: args.run.task,
    toolName: args.failure.toolName,
    toolCallId: args.failure.toolCallId,
    changeTargets: toolFailureChangeTargets(
      args.failure.toolName,
      args.failure.input,
    ),
    errorCode: "tool",
    error: failureErrorText(args.failure.error),
  };
}

export function runFailureLogEntry(args: {
  occurredAt: string;
  runId: string;
  provider: AiProvider;
  modelId: string | null;
  task: AgentTask;
  failure: AgentFailure;
  diagnostic: unknown;
}): AgentFailureLogEntry {
  return {
    kind: "run",
    occurredAt: args.occurredAt,
    runId: args.runId,
    provider: args.provider,
    modelId: args.modelId,
    task: args.task,
    toolName: null,
    toolCallId: null,
    changeTargets: null,
    errorCode: agentFailureDiagnosticCode(args.failure),
    error: failureErrorText(errorDetails(args.diagnostic)),
  };
}

export async function persistAgentFailure(
  recordFailure: (entry: AgentFailureLogEntry) => Promise<void>,
  entry: AgentFailureLogEntry,
): Promise<void> {
  try {
    await recordFailure(entry);
  } catch (error) {
    console.error("Agent failure diagnostic could not be written", {
      cause: error,
      kind: entry.kind,
      runId: entry.runId,
    });
  }
}

export function runFailure(
  error: unknown,
  provider: AiProvider,
  phase: AgentFailurePhase,
): AgentFailure {
  if (error instanceof AgentDraftCompletionError || error instanceof ProposalOriginError) {
    return { reason: "tool", message: error.message, action: null, settingsTarget: null };
  }
  if (error instanceof OutlinePlannerGroundingError) {
    return {
      reason: "tool",
      message: error.message,
      action: "retry",
      settingsTarget: null,
    };
  }
  return failureFromError(error, provider, phase);
}

function requireMetadata(message: AgentUIMessage): AgentMessageMetadata {
  if (message.metadata === undefined) {
    throw new Error(`Agent message metadata is missing: ${message.id}`);
  }
  return message.metadata;
}

function userMessage(args: {
  run: AgentRun;
  text: string;
  snapshots: ContextSnapshot[];
  retryOf: string | null;
}): AgentUIMessage {
  return {
    id: args.run.userMessageId,
    role: "user",
    metadata: {
      runId: args.run.id,
      mode: args.run.mode,
      task: args.run.task,
      state: "complete",
      createdAt: args.run.startedAt,
      failure: null,
      retryOf: args.retryOf,
      usage: null,
    },
    parts: [
      { type: "text", text: args.text },
      {
        type: "data-context",
        data: {
          snapshots: args.snapshots.map((snapshot) => ({ ...snapshot })),
        },
      },
    ],
  };
}

function assistantMetadata(args: {
  message: AgentUIMessage;
  run: AgentRun;
  state: AgentMessageMetadata["state"];
  retryOf: string | null;
  failure: AgentFailure | null;
}): AgentUIMessage {
  return {
    ...args.message,
    id: args.message.id,
    role: "assistant",
    metadata: {
      runId: args.run.id,
      mode: args.run.mode,
      task: args.run.task,
      state: args.state,
      createdAt: args.run.startedAt,
      failure: args.failure,
      retryOf: args.retryOf,
      usage: requireMetadata(args.message).usage,
    },
  };
}

function settledAssistantMessage(message: AgentUIMessage): AgentUIMessage {
  const settled = settleAgentMessages([message]);
  if (settled.length !== 1) {
    throw new Error(`Agent run emitted no settled message: ${message.id}`);
  }
  return settled[0];
}

export function createAgentRunLifecycle(
  dependencies: AgentControllerDependencies,
): AgentRunLifecycle {
  const activeControllers = new Map<string, ActiveController>();
  const activeRunError = "An agent run is already active";

  const activeControllerFor = (
    sessionId: AgentSessionId,
  ): ActiveController | null =>
    activeControllers.get(agentSessionKey(sessionId)) ?? null;

  const ownsRun = (
    projectRoot: string,
    runId: string,
    sessionId: AgentSessionId,
  ): boolean => {
    const activeController = activeControllerFor(sessionId);
    if (
      activeController === null ||
      activeController.projectRoot !== projectRoot ||
      activeController.runId !== runId
    ) {
      return false;
    }
    const project = useProjectStore.getState().project;
    if (project === null || project.root !== projectRoot) return false;
    const consoleState = agentSessionStore(sessionId).getState();
    if (
      agentConsoleOwnershipStatus(consoleState, projectRoot) !== "ready"
    ) {
      return false;
    }
    return (
      consoleState.runStatus !== "idle" &&
      (consoleState.activeRun === null ||
        consoleState.activeRun.id === runId)
    );
  };

  const checkToolRun = (
    projectRoot: string,
    runId: string,
    sessionId: AgentSessionId,
  ): void => {
    activeControllerFor(sessionId)?.controller.signal.throwIfAborted();
    if (!ownsRun(projectRoot, runId, sessionId)) {
      throw taggedError(
        "tool",
        new Error(`Agent tool no longer owns run: ${runId}`),
      );
    }
  };

  const cancelPreflight = (sessionId: AgentSessionId): void => {
    agentSessionStore(sessionId).setState({
      activeRun: null,
      runStatus: "idle",
      runError: null,
    });
  };

  const interruptVisibleRun = (
    active: ActiveController,
    reason: "stopped" | "project-switch" | "app-exit",
  ): void => {
    const state = agentSessionStore(active.sessionId).getState();
    const activeRun = state.activeRun;
    if (activeRun === null || activeRun.id !== active.runId) {
      cancelPreflight(active.sessionId);
      return;
    }
    const assistant = [...state.messages]
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" &&
          message.metadata?.runId === active.runId,
      );
    if (assistant !== undefined) {
      state.upsertAssistantMessage(
        settledAssistantMessage({
          ...assistant,
          metadata: {
            ...requireMetadata(assistant),
            state: "stopped",
            failure: null,
          },
        }),
      );
    }
    state.interruptRun({
      runId: active.runId,
      userMessageId: active.userMessageId,
      assistantMessageId: assistant?.id ?? null,
      reason,
      interruptedAt: dependencies.now(),
    });
  };

  const runSubmission = async (
    capture: SubmissionCapture,
  ): Promise<AgentSubmissionOutcome> => {
    const runId = dependencies.id();
    const userMessageId = dependencies.id();
    const assistantMessageId = dependencies.id();
    const abortController = new AbortController();
    const sessionStore = agentSessionStore(capture.sessionId);
    try {
      if (activeControllers.size > 0) throw new Error(activeRunError);
      sessionStore.getState().beginPreflight();
    } catch (error) {
      const refusal = runFailure(error, capture.provider, null);
      reportAiError(error, capture.provider, "AI console", capture.projectRoot, null);
      await persistAgentFailure(
        dependencies.recordFailure,
        runFailureLogEntry({
          occurredAt: dependencies.now(),
          runId,
          provider: capture.provider,
          modelId: capture.modelId,
          task: capture.task,
          failure: refusal,
          diagnostic: error,
        }),
      );
      sessionStore.setState({ runError: refusal });
      return { status: "failure", failure: refusal };
    }
    activeControllers.set(agentSessionKey(capture.sessionId), {
      projectRoot: capture.projectRoot,
      sessionId: capture.sessionId,
      runId,
      userMessageId,
      assistantMessageId,
      controller: abortController,
    });
    const ownsCurrentRun = () =>
      ownsRun(capture.projectRoot, runId, capture.sessionId);
    let enteredRun = false;
    let latestAssistant: AgentUIMessage | null = null;
    let failurePhase: AgentFailurePhase = null;
    let stagedProposal: PendingProposal | null = null;

    try {
      const modelId = capture.modelId;
      if (modelId === null) {
        const failure = modelUnselectedFailure(capture.provider);
        reportAiError({ failure }, capture.provider, "AI console", capture.projectRoot, null);
        await persistAgentFailure(
          dependencies.recordFailure,
          runFailureLogEntry({
            occurredAt: dependencies.now(),
            runId,
            provider: capture.provider,
            modelId,
            task: capture.task,
            failure,
            diagnostic: failure.message,
          }),
        );
        sessionStore.getState().failPreflight(failure);
        return { status: "failure", failure };
      }
      const [attachmentsResult, targetResult] = await Promise.allSettled([
        capture.resolveAttachments(
          abortController.signal,
          ownsCurrentRun,
        ),
        capture.resolveTaskAndTarget(),
      ]);
      if (!ownsCurrentRun()) return { status: "stopped" };
      if (attachmentsResult.status === "rejected") {
        throw attachmentsResult.reason;
      }
      const attachments = attachmentsResult.value;
      if (attachments.snapshots.length !== attachments.refs.length) {
        throw new Error(
          "Remove unavailable context sources before submitting this request.",
        );
      }
      if (targetResult.status === "rejected") {
        if (capture.sessionId.kind === "outline") {
          const chapterId = capture.sessionId.chapterId;
          const message =
            targetResult.reason instanceof Error
              ? targetResult.reason.message
              : String(targetResult.reason);
          throw new OutlinePlannerGroundingError(
            `Outline planner grounding failed for chapter ${chapterId} at target source ${chapterId}: ${message}`,
            { cause: targetResult.reason },
          );
        }
        throw targetResult.reason;
      }
      const target = targetResult.value;
      const originalChapterId = target.chapter === null && target.task.kind === "proposal-follow-up"
        ? proposalOriginChapterId({
            proposalId: target.task.proposalId,
            mode: capture.mode,
            projectRoot: capture.projectRoot,
            records: capture.proposalRecords,
            messages: capture.messages,
          })
        : null;
      const frozen = {
        task: target.task,
        chapter: originalChapterId === null ? target.chapter : await loadChapterSnapshot(capture.project, originalChapterId, capture.activeChapter),
      };
      if (!ownsCurrentRun()) return { status: "stopped" };
      const origin = resolveProposalOrigin({
        task: frozen.task,
        mode: capture.mode,
        projectRoot: capture.projectRoot,
        targetChapterId: frozen.chapter === null ? null : frozen.chapter.chapterId,
        blocks: frozen.chapter === null ? [] : frozen.chapter.blocks,
        sourceGeneration: frozen.chapter === null ? null : frozen.chapter.sourceGeneration,
        records: capture.proposalRecords,
        messages: capture.messages,
      });
      if (origin.task.kind === "bridge") {
        if (frozen.chapter === null) throw new AgentProposalError("wrong-chapter", "The original bridge chapter is unavailable. Start the original action again.");
        requireBridgeAnchor(origin.task, frozen.chapter);
      }
      const describeGrounding = characterDescribeGrounding(
        capture,
        frozen.task,
      );
      const plannerGroundingInput = await resolveOutlinePlannerGroundingInput(
        capture,
        frozen.chapter,
      );

      const model = await dependencies.getModel(
        capture.provider,
        modelId,
      );
      failurePhase = null;
      const contextWindow = await dependencies.getContextWindow(
        capture.provider,
        modelId,
      );
      if (!ownsCurrentRun()) return { status: "stopped" };
      const plannerGrounding =
        plannerGroundingInput === null
          ? null
          : buildOutlinePlannerGrounding(
              plannerGroundingInput,
              Math.max(1, Math.floor(contextWindow / 2)),
            );

      let summary = capture.summary;
      failurePhase = "compaction";
      if (
        capture.lastUsage !== null &&
        shouldCompactConversation(capture.lastUsage)
      ) {
        const compacted = await compactConversation({
          messages: capture.messages,
          currentSummary: summary,
          tokenTarget: compactionTokenTarget(capture.lastUsage),
          summarize: (source) =>
            dependencies.summarize(model, source, abortController.signal, {
              styleGuide: capture.styleGuide, editingRules: capture.editingRules,
            }),
        });
        if (!ownsCurrentRun()) return { status: "stopped" };
        summary = compacted.summary;
        if (summary !== null && summary !== capture.summary) {
          sessionStore.getState().setSummary(summary);
        }
      }
      if (!ownsCurrentRun()) return { status: "stopped" };

      const run: AgentRun = {
        id: runId,
        projectRoot: capture.projectRoot,
        mode: capture.mode,
        task: frozen.task,
        userMessageId,
        attachments: attachments.snapshots.map((snapshot) => ({ ...snapshot })),
        startedAt: dependencies.now(),
      };
      const user = userMessage({
        run,
        text: capture.text,
        snapshots: run.attachments,
        retryOf: capture.retryOf,
      });
      const requestMessages = [
        ...messagesForNextRequest(capture.messages, summary),
        user,
      ];
      failurePhase = null;
      const policy = compileAgentPolicy({
        mode: run.mode,
        task: run.task,
        origin,
        styleGuide: capture.styleGuide,
        editingRules: capture.editingRules,
        sessionId: capture.sessionId,
      });
      const instructions =
        [policy.instructions, plannerGrounding, describeGrounding]
          .filter((part): part is string => part !== null)
          .join("\n\n");
      const environment = createAgentToolEnvironment({
        run,
        origin,
        policy,
        model,
        styleGuide: capture.styleGuide,
        editingRules: capture.editingRules,
        project: capture.project,
        meta: capture.meta,
        activeChapter: capture.activeChapter,
        targetChapter: frozen.chapter,
        history: capture.messages,
        assistantMessageId,
        signal: abortController.signal,
        sessionId: capture.sessionId,
        checkRun: () => checkToolRun(capture.projectRoot, runId, capture.sessionId),
        ownsRun: ownsCurrentRun,
        makeId: dependencies.id,
        now: dependencies.now,
        stageProposal: (proposal) => {
          if (origin.task.kind === "bridge" && (
            proposal.kind !== "manuscript" || proposal.changes.length === 0 ||
            proposal.changes.some((item) => item.change.kind !== "insert" || item.change.newText === null || item.change.newText.trim() === "")
          )) {
            throw new AgentDraftCompletionError("No continuation draft was produced. Open AI to review the response before trying again.");
          }
          stagedProposal = proposal;
          if (run.task.kind !== "proposal-follow-up") {
            useViewStore.getState().closeManuscriptReview();
            sessionStore.getState().stageProposal(proposal, {
              kind: "run", runId: run.id, task: run.task, text: capture.text, origin: origin.origin,
            });
            if (run.task.kind === "bridge") {
              useViewStore.getState().selectChange(agentSessionKey(capture.sessionId), proposal.id);
            }
          }
        },
      });
      capture.enterRun(run, user);
      enteredRun = true;
      if (!ownsCurrentRun()) return { status: "stopped" };
      sessionStore.getState().markStreaming();

      const result = await dependencies.stream({
        model,
        modelId,
        contextWindow,
        run,
        instructions,
        messages: requestMessages,
        environment,
        signal: abortController.signal,
        generateMessageId: () => assistantMessageId,
        onMessage: (message) => {
          if (!ownsCurrentRun()) return;
          latestAssistant = assistantMetadata({
            message,
            run,
            state: requireMetadata(message).state,
            retryOf: capture.retryOf,
            failure: null,
          });
          sessionStore.getState().upsertAssistantMessage(latestAssistant);
        },
        onToolFailure: async (failure) => {
          await persistAgentFailure(
            dependencies.recordFailure,
            toolFailureLogEntry({
              failure,
              occurredAt: dependencies.now(),
              provider: capture.provider,
              modelId,
              run,
            }),
          );
        },
      });
      if (!ownsCurrentRun()) return { status: "stopped" };
      const completed = assistantMetadata({
        message: result.message,
        run,
        state: "complete",
        retryOf: capture.retryOf,
        failure: null,
      });
      latestAssistant = completed;
      if (origin.task.kind === "bridge" && stagedProposal === null) {
        throw new AgentDraftCompletionError("No continuation draft was produced. Open AI to review the response before trying again.");
      }
      const settled = settledAssistantMessage(completed);
      if (run.task.kind === "proposal-follow-up" && stagedProposal !== null) {
        const current = selectPendingProposal(sessionStore.getState(), run.task.proposalId);
        if (current === null || JSON.stringify(current) !== JSON.stringify(capture.pendingProposal)) {
          throw new AgentDraftCompletionError("The draft changed during this request. Its replacement was not saved; review the current draft before trying again.");
        }
        sessionStore.getState().commitProposalReplacement(run.task.proposalId, stagedProposal, {
          kind: "run", runId: run.id, task: run.task, text: capture.text, origin: origin.origin,
        });
      }
      sessionStore.getState().finishRun(settled, result.usage);
      return { status: "success" };
    } catch (error) {
      if (!ownsCurrentRun()) return { status: "stopped" };
      if (isAbortError(error)) {
        const activeController = activeControllerFor(capture.sessionId);
        if (
          activeController !== null &&
          activeController.projectRoot === capture.projectRoot &&
          activeController.runId === runId
        ) {
          interruptVisibleRun(activeController, "stopped");
        }
        return { status: "stopped" };
      }
      const failure = runFailure(error, capture.provider, failurePhase);
      reportAiError(error, capture.provider, "AI console", capture.projectRoot, failurePhase);
      const activeRun = sessionStore.getState().activeRun;
      await persistAgentFailure(
        dependencies.recordFailure,
        runFailureLogEntry({
          occurredAt: dependencies.now(),
          runId,
          provider: capture.provider,
          modelId: capture.modelId,
          task: activeRun === null ? capture.task : activeRun.task,
          failure,
          diagnostic: error,
        }),
      );
      if (!ownsCurrentRun()) return { status: "stopped" };
      console.error("Agent run failed", {
        cause: error,
        reason: failure.reason,
        message: failure.message,
        modelId: capture.modelId,
        provider: capture.provider,
        phase: failurePhase,
        projectRoot: capture.projectRoot,
        runId,
      });
      if (!enteredRun) {
        sessionStore.getState().failPreflight(failure);
      } else {
        if (activeRun === null) return { status: "stopped" };
        const base =
          latestAssistant ??
          ({
            id: assistantMessageId,
            role: "assistant",
            metadata: {
              runId: activeRun.id,
              mode: activeRun.mode,
              task: activeRun.task,
              state: "error",
              createdAt: activeRun.startedAt,
              failure,
              retryOf: capture.retryOf,
              usage: null,
            },
            parts: [],
          } satisfies AgentUIMessage);
        const failed = assistantMetadata({
          message: base,
          run: activeRun,
          state: "error",
          retryOf: capture.retryOf,
          failure,
        });
        sessionStore.getState().failRun(settledAssistantMessage(failed), failure);
      }
      return { status: "failure", failure };
    } finally {
      const activeController = activeControllerFor(capture.sessionId);
      if (
        activeController?.projectRoot === capture.projectRoot &&
        activeController.runId === runId
      ) {
        activeControllers.delete(agentSessionKey(capture.sessionId));
        if (capture.sessionId.kind === "project") {
          void refreshAttachedDraftSources();
        }
      }
    }
  };

  const stopAgentRun = (
    requestedSessionId?: AgentSessionId,
  ): void => {
    const sessionId = requestedSessionId ?? PROJECT_AGENT_SESSION;
    const sessionKey = agentSessionKey(sessionId);
    const active = activeControllers.get(sessionKey);
    if (active === undefined) return;
    activeControllers.delete(sessionKey);
    interruptVisibleRun(active, "stopped");
    active.controller.abort();
    if (sessionId.kind === "project") void refreshAttachedDraftSources();
  };

  const abortAgentRunForProjectSwitch = (
    projectRoot: string,
    reason: "project-switch" | "app-exit",
  ): void => {
    invalidateDraftSourceRefreshes();
    for (const [sessionKey, active] of [...activeControllers.entries()]) {
      if (active.projectRoot !== projectRoot) continue;
      interruptVisibleRun(active, reason);
      active.controller.abort();
      activeControllers.delete(sessionKey);
    }
  };

  return {
    runSubmission,
    stopAgentRun,
    abortAgentRunForProjectSwitch,
  };
}
