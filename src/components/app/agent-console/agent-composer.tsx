import { useEffect, useRef } from "react";
import { IconPencil, IconWand } from "@tabler/icons-react";
import { isToolOrDynamicToolUIPart, type ChatStatus, type LanguageModelUsage } from "ai";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
  type ChainOfThoughtStepProps,
} from "@/components/ai-elements/chain-of-thought";
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextTrigger,
} from "@/components/ai-elements/context";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { DraftContextAttachments } from "@/components/app/agent-console/context-attachments";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { TypographyMuted, TypographySmall } from "@/components/ui/typography";
import {
  stopAgentRun,
  submitAgentDraft,
} from "@/lib/ai/agent-controller";
import { safeAgentErrorText } from "@/lib/ai/agent-error-copy";
import { agentFailureActionLabel } from "@/lib/ai/agent-failure";
import { agentToolTitle } from "@/lib/ai/agent-messages";
import type { AgentSessionId, AgentTask, AgentUIMessage } from "@/lib/ai/agent-types";
import { PROJECT_AGENT_SESSION } from "@/lib/ai/agent-types";
import { cn } from "@/lib/utils";
import {
  agentConsoleOwnershipStatus,
  agentSessionStore,
  useAgentSessionStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import {
  useSettingsDialogStore,
} from "@/stores/settings-dialog-store";
import { useViewStore } from "@/stores/view-store";

export interface AgentComposerProps {
  task: AgentTask | null;
  placeholder: string;
  sessionId?: AgentSessionId;
}

type AgentToolPart = Extract<AgentUIMessage["parts"][number], { type: `tool-${string}` | "dynamic-tool" }>;

const toolStepStates: Record<AgentToolPart["state"], Pick<ChainOfThoughtStepProps, "status" | "description">> = {
  "input-streaming": { status: "pending", description: "Preparing" },
  "input-available": { status: "active", description: "Running" },
  "approval-requested": { status: "active", description: "Awaiting approval" },
  "approval-responded": { status: "active", description: "Approval received" },
  "output-available": { status: "complete", description: "Completed" },
  "output-error": { status: "complete", description: "Failed" },
  "output-denied": { status: "complete", description: "Denied" },
};

function AgentActivity({ sessionId }: { sessionId: AgentSessionId }) {
  const runStatus = useAgentSessionStore(sessionId, (state) => state.runStatus);
  const activityOpenOverride = useAgentSessionStore(sessionId, (state) => state.activityOpenOverride);
  const setActivityOpenOverride = useAgentSessionStore(sessionId, (state) => state.setActivityOpenOverride);
  const assistant = useAgentSessionStore(sessionId, (state) =>
    state.messages.findLast((message) =>
      message.role === "assistant" &&
      (state.runStatus === "idle" ||
        (state.activeRun !== null && message.metadata?.runId === state.activeRun.id)),
    ) ?? null,
  );
  const working = runStatus !== "idle";
  const toolParts = assistant === null ? [] : assistant.parts.filter(isToolOrDynamicToolUIPart);
  if (!working && toolParts.length === 0) return null;
  const state = assistant?.metadata?.state;
  const needsAttention = toolParts.some((part) => part.state === "output-error" || part.state === "output-denied");
  let label = "Activity complete";
  if (working) label = "Working on your request";
  else if (state === "stopped") label = "Activity stopped";
  else if (state === "error" || needsAttention) label = "Activity needs attention";

  return (
    <ChainOfThought
      aria-label="AI activity"
      onOpenChange={setActivityOpenOverride}
      open={activityOpenOverride ?? working}
      role="status"
    >
      <ChainOfThoughtHeader>
        {working ? <Spinner aria-hidden="true" /> : null}
        {label}
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent className="max-h-32 overflow-y-auto">
        {toolParts.map((part) => {
          const step = toolStepStates[part.state];
          const interrupted = !working && (step.status === "active" || step.status === "pending");
          return (
            <ChainOfThoughtStep
              description={interrupted ? "Interrupted" : step.description}
              key={part.toolCallId}
              label={agentToolTitle(part)}
              status={interrupted ? "complete" : step.status}
            />
          );
        })}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}

export function AgentComposer({
  task,
  placeholder,
  sessionId: requestedSessionId,
}: AgentComposerProps) {
  const sessionId = requestedSessionId ?? PROJECT_AGENT_SESSION;
  const mode = useAgentSessionStore(sessionId, (state) => state.mode);
  const setMode = useAgentSessionStore(sessionId, (state) => state.setMode);
  const draftText = useAgentSessionStore(sessionId, (state) => state.draftText);
  const setDraftText = useAgentSessionStore(sessionId, (state) => state.setDraftText);
  const draftContextRefs = useAgentSessionStore(sessionId,
    (state) => state.draftContextRefs,
  );
  const draftContextSources = useAgentSessionStore(sessionId,
    (state) => state.draftContextSources,
  );
  const removeDraftContextRef = useAgentSessionStore(sessionId,
    (state) => state.removeDraftContextRef,
  );
  const runStatus = useAgentSessionStore(sessionId, (state) => state.runStatus);
  const runError = useAgentSessionStore(sessionId, (state) => state.runError);
  const lastUsage = useAgentSessionStore(sessionId, (state) => state.lastUsage);
  const projectRoot = useProjectStore(
    (state) => state.project?.root ?? null,
  );
  const ownershipStatus = useAgentSessionStore(sessionId, (state) =>
    agentConsoleOwnershipStatus(state, projectRoot),
  );

  const status: ChatStatus =
    runStatus === "submitted"
      ? "submitted"
      : runStatus === "streaming"
        ? "streaming"
        : "ready";
  const displayUsage: LanguageModelUsage | undefined =
    lastUsage === null
      ? undefined
      : {
          ...lastUsage.raw,
          inputTokens: lastUsage.inputTokens,
          outputTokens: lastUsage.outputTokens,
          totalTokens: lastUsage.totalTokens,
        };
  const tokenlensModelId =
    lastUsage === null
      ? undefined
      : lastUsage.modelId.includes("/")
        ? lastUsage.modelId.replace("/", ":")
        : `openai:${lastUsage.modelId.replace(/^(openai:)+/, "")}`;
  const contextWindow = lastUsage === null ? 0 : lastUsage.contextWindow;
  const usedTokens = lastUsage === null ? 0 : lastUsage.totalTokens;
  const hasMeaningfulDraft =
    draftText.trim().length > 0 || draftContextRefs.length > 0;
  const blocksTargetEditing = ownershipStatus !== "ready";
  let composerPlaceholder: string = placeholder;
  if (sessionId.kind === "project" && task === null) {
    composerPlaceholder = mode === "writing"
      ? "Where should the story go next?"
      : "What would you like to refine?";
  }
  const aiComposerFocusRequested = useViewStore(
    (state) => state.aiComposerFocusRequested,
  );
  const composerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      sessionId.kind !== "project" ||
      !aiComposerFocusRequested ||
      blocksTargetEditing
    )
      return;
    const textarea = composerRef.current?.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Message AI Console"]',
    );
    if (textarea === null || textarea === undefined) return;
    textarea.focus({ preventScroll: true });
    useViewStore.getState().consumeAiComposerFocusRequest();
  }, [aiComposerFocusRequested, blocksTargetEditing, sessionId.kind]);


  const handleSubmit = async (): Promise<"submitted" | "failed"> => {
    if (
      runStatus !== "idle" ||
      !hasMeaningfulDraft
    ) {
      return "failed";
    }
    const consoleState = agentSessionStore(sessionId).getState();
    if (
      consoleState.activeRun !== null ||
      consoleState.runStatus !== "idle"
    ) {
      return "failed";
    }
    if (
      consoleState.draftText.trim().length === 0 &&
      consoleState.draftContextRefs.length === 0
    ) {
      return "failed";
    }
    const initialTask: AgentTask = task ?? {
      kind: "conversation",
      targetChapterId: useProjectStore.getState().activeChapterId,
    };
    const submittedTask: AgentTask =
      consoleState.pendingProposal === null
        ? initialTask
        : {
            kind: "proposal-follow-up",
            proposalId: consoleState.pendingProposal.id,
          };
    const outcome =
      sessionId.kind === "project"
        ? await submitAgentDraft(submittedTask)
        : await submitAgentDraft(submittedTask, sessionId);
    return outcome.status === "failure" ? "failed" : "submitted";
  };

  return (
    <div
      ref={composerRef}
      aria-label="Agent composer"
      className="flex shrink-0 flex-col gap-2 border-t border-border bg-background p-3"
      role="region"
    >
      <AgentActivity sessionId={sessionId} />
      {blocksTargetEditing ? (
        <TypographyMuted>AI conversation is loading.</TypographyMuted>
      ) : null}
      {runError === null ? null : (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <TypographyMuted className="text-destructive" role="alert">
            {safeAgentErrorText(runError)}
          </TypographyMuted>
          {runError.settingsTarget === null ||
          agentFailureActionLabel(runError) === null ? null : (
            <Button
              onClick={() =>
                useSettingsDialogStore
                  .getState()
                  .openAiSettings(runError.settingsTarget as "key" | "model")
              }
              size="sm"
              type="button"
              variant="outline"
            >
              {agentFailureActionLabel(runError)}
            </Button>
          )}
        </div>
      )}
      <PromptInput
        className={cn(
          "[&_[data-slot=input-group]]:transition-colors",
          mode === "writing"
            ? "[&_[data-slot=input-group]]:border-ai-edge [&_[data-slot=input-group]]:bg-ai-tint/40"
            : "[&_[data-slot=input-group]]:border-accent-ink/40 [&_[data-slot=input-group]]:bg-accent/40",
        )}
        onSubmit={handleSubmit}
      >
        {draftContextRefs.length === 0 ? null : (
          <PromptInputHeader>
            <DraftContextAttachments
              disabled={blocksTargetEditing}
              onRemove={removeDraftContextRef}
              refs={draftContextRefs}
              sources={draftContextSources}
            />
          </PromptInputHeader>
        )}
        <PromptInputBody>
          <PromptInputTextarea
            aria-label="Message AI Console"
            disabled={blocksTargetEditing}
            onChange={(event) => setDraftText(event.currentTarget.value)}
            placeholder={composerPlaceholder}
            value={draftText}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            {sessionId.kind === "project" ? (
              <>
                <PromptInputSelect
                  disabled={blocksTargetEditing}
                  onValueChange={(value: string): void => {
                    if (value !== "writing" && value !== "edit") {
                      throw new RangeError(`Unknown agent mode: ${value}`);
                    }
                    setMode(value);
                  }}
                  value={mode}
                >
                  <PromptInputSelectTrigger aria-label="Agent mode">
                    {mode === "writing" ? <IconWand aria-hidden="true" /> : <IconPencil aria-hidden="true" />}
                    <PromptInputSelectValue>{mode === "writing" ? "Writing" : "Edit"}</PromptInputSelectValue>
                  </PromptInputSelectTrigger>
                  <PromptInputSelectContent align="start" className="w-64 p-1" position="popper" side="top">
                    <PromptInputSelectItem className="py-3 pr-8" textValue="Writing" value="writing">
                      <IconWand aria-hidden="true" className="self-start text-ai-ink" />
                      <div className="flex flex-col gap-1">
                        <TypographySmall className="text-xs">Writing</TypographySmall>
                        <TypographyMuted className="text-xs">Continue scenes and explore ideas</TypographyMuted>
                      </div>
                    </PromptInputSelectItem>
                    <PromptInputSelectItem className="py-3 pr-8" textValue="Edit" value="edit">
                      <IconPencil aria-hidden="true" className="self-start text-accent-ink" />
                      <div className="flex flex-col gap-1">
                        <TypographySmall className="text-xs">Edit</TypographySmall>
                        <TypographyMuted className="text-xs">Refine prose and check continuity</TypographyMuted>
                      </div>
                    </PromptInputSelectItem>
                  </PromptInputSelectContent>
                </PromptInputSelect>
                <Separator className="mx-1 h-3" orientation="vertical" />
              </>
            ) : null}
            <Context
              maxTokens={contextWindow}
              modelId={tokenlensModelId}
              usage={displayUsage}
              usedTokens={usedTokens}
            >
              <ContextTrigger />
              <ContextContent>
                <ContextContentHeader />
                <ContextContentBody className="space-y-2">
                  <ContextInputUsage />
                  <ContextOutputUsage />
                </ContextContentBody>
                <ContextContentFooter>
                  {`Model: ${tokenlensModelId ?? "-"}`}
                </ContextContentFooter>
              </ContextContent>
            </Context>
          </PromptInputTools>
          <PromptInputSubmit
            disabled={
              runStatus === "idle" &&
              (!hasMeaningfulDraft || blocksTargetEditing)
            }
            onStop={() => stopAgentRun(sessionId)}
            status={status}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
