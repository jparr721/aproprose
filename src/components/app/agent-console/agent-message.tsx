import { useState, type ReactNode } from "react";
import { isStaticToolUIPart } from "ai";
import { SentContextAttachments } from "@/components/app/agent-console/context-attachments";
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
  Message,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  ChainOfThought,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import { Task, TaskContent, TaskTrigger } from "@/components/ai-elements/task";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TypographyMuted } from "@/components/ui/typography";
import { Spinner } from "@/components/ui/spinner";
import {
  IconCheck,
  IconChevronDown,
  IconExclamationCircle,
} from "@tabler/icons-react";
import {
  flattenMessageFindings,
  type FlattenedMessageFinding,
} from "@/lib/ai/agent-context";
import { dispatchAgentIntent } from "@/lib/ai/agent-controller";
import { safeAgentErrorText } from "@/lib/ai/agent-error-copy";
import type {
  AgentErrorCode,
  AgentMessageMetadata,
  AgentUIMessage,
  ContextSnapshot,
  PersistedUsage,
} from "@/lib/ai/agent-types";
import {
  AgentConsoleOwnershipError,
  agentConsoleOwnershipStatus,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";

export interface AgentMessageProps {
  message: AgentUIMessage;
  onNavigateSnapshot: (snapshot: ContextSnapshot) => Promise<boolean>;
  onRetry: (userMessageId: string) => Promise<void>;
  onOpenSettings: () => void;
}

type AgentMessagePart = AgentUIMessage["parts"][number];
type StaticAgentToolPart = Extract<AgentMessagePart, { type: `tool-${string}` }>;

function toolTitle(type: string): string {
  switch (type) {
    case "tool-read_chapter":
      return "Read chapter";
    case "tool-read_outline":
      return "Read outline";
    case "tool-read_lore":
      return "Read lore";
    case "tool-run_critique":
      return "Run critique";
    case "tool-run_continuity":
      return "Check continuity";
    case "tool-read_conversation_context":
      return "Read conversation context";
    case "tool-read_pending_proposal":
      return "Read proposal";
    case "tool-stage_manuscript_proposal":
      return "Stage manuscript proposal";
    case "tool-stage_outline_proposal":
      return "Stage outline proposal";
    default:
      throw new Error(`Unknown agent tool part: ${type}`);
  }
}

function isUnfinishedTool(part: StaticAgentToolPart): boolean {
  return (
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    part.state === "approval-requested" ||
    part.state === "approval-responded"
  );
}

function toolStatus(
  part: StaticAgentToolPart,
  messageState: AgentMessageMetadata["state"],
): { label: string; status: "complete" | "active" | "pending" } {
  if (messageState === "stopped" && isUnfinishedTool(part)) {
    return { label: "Stopped", status: "complete" };
  }
  switch (part.state) {
    case "input-streaming":
      return { label: "Pending", status: "pending" };
    case "input-available":
      return { label: "Running", status: "active" };
    case "approval-requested":
      return { label: "Awaiting approval", status: "active" };
    case "approval-responded":
      return { label: "Approval received", status: "active" };
    case "output-available":
      return { label: "Completed", status: "complete" };
    case "output-denied":
      return { label: "Denied", status: "complete" };
    case "output-error":
      return { label: "Error", status: "complete" };
  }
}

function InlineMessageError({ message }: { message: string }) {
  return (
    <TypographyMuted className="text-destructive" role="alert">
      {message}
    </TypographyMuted>
  );
}

function unsupportedPart(part: AgentMessagePart, key: string): ReactNode {
  const error = new Error(`Unsupported agent message part: ${part.type}`);
  if (import.meta.env.DEV) throw error;
  return <InlineMessageError key={key} message={error.message} />;
}

function ToolActivity({
  parts,
  messageState,
}: {
  parts: StaticAgentToolPart[];
  messageState: AgentMessageMetadata["state"];
}) {
  const statuses = parts.map((part) => toolStatus(part, messageState));
  const isActive = statuses.some((status) => status.status === "active");
  const needsAttention = statuses.some(
    (status) => status.label === "Error" || status.label === "Denied",
  );
  const title = isActive
    ? "Using tools"
    : needsAttention
      ? "Tool activity needs attention"
      : "Tool activity";
  const HeaderIcon = needsAttention ? IconExclamationCircle : IconCheck;
  return (
    <Task defaultOpen={isActive || needsAttention}>
      <TaskTrigger title={title}>
        <Button
          className="w-full justify-start text-muted-foreground"
          size="sm"
          type="button"
          variant="ghost"
        >
          {isActive ? <Spinner /> : <HeaderIcon className="size-4" />}
          <span className="flex-1 text-left">{title}</span>
          <IconChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
        </Button>
      </TaskTrigger>
      <TaskContent>
        <ChainOfThought>
          {parts.map((part, index) => {
            const status = statuses[index];
            return (
              <ChainOfThoughtStep
                description={status.label}
                key={part.toolCallId}
                label={toolTitle(part.type)}
                status={status.status}
              />
            );
          })}
        </ChainOfThought>
      </TaskContent>
    </Task>
  );
}

function Findings({
  entries,
  disabled,
}: {
  entries: FlattenedMessageFinding[];
  disabled: boolean;
}) {
  return entries.map((entry) => {
    const finding = entry.finding;
    return (
      <Card
        aria-label={`${finding.tag} finding`}
        key={entry.id}
        role="group"
        size="sm"
      >
        <CardHeader>
          <CardTitle>{finding.tag}</CardTitle>
          <CardAction>
            <Button
              disabled={disabled}
              onClick={() => {
                void dispatchAgentIntent({
                  kind: "add-context",
                  refs: [
                    {
                      kind: "finding",
                      chapterId: entry.chapterId,
                      findingId: entry.id,
                    },
                  ],
                });
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Add to Chat
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <TypographyMuted>{finding.text}</TypographyMuted>
        </CardContent>
      </Card>
    );
  });
}

function renderPart(
  part: AgentMessagePart,
  index: number,
  message: AgentUIMessage,
  messageMetadata: AgentMessageMetadata,
  findings: FlattenedMessageFinding[],
  authorMutationsDisabled: boolean,
  onNavigateSnapshot: (snapshot: ContextSnapshot) => Promise<boolean>,
): ReactNode {
  const key = `${message.id}:part:${index}`;
  if (isStaticToolUIPart(part)) {
    return null;
  }
  switch (part.type) {
    case "text":
      return (
        <MessageResponse
          isAnimating={messageMetadata.state === "streaming"}
          key={key}
        >
          {part.text}
        </MessageResponse>
      );
    case "data-context":
      return (
        <SentContextAttachments
          key={key}
          snapshots={part.data.snapshots}
          onNavigate={onNavigateSnapshot}
        />
      );
    case "data-findings":
      return (
        <Findings
          disabled={authorMutationsDisabled}
          entries={findings.filter((entry) => entry.partIndex === index)}
          key={key}
        />
      );
    case "data-proposal-event":
      return <TypographyMuted key={key}>{part.data.text}</TypographyMuted>;
    case "data-compaction":
      return <TypographyMuted key={key}>Older context compacted</TypographyMuted>;
    case "reasoning":
    case "step-start":
      return null;
    case "dynamic-tool":
    case "source-url":
    case "source-document":
    case "file":
      return unsupportedPart(part, key);
  }
}

function MessageUsage({ usage }: { usage: PersistedUsage }) {
  const displayUsage = {
    ...usage.raw,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
  return (
    <Context
      maxTokens={usage.contextWindow}
      modelId={usage.modelId}
      usage={displayUsage}
      usedTokens={usage.totalTokens}
    >
      <ContextTrigger />
      <ContextContent>
        <ContextContentHeader />
        <ContextContentBody className="space-y-2">
          <ContextInputUsage />
          <ContextOutputUsage />
        </ContextContentBody>
        <ContextContentFooter>{`Model: ${usage.modelId}`}</ContextContentFooter>
      </ContextContent>
    </Context>
  );
}

function retryUserMessageId(message: AgentUIMessage): string {
  const messageMetadata = message.metadata;
  if (messageMetadata === undefined) {
    throw new Error(`Agent message metadata is missing: ${message.id}`);
  }
  if (messageMetadata.retryOf !== null) return messageMetadata.retryOf;
  const original = useAgentConsoleStore
    .getState()
    .messages.find((candidate) => {
      if (candidate.role !== "user" || candidate.metadata === undefined) {
        return false;
      }
      return candidate.metadata.runId === messageMetadata.runId;
    });
  if (original === undefined) {
    throw new Error(`Agent user turn not found for run: ${messageMetadata.runId}`);
  }
  return original.id;
}

export function AgentMessage({
  message,
  onNavigateSnapshot,
  onRetry,
  onOpenSettings,
}: AgentMessageProps) {
  const projectRoot = useProjectStore(
    (state) => state.project?.root ?? null,
  );
  const authorMutationsDisabled = useAgentConsoleStore(
    (state) => agentConsoleOwnershipStatus(state, projectRoot) !== "ready",
  );
  const [retryErrorCode, setRetryErrorCode] =
    useState<AgentErrorCode | null>(null);
  const messageMetadata = message.metadata;
  if (messageMetadata === undefined) {
    return <InlineMessageError message={`Agent message metadata is missing: ${message.id}`} />;
  }
  const findings = flattenMessageFindings(message);
  const toolParts = message.parts.filter((part): part is StaticAgentToolPart =>
    isStaticToolUIPart(part),
  );
  const firstToolIndex = message.parts.findIndex((part) =>
    isStaticToolUIPart(part),
  );
  const error =
    messageMetadata.state === "error"
      ? safeAgentErrorText(messageMetadata.errorCode)
      : null;
  const retry = (): void => {
    setRetryErrorCode(null);
    onRetry(retryUserMessageId(message)).catch((retryError: unknown) => {
      setRetryErrorCode(
        retryError instanceof AgentConsoleOwnershipError
          ? retryError.agentErrorCode
          : "unknown",
      );
    });
  };
  return (
    <Message from={message.role}>
      <MessageContent>
        {message.parts.map((part, index) =>
          index === firstToolIndex ? (
            <ToolActivity
              key={`${message.id}:tools`}
              messageState={messageMetadata.state}
              parts={toolParts}
            />
          ) : (
            renderPart(
              part,
              index,
              message,
              messageMetadata,
              findings,
              authorMutationsDisabled,
              onNavigateSnapshot,
            )
          ),
        )}
        {messageMetadata.state === "stopped" ? (
          <TypographyMuted>Stopped</TypographyMuted>
        ) : null}
        {error === null ? null : <InlineMessageError message={error} />}
        {retryErrorCode === null ? null : (
          <InlineMessageError message={safeAgentErrorText(retryErrorCode)} />
        )}
      </MessageContent>
      {error === null && messageMetadata.usage === null ? null : (
        <MessageActions>
          {messageMetadata.usage === null ? null : (
            <MessageUsage usage={messageMetadata.usage} />
          )}
          {error === null ? null : (
            <Button
              disabled={authorMutationsDisabled}
              onClick={retry}
              size="sm"
              type="button"
              variant="outline"
            >
              Retry
            </Button>
          )}
          {error !== null && messageMetadata.errorCode === "configuration" ? (
            <Button
              onClick={onOpenSettings}
              size="sm"
              type="button"
              variant="outline"
            >
              Open AI Settings
            </Button>
          ) : null}
        </MessageActions>
      )}
    </Message>
  );
}
