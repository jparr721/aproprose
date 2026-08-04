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
  emptyTitle: string;
  emptyDescription: string;
}

export function AgentConversation({
  messages,
  summary,
  onNavigateSnapshot,
  onRetry,
  onOpenSettings,
  emptyTitle,
  emptyDescription,
}: AgentConversationProps) {
  return (
    <Conversation className="min-h-0">
      <ConversationContent scrollClassName="overflow-y-auto">
        {messages.length === 0 ? (
          <ConversationEmptyState
            description={emptyDescription}
            title={emptyTitle}
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
