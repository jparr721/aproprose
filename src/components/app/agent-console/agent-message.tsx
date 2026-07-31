import type { ReactNode } from "react";
import { isStaticToolUIPart } from "ai";
import { SentContextAttachments } from "@/components/app/agent-console/context-attachments";
import {
  Message,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Tool,
  ToolContent,
  ToolHeader,
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  TypographyMuted,
  TypographySmall,
} from "@/components/ui/typography";
import { dispatchAgentIntent } from "@/lib/ai/agent-controller";
import type {
  AgentDataParts,
  AgentMessageMetadata,
  AgentUIMessage,
  ContextSnapshot,
} from "@/lib/ai/agent-types";
import { useAgentConsoleStore } from "@/stores/agent-console-store";

export interface AgentMessageProps {
  message: AgentUIMessage;
  onNavigateSnapshot: (snapshot: ContextSnapshot) => Promise<boolean>;
  onRetry: (userMessageId: string) => Promise<void>;
  onOpenSettings: () => void;
}

interface SafeToolView {
  title: string;
  target: string;
  detail: string;
  itemCount: number;
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

function safeTargetValue(value: unknown, unavailableLabel: string): string {
  if (typeof value !== "string") return unavailableLabel;
  const isAbsolutePath =
    value.startsWith("/") ||
    value.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(value);
  return isAbsolutePath ? unavailableLabel : value;
}

function targetId(part: StaticAgentToolPart): string {
  switch (part.type) {
    case "tool-read_chapter":
    case "tool-run_critique":
    case "tool-run_continuity":
      return safeTargetValue(part.input?.chapterId, "Chapter");
    case "tool-read_outline":
      return safeTargetValue(part.input?.chapterId, "Outline");
    case "tool-read_lore":
      return "Lore";
    case "tool-read_conversation_context": {
      if (part.input === undefined || !Array.isArray(part.input.messageIds)) {
        return "Conversation";
      }
      const messageIds = part.input.messageIds.filter(
        (messageId): messageId is string => typeof messageId === "string",
      );
      if (messageIds.length === 0) return "Conversation";
      const safeMessageIds = messageIds.map((messageId) =>
        safeTargetValue(messageId, "Conversation"),
      );
      return safeMessageIds.includes("Conversation")
        ? "Conversation"
        : safeMessageIds.join(", ");
    }
    case "tool-read_pending_proposal":
      return safeTargetValue(part.input?.proposalId, "Proposal");
    case "tool-stage_manuscript_proposal":
      return "Manuscript proposal";
    case "tool-stage_outline_proposal":
      return "Outline proposal";
  }
}

function safeToolView(part: AgentMessagePart): SafeToolView | null {
  if (!isStaticToolUIPart(part)) return null;
  const title = toolTitle(part.type);
  if (part.state === "output-available") {
    const summary = part.output.summary;
    return {
      title: summary.label,
      target: safeTargetValue(summary.target, title),
      detail: summary.detail,
      itemCount: summary.itemCount,
    };
  }
  if (part.state === "output-error") {
    return {
      title,
      target: targetId(part),
      detail: part.errorText,
      itemCount: 0,
    };
  }
  if (part.state === "output-denied") {
    return {
      title,
      target: targetId(part),
      detail: "Denied",
      itemCount: 0,
    };
  }
  const detail =
    part.state === "input-streaming"
      ? "Waiting for input"
      : part.state === "input-available"
        ? "Working"
        : part.state === "approval-requested"
          ? "Awaiting approval"
          : "Approval received";
  return {
    title,
    target: targetId(part),
    detail,
    itemCount: 0,
  };
}

function isUnfinishedTool(part: StaticAgentToolPart): boolean {
  return (
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    part.state === "approval-requested" ||
    part.state === "approval-responded"
  );
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

function ToolPart({
  part,
  messageState,
}: {
  part: StaticAgentToolPart;
  messageState: AgentMessageMetadata["state"];
}) {
  try {
    const view = safeToolView(part);
    if (view === null) {
      throw new Error(`Agent tool projection failed: ${part.type}`);
    }
    const title =
      messageState === "stopped" && isUnfinishedTool(part)
        ? `${view.title} - Stopped`
        : view.title;
    return (
      <Tool>
        <ToolHeader state={part.state} title={title} type={part.type} />
        <ToolContent>
          <TypographyMuted>{view.target}</TypographyMuted>
          <TypographySmall>{view.detail}</TypographySmall>
        </ToolContent>
      </Tool>
    );
  } catch (error) {
    if (import.meta.env.DEV) throw error;
    const message =
      error instanceof Error ? error.message : `Agent tool projection failed: ${part.type}`;
    return <InlineMessageError message={message} />;
  }
}

function Findings({
  data,
  messageId,
}: {
  data: AgentDataParts["findings"];
  messageId: string;
}) {
  return data.items.map((finding, index) => {
    const findingId = `${messageId}:${index}`;
    return (
      <Card
        aria-label={`${finding.tag} finding`}
        key={findingId}
        role="group"
        size="sm"
      >
        <CardHeader>
          <CardTitle>{finding.tag}</CardTitle>
          <CardAction>
            <Button
              onClick={() => {
                void dispatchAgentIntent({
                  kind: "add-context",
                  refs: [
                    {
                      kind: "finding",
                      chapterId: data.chapterId,
                      findingId,
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
  onNavigateSnapshot: (snapshot: ContextSnapshot) => Promise<boolean>,
): ReactNode {
  const key = `${message.id}:part:${index}`;
  if (isStaticToolUIPart(part)) {
    return (
      <ToolPart
        key={key}
        messageState={messageMetadata.state}
        part={part}
      />
    );
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
      return <Findings data={part.data} key={key} messageId={message.id} />;
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
  const messageMetadata = message.metadata;
  if (messageMetadata === undefined) {
    return <InlineMessageError message={`Agent message metadata is missing: ${message.id}`} />;
  }
  const error =
    messageMetadata.state === "error" ? messageMetadata.error : null;
  return (
    <Message from={message.role}>
      <MessageContent>
        {message.parts.map((part, index) =>
          renderPart(
            part,
            index,
            message,
            messageMetadata,
            onNavigateSnapshot,
          ),
        )}
        {messageMetadata.state === "stopped" ? (
          <TypographyMuted>Stopped</TypographyMuted>
        ) : null}
        {error === null ? null : <InlineMessageError message={error} />}
      </MessageContent>
      {error === null ? null : (
        <MessageActions>
          <Button
            onClick={() => void onRetry(retryUserMessageId(message))}
            size="sm"
            type="button"
            variant="outline"
          >
            Retry
          </Button>
          {messageMetadata.errorCode === "configuration" ? (
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
