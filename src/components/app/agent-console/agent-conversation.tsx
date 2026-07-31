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
import { TypographyMuted } from "@/components/ui/typography";
import type {
  AgentUIMessage,
  ConversationSummary,
} from "@/lib/ai/agent-types";

export interface AgentConversationProps
  extends Pick<
    AgentMessageProps,
    "onNavigateSnapshot" | "onOpenSettings" | "onRetry"
  > {
  messages: AgentUIMessage[];
  summary: ConversationSummary | null;
}

export function AgentConversation({
  messages,
  summary,
  onNavigateSnapshot,
  onRetry,
  onOpenSettings,
}: AgentConversationProps) {
  return (
    <Conversation className="min-h-0">
      <ConversationContent>
        {messages.length === 0 ? (
          <ConversationEmptyState
            description="Add manuscript context or ask a project question."
            title="Ask about this project"
          />
        ) : (
          messages.flatMap((message) => [
            <AgentMessage
              key={message.id}
              message={message}
              onNavigateSnapshot={onNavigateSnapshot}
              onOpenSettings={onOpenSettings}
              onRetry={onRetry}
            />,
            summary?.throughMessageId === message.id ? (
              <TypographyMuted key={`compaction-${message.id}`}>
                Older context compacted
              </TypographyMuted>
            ) : null,
          ])
        )}
      </ConversationContent>
      <ConversationScrollButton aria-label="Scroll to latest message" />
    </Conversation>
  );
}
