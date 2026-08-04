import { useState } from "react";
import { IconX } from "@tabler/icons-react";
import { AgentComposer } from "@/components/app/agent-console/agent-composer";
import { AgentConversation } from "@/components/app/agent-console/agent-conversation";
import { ReviewTray } from "@/components/app/agent-console/review-tray";
import { AiConsoleErrorBoundary } from "@/components/app/error-boundary";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  TypographyLarge,
  TypographyMuted,
} from "@/components/ui/typography";
import { retryAgentTurn } from "@/lib/ai/agent-controller";
import { navigateToContextSnapshot } from "@/lib/ai/agent-navigation";
import {
  PROJECT_AGENT_SESSION,
  type AgentPersistenceIssue,
  type AgentSessionId,
  type AgentTask,
} from "@/lib/ai/agent-types";
import {
  agentConsoleOwnershipStatus,
  useAgentSessionStore,
} from "@/stores/agent-console-store";
import {
  resetAgentConversation,
  retryAgentSessionPersistence,
} from "@/stores/agent-persistence";
import { useProjectStore } from "@/stores/project-store";
import {
  useSettingsDialogStore,
} from "@/stores/settings-dialog-store";
import { useViewStore } from "@/stores/view-store";

function AgentPersistenceBanner({
  issue,
  sessionId,
}: {
  issue: AgentPersistenceIssue;
  sessionId: AgentSessionId;
}) {
  const [actionError, setActionError] = useState<string | null>(null);
  const saveFailed = issue.kind === "save";

  const retry = (): void => {
    setActionError(null);
    void retryAgentSessionPersistence(issue.projectRoot, sessionId).catch(() => {
      setActionError(
        "AI conversation still could not be saved. Check storage access and retry.",
      );
    });
  };

  const reset = (): void => {
    setActionError(null);
    const reportResetFailure = (): void => {
      setActionError(
        "AI conversation could not be reset. Check storage access and try again.",
      );
    };
    try {
      resetAgentConversation(issue.projectRoot, sessionId).catch(reportResetFailure);
    } catch {
      reportResetFailure();
    }
  };

  return (
    <Alert
      className="shrink-0 rounded-none border-x-0 border-t-0"
      variant="destructive"
    >
      <AlertTitle>
        {saveFailed
          ? "AI conversation could not be saved."
          : "AI conversation could not be loaded."}
      </AlertTitle>
      <AlertDescription>
        {saveFailed
          ? "Your in-memory conversation is unchanged."
          : "The stored conversation remains untouched until you reset it."}
        {actionError === null ? null : (
          <TypographyMuted className="text-destructive" role="alert">
            {actionError}
          </TypographyMuted>
        )}
      </AlertDescription>
      <AlertAction>
        {saveFailed ? (
          <Button onClick={retry} size="sm" type="button" variant="outline">
            Retry
          </Button>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" type="button" variant="outline">
                Reset AI Conversation
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset AI conversation?</AlertDialogTitle>
                <AlertDialogDescription>
                  This clears the saved AI transcript, draft, attachments, and
                  pending proposal for this project. Manuscript and outline data
                  are unchanged.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={reset}
                  variant="destructive"
                >
                  Reset Conversation
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </AlertAction>
    </Alert>
  );
}

export function AgentConsole() {
  return (
    <AiConsoleErrorBoundary
      onClose={() => useViewStore.getState().setAiOpen(false)}
    >
      <AgentConsoleRoute />
    </AiConsoleErrorBoundary>
  );
}

function AgentConsoleRoute() {
  const project = useProjectStore((state) => state.project);
  const activeChapterId = useProjectStore((state) => state.activeChapterId);
  const activeChapter =
    project === null || activeChapterId === null
      ? undefined
      : project.chapters.find((candidate) => candidate.id === activeChapterId);
  const projectContextLabel =
    project === null
      ? "No project"
      : activeChapter === undefined
        ? project.name
        : `${project.name} / ${activeChapter.label}. ${activeChapter.title}`;
  const close = (): void => useViewStore.getState().setAiOpen(false);

  return (
    <AgentSection
      ariaLabel="AI Console"
      closeLabel="Close AI Console"
      contextLabel={projectContextLabel}
      emptyDescription="Add manuscript context or ask a project question."
      emptyTitle="Ask about this project"
      onClose={close}
      placeholder="Ask about your manuscript"
      sessionId={PROJECT_AGENT_SESSION}
      task={null}
      title="AI Console"
    />
  );
}

export interface AgentSectionProps {
  ariaLabel: string;
  closeLabel: string;
  contextLabel: string;
  emptyDescription: string;
  emptyTitle: string;
  onClose: () => void;
  placeholder: string;
  sessionId: AgentSessionId;
  task: AgentTask | null;
  title: string;
}

export function AgentSection(props: AgentSectionProps) {
  return (
    <AiConsoleErrorBoundary onClose={props.onClose}>
      <AgentSectionContent {...props} />
    </AiConsoleErrorBoundary>
  );
}

function AgentSectionContent({
  ariaLabel,
  closeLabel,
  contextLabel,
  emptyDescription,
  emptyTitle,
  onClose,
  placeholder,
  sessionId,
  task,
  title,
}: AgentSectionProps) {
  const messages = useAgentSessionStore(sessionId, (state) => state.messages);
  const summary = useAgentSessionStore(sessionId, (state) => state.summary);
  const pendingProposal = useAgentSessionStore(
    sessionId,
    (state) => state.pendingProposal,
  );
  const persistenceIssue = useAgentSessionStore(
    sessionId,
    (state) => state.persistenceIssue,
  );
  const project = useProjectStore((state) => state.project);
  const ownershipStatus = useAgentSessionStore(sessionId, (state) =>
    agentConsoleOwnershipStatus(state, project?.root ?? null),
  );
  const openAiSettings = (target: "key" | "model"): void => {
    useSettingsDialogStore.getState().openAiSettings(target);
  };

  return (
    <section
      aria-label={ariaLabel}
      className="flex h-full min-h-0 min-w-0 flex-col bg-background"
      data-agent-console
      data-agent-section
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <div className="min-w-0">
          <TypographyLarge>{title}</TypographyLarge>
          <TypographyMuted className="truncate">{contextLabel}</TypographyMuted>
        </div>
        <Button
          aria-label={closeLabel}
          onClick={onClose}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <IconX />
        </Button>
      </header>
      {persistenceIssue === null ? null : (
        <AgentPersistenceBanner issue={persistenceIssue} sessionId={sessionId} />
      )}
      {ownershipStatus === "ready" ? (
        <>
          <AgentConversation
            emptyDescription={emptyDescription}
            emptyTitle={emptyTitle}
            messages={messages}
            onNavigateSnapshot={navigateToContextSnapshot}
            onOpenSettings={openAiSettings}
            onRetry={(messageId) => retryAgentTurn(messageId, sessionId)}
            sessionId={sessionId}
            summary={summary}
          />
          {pendingProposal === null ? null : <ReviewTray sessionId={sessionId} />}
          <AgentComposer placeholder={placeholder} sessionId={sessionId} task={task} />
        </>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2">
          {project === null ? null : <Spinner />}
          <TypographyMuted>
            {project === null
              ? "Open a project to use AI Console."
              : "Loading AI conversation"}
          </TypographyMuted>
        </div>
      )}
    </section>
  );
}
