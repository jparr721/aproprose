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
import type { AgentPersistenceIssue, AgentTask } from "@/lib/ai/agent-types";
import {
  agentConsoleOwnershipStatus,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import {
  resetAgentConversation,
  retryAgentPersistence,
} from "@/stores/agent-persistence";
import { useProjectStore } from "@/stores/project-store";
import {
  useSettingsDialogStore,
} from "@/stores/settings-dialog-store";
import { useViewStore } from "@/stores/view-store";

function AgentPersistenceBanner({ issue }: { issue: AgentPersistenceIssue }) {
  const [actionError, setActionError] = useState<string | null>(null);
  const saveFailed = issue.kind === "save";

  const retry = (): void => {
    setActionError(null);
    void retryAgentPersistence().catch(() => {
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
      resetAgentConversation(issue.projectRoot).catch(reportResetFailure);
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
  const section = useViewStore((state) => state.agentSection);
  const outlineOpen = useViewStore((state) => state.outlineOpen);
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

  if (
    outlineOpen &&
    section.kind === "outline" &&
    project !== null &&
    section.projectRoot === project.root
  ) {
    const chapter = project.chapters.find(
      (candidate) => candidate.id === section.chapterId,
    );
    if (chapter === undefined) {
      throw new Error(`Outline chapter not found: ${section.chapterId}`);
    }
    return (
      <AgentSection
        ariaLabel="Outline Planner"
        closeLabel="Close Outline Planner"
        contextLabel={`${project.name} / ${chapter.label}. ${chapter.title}`}
        emptyDescription="Describe the story you want for this chapter. The agent will ask for clarification when needed, then stage separate plot-point ideas for individual review."
        emptyTitle="Plan this chapter"
        onClose={close}
        placeholder="Describe this chapter or request more plot points"
        task={{ kind: "outline-sculpt", chapterId: chapter.id }}
        title="Outline Planner"
      />
    );
  }

  return (
    <AgentSection
      ariaLabel="AI Console"
      closeLabel="Close AI Console"
      contextLabel={projectContextLabel}
      emptyDescription="Add manuscript context or ask a project question."
      emptyTitle="Ask about this project"
      onClose={close}
      placeholder="Ask about your manuscript"
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
  task,
  title,
}: AgentSectionProps) {
  const messages = useAgentConsoleStore((state) => state.messages);
  const summary = useAgentConsoleStore((state) => state.summary);
  const pendingProposal = useAgentConsoleStore(
    (state) => state.pendingProposal,
  );
  const persistenceIssue = useAgentConsoleStore(
    (state) => state.persistenceIssue,
  );
  const project = useProjectStore((state) => state.project);
  const ownershipStatus = useAgentConsoleStore((state) =>
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
        <AgentPersistenceBanner issue={persistenceIssue} />
      )}
      {ownershipStatus === "ready" ? (
        <>
          <AgentConversation
            emptyDescription={emptyDescription}
            emptyTitle={emptyTitle}
            messages={messages}
            onNavigateSnapshot={navigateToContextSnapshot}
            onOpenSettings={openAiSettings}
            onRetry={retryAgentTurn}
            summary={summary}
          />
          {pendingProposal === null ? null : <ReviewTray />}
          <AgentComposer placeholder={placeholder} task={task} />
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
