import type { ChatStatus, LanguageModelUsage } from "ai";
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
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { DraftContextAttachments } from "@/components/app/agent-console/context-attachments";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { TypographyMuted } from "@/components/ui/typography";
import {
  stopAgentRun,
  submitAgentDraft,
} from "@/lib/ai/agent-controller";
import { safeAgentErrorText } from "@/lib/ai/agent-error-copy";
import { agentFailureActionLabel } from "@/lib/ai/agent-failure";
import type { AgentSessionId, AgentTask } from "@/lib/ai/agent-types";
import { agentSessionKey, PROJECT_AGENT_SESSION } from "@/lib/ai/agent-types";
import { cn } from "@/lib/utils";
import {
  agentConsoleOwnershipStatus,
  agentSessionStore,
  useAgentSessionStore,
  useAgentRunCoordinatorStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import {
  useSettingsDialogStore,
} from "@/stores/settings-dialog-store";

export interface AgentComposerProps {
  task: AgentTask | null;
  placeholder: string;
  sessionId?: AgentSessionId;
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
  const activeSessionKey = useAgentRunCoordinatorStore(
    (state) => state.activeSessionKey,
  );
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
  const blocksTargetEditing =
    ownershipStatus !== "ready" ||
    (activeSessionKey !== null && activeSessionKey !== agentSessionKey(sessionId));

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
      aria-label="Agent composer"
      className="flex shrink-0 flex-col gap-2 border-t border-border bg-background p-3"
      role="region"
    >
      {sessionId.kind === "project" ? <ButtonGroup aria-label="Agent mode">
        <Button
          aria-pressed={mode === "writing"}
          disabled={blocksTargetEditing}
          onClick={() => setMode("writing")}
          type="button"
          variant={mode === "writing" ? "default" : "outline"}
        >
          Writing
        </Button>
        <Button
          aria-pressed={mode === "edit"}
          disabled={blocksTargetEditing}
          onClick={() => setMode("edit")}
          type="button"
          variant={mode === "edit" ? "default" : "outline"}
        >
          Edit
        </Button>
      </ButtonGroup> : null}
      {blocksTargetEditing ? (
        <TypographyMuted>AI conversation is loading.</TypographyMuted>
      ) : null}
      {runError === null ? null : (
        <div className="flex items-center justify-between gap-2">
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
            placeholder={placeholder}
            value={draftText}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
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
