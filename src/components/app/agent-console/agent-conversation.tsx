import { useState } from "react";
import {
  AgentMessage,
  type AgentMessageProps,
} from "@/components/app/agent-console/agent-message";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Button } from "@/components/ui/button";
import type {
  AgentSessionId,
} from "@/lib/ai/agent-types";
import { PROJECT_AGENT_SESSION } from "@/lib/ai/agent-types";

const RECENT_MESSAGE_COUNT = 8;

export interface AgentConversationProps
  extends Pick<AgentMessageProps, "onOpenSettings" | "onRetry"> {
  messages: AgentMessageProps["message"][];
  emptyTitle: string;
  emptyDescription: string;
  sessionId?: AgentSessionId;
}

export function AgentConversation({
  messages,
  onRetry,
  onOpenSettings,
  emptyTitle,
  emptyDescription,
  sessionId: requestedSessionId,
}: AgentConversationProps) {
  const sessionId = requestedSessionId ?? PROJECT_AGENT_SESSION;
  const [visibleCount, setVisibleCount] = useState(RECENT_MESSAGE_COUNT);
  const visibleMessages = messages.slice(-visibleCount);
  const hiddenMessageCount = messages.length - visibleMessages.length;
  return (
    <Conversation className="min-h-0">
      <ConversationContent scrollClassName="overflow-y-auto">
        {messages.length === 0 ? (
          <ConversationEmptyState
            description={emptyDescription}
            title={emptyTitle}
          />
        ) : (
          <>
            {hiddenMessageCount > 0 ? (
              <Button
                onClick={() =>
                  setVisibleCount((count) =>
                    Math.min(messages.length, count + RECENT_MESSAGE_COUNT),
                  )
                }
                size="sm"
                type="button"
                variant="ghost"
              >
                Show {hiddenMessageCount} earlier messages
              </Button>
            ) : null}
            {visibleMessages.map((message) => (
              <AgentMessage
                key={message.id}
                message={message}
                onOpenSettings={onOpenSettings}
                onRetry={onRetry}
                sessionId={sessionId}
              />
            ))}
          </>
        )}
      </ConversationContent>
      <ConversationScrollButton aria-label="Scroll to latest message" />
    </Conversation>
  );
}
