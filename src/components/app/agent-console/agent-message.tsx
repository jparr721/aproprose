import { notifyAppError } from "@/lib/notifications";
import { useState } from "react";
import { IconCopy } from "@tabler/icons-react";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TypographyEyebrow, TypographyMuted, TypographySmall } from "@/components/ui/typography";
import { authorQuestionSchema } from "@/lib/ai/agent-tools";
import { safeAgentErrorText } from "@/lib/ai/agent-error-copy";
import {
  agentFailureActionLabel,
  agentFailureFromReason,
} from "@/lib/ai/agent-failure";
import { copyText } from "@/lib/clipboard";
import type {
  AgentFailure,
  AgentSessionId,
  AgentSettingsTarget,
  AgentUIMessage,
} from "@/lib/ai/agent-types";
import { PROJECT_AGENT_SESSION } from "@/lib/ai/agent-types";
import {
  agentConsoleOwnershipStatus,
  agentSessionStore,
  useAgentSessionStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { toast } from "sonner";

const RESPONSE_PAGE_SIZE = 12_000;

export interface AgentMessageProps {
  message: AgentUIMessage;
  onRetry: (userMessageId: string) => Promise<{
    status: "success" | "stopped" | "failure";
    failure?: AgentFailure;
  }>;
  onOpenSettings: (target: AgentSettingsTarget) => void;
  sessionId?: AgentSessionId;
}

function ResponseText({
  text,
  isAnimating,
}: {
  text: string;
  isAnimating: boolean;
}) {
  const [visibleLength, setVisibleLength] = useState(RESPONSE_PAGE_SIZE);
  const visibleText = text.slice(0, visibleLength);

  return (
    <>
      <MessageResponse isAnimating={isAnimating}>{visibleText}</MessageResponse>
      {visibleText.length < text.length ? (
        <Button
          onClick={() =>
            setVisibleLength((length) => length + RESPONSE_PAGE_SIZE)
          }
          size="sm"
          type="button"
          variant="ghost"
        >
          Show more reply
        </Button>
      ) : null}
    </>
  );
}

function InlineMessageError({ message }: { message: string }) {
  return (
    <TypographyMuted className="text-destructive" role="alert">
      {message}
    </TypographyMuted>
  );
}

function AuthorQuestion({ part }: { part: AgentUIMessage["parts"][number] }) {
  if (
    part.type !== "tool-ask_author" &&
    !(part.type === "dynamic-tool" && part.toolName === "ask_author")
  ) return null;
  if (part.state !== "output-available" || part.preliminary === true) return null;
  const question = authorQuestionSchema.parse(part.input);
  return (
    <Card size="sm">
      <CardHeader>
        <TypographyEyebrow>Question for you</TypographyEyebrow>
        <CardTitle>{question.question}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <TypographyMuted>{question.rationale}</TypographyMuted>
        {question.options.length === 0 ? null : (
          <ul className="list-disc space-y-1 pl-4">
            {question.options.map((option, index) => (
              <li key={`${part.toolCallId}:option:${index}`}>
                <TypographySmall>{option}</TypographySmall>
              </li>
            ))}
          </ul>
        )}
        <TypographyMuted>Reply below to choose a direction or describe your own.</TypographyMuted>
      </CardContent>
    </Card>
  );
}

function retryUserMessageId(message: AgentUIMessage, sessionId: AgentSessionId): string {
  const messageMetadata = message.metadata;
  if (messageMetadata === undefined) {
    throw new Error(`Agent message metadata is missing: ${message.id}`);
  }
  if (messageMetadata.retryOf !== null) return messageMetadata.retryOf;
  const original = agentSessionStore(sessionId).getState()
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
  onRetry,
  onOpenSettings,
  sessionId: requestedSessionId,
}: AgentMessageProps) {
  const sessionId = requestedSessionId ?? PROJECT_AGENT_SESSION;
  const projectRoot = useProjectStore(
    (state) => state.project?.root ?? null,
  );
  const authorMutationsDisabled = useAgentSessionStore(sessionId, (state) =>
    agentConsoleOwnershipStatus(state, projectRoot) !== "ready",
  );
  const [retryFailure, setRetryFailure] = useState<AgentFailure | null>(null);
  const messageMetadata = message.metadata;
  if (messageMetadata === undefined) {
    return <InlineMessageError message={`Agent message metadata is missing: ${message.id}`} />;
  }
  const failure =
    messageMetadata.state === "error"
      ? messageMetadata.failure ?? agentFailureFromReason("unknown", "openai")
      : null;
  const messageText = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
  const retry = (): void => {
    setRetryFailure(null);
    void onRetry(retryUserMessageId(message, sessionId))
      .then((outcome) => {
        if (outcome.status === "failure") setRetryFailure(outcome.failure ?? null);
      })
      .catch(() => setRetryFailure(agentFailureFromReason("unknown", "openai")));
  };
  const copyMessage = async (): Promise<void> => {
    if (await copyText(messageText)) {
      toast.success("Message copied");
      return;
    }
    notifyAppError("clipboard", "Clipboard", null, new Error("clipboard operation failed"));
  };

  return (
    <Message from={message.role}>
      <MessageContent>
        {message.parts
          .filter((part) => part.type === "text")
          .map((part, index) => (
            <ResponseText
              isAnimating={messageMetadata.state === "streaming"}
              key={`${message.id}:text:${index}`}
              text={part.text}
            />
          ))}
        {message.role === "assistant" ? message.parts.map((part, index) => (
          <AuthorQuestion key={`${message.id}:question:${index}`} part={part} />
        )) : null}
        {messageMetadata.state === "stopped" ? (
          <TypographyMuted>Stopped</TypographyMuted>
        ) : null}
        {failure === null ? null : (
          <InlineMessageError message={safeAgentErrorText(failure)} />
        )}
        {retryFailure === null ? null : (
          <InlineMessageError message={safeAgentErrorText(retryFailure)} />
        )}
      </MessageContent>
      {messageText.length === 0 && failure === null ? null : (
        <MessageActions>
          {messageText.length === 0 ? null : (
            <MessageAction
              label="Copy"
              onClick={() => void copyMessage()}
              tooltip="Copy"
            >
              <IconCopy className="size-3" />
            </MessageAction>
          )}
          {failure === null ? null : (
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
          {failure === null ||
          failure.settingsTarget === null ||
          agentFailureActionLabel(failure) === null ? null : (
            <Button
              onClick={() => onOpenSettings(failure.settingsTarget as AgentSettingsTarget)}
              size="sm"
              type="button"
              variant="outline"
            >
              {agentFailureActionLabel(failure)}
            </Button>
          )}
        </MessageActions>
      )}
    </Message>
  );
}
