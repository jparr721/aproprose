import { reportAiError } from "@/lib/notifications";
import { generateText } from "ai";
import { buildCompactionInstructions } from "@/lib/ai/agent-compaction";
import { getModel } from "@/lib/ai/model";
import { resolveModelContextWindow } from "@/lib/ai/models";
import {
  createAgentRunLifecycle,
  persistAgentFailure,
  runFailure,
  runFailureLogEntry,
  type AgentControllerDependencies,
  type AgentSubmissionOutcome,
} from "@/lib/ai/agent-run-lifecycle";
import { streamAgentRun } from "@/lib/ai/agent-runtime";
import {
  createAgentSubmissionContext,
  invalidateDraftSourceRefreshes,
  refreshAttachedDraftSources,
} from "@/lib/ai/agent-submission-context";
import type {
  AgentIntent,
  AgentSessionId,
  AgentTask,
  AgentUIMessage,
  DraftContextRef,
  ProposalEventData,
} from "@/lib/ai/agent-types";
import { PROJECT_AGENT_SESSION } from "@/lib/ai/agent-types";
import { uid } from "@/lib/id";
import { appendAgentFailureLog } from "@/lib/tauri";
import {
  agentSessionStore,
  requireAgentSessionProject,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useViewStore } from "@/stores/view-store";

export type {
  AgentControllerDependencies,
  AgentSubmissionOutcome,
} from "@/lib/ai/agent-run-lifecycle";

export function createAgentController(
  dependencies: AgentControllerDependencies,
) {
  const lifecycle = createAgentRunLifecycle(dependencies);
  const context = createAgentSubmissionContext(dependencies.id);
  const { stopAgentRun, abortAgentRunForProjectSwitch } = lifecycle;

  const submitAgentDraft = async (
    task: AgentTask,
    requestedSessionId?: AgentSessionId,
  ): Promise<AgentSubmissionOutcome> => {
    const capture = context.captureDraftSubmission(task, requestedSessionId);
    return capture === null
      ? { status: "success" }
      : lifecycle.runSubmission(capture);
  };

  const submitAgentRequest = async (
    request: Extract<AgentIntent, { kind: "run" }>,
    requestedSessionId?: AgentSessionId,
  ): Promise<AgentSubmissionOutcome> => {
    const capture = context.captureRequestSubmission(request, requestedSessionId);
    return capture === null
      ? { status: "success" }
      : lifecycle.runSubmission(capture);
  };

  const retryAgentTurn = async (
    userMessageId: string,
    requestedSessionId?: AgentSessionId,
  ): Promise<AgentSubmissionOutcome> => {
    const capture = context.captureRetrySubmission(userMessageId, requestedSessionId);
    return lifecycle.runSubmission(capture);
  };

  const recordProposalEvent = (
    event: ProposalEventData,
    requestedSessionId?: AgentSessionId,
  ): void => {
    const sessionId = requestedSessionId ?? PROJECT_AGENT_SESSION;
    const project = useProjectStore.getState().project;
    if (project === null) {
      throw new Error("Open a project before recording a proposal decision.");
    }
    requireAgentSessionProject(sessionId, project.root);
    const sessionStore = agentSessionStore(sessionId);
    const mode = sessionStore.getState().mode;
    const createdAt = dependencies.now();
    const message: AgentUIMessage = {
      id: dependencies.id(),
      role: "assistant",
      metadata: {
        runId: dependencies.id(),
        mode,
        task: { kind: "proposal-follow-up", proposalId: event.proposalId },
        state: "complete",
        createdAt,
        failure: null,
        retryOf: null,
        usage: null,
      },
      parts: [
        {
          type: "data-proposal-event",
          data: { ...event },
        },
      ],
    };
    sessionStore.getState().appendLocalMessage(message);
  };

  const addAgentContext = async (
    refs: DraftContextRef[],
    sessionId: AgentSessionId,
  ): Promise<void> => {
    agentSessionStore(sessionId).getState().addDraftContextRefs(refs);
    await context.resolveAgentDraftContext(sessionId);
  };

  const prefillAgentDraft = async (
    intent: Extract<AgentIntent, { kind: "prefill" }>,
    sessionId: AgentSessionId,
  ): Promise<void> => {
    const store = agentSessionStore(sessionId).getState();
    store.setMode(intent.mode);
    store.setDraftText(intent.text);
    store.setDraftContextRefs(intent.refs);
    await context.resolveAgentDraftContext(sessionId);
  };

  const dispatchAgentIntent = async (
    intent: AgentIntent,
    requestedSessionId?: AgentSessionId,
  ): Promise<void> => {
    const sessionId = requestedSessionId ?? PROJECT_AGENT_SESSION;
    const sessionStore = agentSessionStore(sessionId);
    const frozenIntent = structuredClone(intent);
    if (sessionId.kind === "project") {
      if (frozenIntent.kind === "run" && frozenIntent.task.kind === "bridge") {
        useViewStore.getState().openChanges();
      } else {
        useViewStore.getState().openAiConsole();
      }
    }
    sessionStore.setState({ runError: null });
    try {
      const project = useProjectStore.getState().project;
      if (project === null) {
        throw new Error("Open a project before using the agent console.");
      }
      requireAgentSessionProject(sessionId, project.root);
      if (frozenIntent.kind === "focus") {
        sessionStore.getState().setMode(frozenIntent.mode);
        return;
      }
      if (frozenIntent.kind === "add-context") {
        await addAgentContext(frozenIntent.refs, sessionId);
        return;
      }
      if (frozenIntent.kind === "prefill") {
        await prefillAgentDraft(frozenIntent, sessionId);
        return;
      }
      sessionStore.getState().setMode(frozenIntent.mode);
      await submitAgentRequest(frozenIntent, sessionId);
    } catch (error) {
      if (sessionStore.getState().runError === null) {
        const failure = runFailure(
          error,
          useSettingsStore.getState().aiProvider,
          null,
        );
        if (frozenIntent.kind === "run") {
          const settings = useSettingsStore.getState();
          await persistAgentFailure(
            dependencies.recordFailure,
            runFailureLogEntry({
              occurredAt: dependencies.now(),
              runId: dependencies.id(),
              provider: settings.aiProvider,
              modelId: settings.aiModel,
              task: frozenIntent.task,
              failure,
              diagnostic: error,
            }),
          );
        }
        const project = useProjectStore.getState().project;
        reportAiError(error, useSettingsStore.getState().aiProvider, "AI console", project === null ? null : project.root, null);
        sessionStore.setState({ runError: failure });
      }
    }
  };

  return {
    submitAgentDraft,
    submitAgentRequest,
    stopAgentRun,
    retryAgentTurn,
    recordProposalEvent,
    abortAgentRunForProjectSwitch,
    dispatchAgentIntent,
  };
}

useAgentConsoleStore.subscribe((state, previous) => {
  if (
    state.hydratedProjectRoot !== previous.hydratedProjectRoot ||
    (previous.persistenceTransition !== null &&
      state.persistenceTransition === null)
  ) {
    invalidateDraftSourceRefreshes();
    void refreshAttachedDraftSources();
  }
});

useProjectStore.subscribe((state, previous) => {
  if (
    state.project?.root !== previous.project?.root ||
    state.activeChapterId !== previous.activeChapterId ||
    state.blocks !== previous.blocks ||
    state.meta !== previous.meta
  ) {
    void refreshAttachedDraftSources();
  }
});

const productionController = createAgentController({
  now: () => new Date().toISOString(),
  id: () => uid("agent"),
  getModel,
  getContextWindow: resolveModelContextWindow,
  summarize: async (model, source, signal, preferences) => {
    const result = await generateText({
      model,
      system: buildCompactionInstructions(preferences),
      prompt: source,
      abortSignal: signal,
    });
    return result.text;
  },
  stream: streamAgentRun,
  recordFailure: appendAgentFailureLog,
});

export const submitAgentDraft = productionController.submitAgentDraft;
export const submitAgentRequest = productionController.submitAgentRequest;
export const stopAgentRun = productionController.stopAgentRun;
export const retryAgentTurn = productionController.retryAgentTurn;
export const recordProposalEvent = productionController.recordProposalEvent;
export const abortAgentRunForProjectSwitch =
  productionController.abortAgentRunForProjectSwitch;
export const dispatchAgentIntent = productionController.dispatchAgentIntent;
