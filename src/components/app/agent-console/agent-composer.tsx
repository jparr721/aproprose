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
import type { AgentTask } from "@/lib/ai/agent-types";
import { cn } from "@/lib/utils";
import { useAgentConsoleStore } from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import {
  SETTINGS_TABS,
  useSettingsDialogStore,
} from "@/stores/settings-dialog-store";

export function AgentComposer() {
  const mode = useAgentConsoleStore((state) => state.mode);
  const setMode = useAgentConsoleStore((state) => state.setMode);
  const draftText = useAgentConsoleStore((state) => state.draftText);
  const setDraftText = useAgentConsoleStore((state) => state.setDraftText);
  const draftContextRefs = useAgentConsoleStore(
    (state) => state.draftContextRefs,
  );
  const draftContextSources = useAgentConsoleStore(
    (state) => state.draftContextSources,
  );
  const removeDraftContextRef = useAgentConsoleStore(
    (state) => state.removeDraftContextRef,
  );
  const runStatus = useAgentConsoleStore((state) => state.runStatus);
  const runError = useAgentConsoleStore((state) => state.runError);
  const lastUsage = useAgentConsoleStore((state) => state.lastUsage);
  const hydratedProjectRoot = useAgentConsoleStore(
    (state) => state.hydratedProjectRoot,
  );
  const persistenceTransition = useAgentConsoleStore(
    (state) => state.persistenceTransition,
  );

  const status: ChatStatus =
    runStatus === "submitted"
      ? "submitted"
      : runStatus === "streaming"
        ? "streaming"
        : runError === null
          ? "ready"
          : "error";
  const displayUsage: LanguageModelUsage | null =
    lastUsage === null
      ? null
      : {
          ...lastUsage.raw,
          inputTokens: lastUsage.inputTokens,
          outputTokens: lastUsage.outputTokens,
          totalTokens: lastUsage.totalTokens,
        };
  const tokenlensModelId =
    lastUsage === null
      ? null
      : `openai:${lastUsage.modelId.replace(/^(openai:)+/, "")}`;
  const hasMeaningfulDraft =
    draftText.trim().length > 0 || draftContextRefs.length > 0;
  const blocksTargetEditing =
    persistenceTransition !== null &&
    hydratedProjectRoot !== persistenceTransition.projectRoot;

  const handleSubmit = async (): Promise<void> => {
    if (
      runStatus !== "idle" ||
      !hasMeaningfulDraft ||
      persistenceTransition !== null
    ) {
      return;
    }
    const consoleState = useAgentConsoleStore.getState();
    if (
      consoleState.activeRun !== null ||
      consoleState.runStatus !== "idle"
    ) {
      return;
    }
    if (
      consoleState.draftText.trim().length === 0 &&
      consoleState.draftContextRefs.length === 0
    ) {
      return;
    }
    const task: AgentTask =
      consoleState.pendingProposal === null
        ? {
            kind: "conversation",
            targetChapterId: useProjectStore.getState().activeChapterId,
          }
        : {
            kind: "proposal-follow-up",
            proposalId: consoleState.pendingProposal.id,
          };
    await submitAgentDraft(task);
  };

  return (
    <div
      aria-label="Agent composer"
      className="flex shrink-0 flex-col gap-2 border-t border-border bg-background p-3"
      role="region"
    >
      <ButtonGroup aria-label="Agent mode">
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
      </ButtonGroup>
      {blocksTargetEditing ? (
        <TypographyMuted>AI conversation is loading.</TypographyMuted>
      ) : null}
      {runError === null ? null : (
        <div className="flex items-center justify-between gap-2">
          <TypographyMuted className="text-destructive" role="alert">
            {safeAgentErrorText(runError.code)}
          </TypographyMuted>
          {runError.code === "configuration" ? (
            <Button
              onClick={() =>
                useSettingsDialogStore
                  .getState()
                  .openWithTab(SETTINGS_TABS.AI)
              }
              size="sm"
              type="button"
              variant="outline"
            >
              Open AI Settings
            </Button>
          ) : null}
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
        <PromptInputHeader>
          <DraftContextAttachments
            onRemove={removeDraftContextRef}
            refs={draftContextRefs}
            sources={draftContextSources}
          />
        </PromptInputHeader>
        <PromptInputBody>
          <PromptInputTextarea
            aria-label="Message AI Console"
            disabled={blocksTargetEditing}
            onChange={(event) => setDraftText(event.currentTarget.value)}
            placeholder="Ask about your manuscript"
            value={draftText}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            {lastUsage === null ||
            displayUsage === null ||
            tokenlensModelId === null ? null : (
              <Context
                maxTokens={lastUsage.contextWindow}
                modelId={tokenlensModelId}
                usage={displayUsage}
                usedTokens={lastUsage.totalTokens}
              >
                <ContextTrigger />
                <ContextContent>
                  <ContextContentHeader />
                  <ContextContentBody className="space-y-2">
                    <ContextInputUsage />
                    <ContextOutputUsage />
                  </ContextContentBody>
                  <ContextContentFooter>
                    {`Model: ${tokenlensModelId}`}
                  </ContextContentFooter>
                </ContextContent>
              </Context>
            )}
          </PromptInputTools>
          <PromptInputSubmit
            disabled={
              runStatus === "idle" &&
              (!hasMeaningfulDraft || persistenceTransition !== null)
            }
            onStop={stopAgentRun}
            status={status}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
