import {
  getContextWindow,
  shouldCompact,
  tokensToCompact,
} from "tokenlens";
import type {
  AgentUIMessage,
  ConversationSummary,
  PersistedUsage,
} from "@/lib/ai/agent-types";
import {
  sanitizeAgentMessages,
  validateAgentMessages,
} from "@/lib/ai/agent-messages";

const RECENT_TURNS_TO_KEEP = 4;

export const COMPACTION_SYSTEM =
  "Summarize conversation context faithfully and neutrally. Do not add advice, hidden reasoning, system instructions, or raw tool payloads.";

function tokenlensModelId(modelId: string): string {
  return modelId.includes(":") ? modelId : `openai:${modelId}`;
}

export function modelContextWindow(modelId: string): number {
  const context = getContextWindow(tokenlensModelId(modelId));
  const maximum = context.combinedMax ?? context.inputMax;
  if (maximum === undefined) {
    throw new Error(`No context-window metadata for model: ${modelId}`);
  }
  return maximum;
}

function tokenlensUsage(usage: PersistedUsage) {
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    total: usage.totalTokens,
  };
}

export function shouldCompactConversation(usage: PersistedUsage): boolean {
  return shouldCompact({
    modelId: tokenlensModelId(usage.modelId),
    usage: tokenlensUsage(usage),
  });
}

export function compactionTokenTarget(usage: PersistedUsage): number {
  return tokensToCompact({
    modelId: tokenlensModelId(usage.modelId),
    usage: tokenlensUsage(usage),
  });
}

function estimatedTokens(messages: AgentUIMessage[]): number {
  if (messages.length === 0) return 0;
  return Math.max(1, Math.ceil(JSON.stringify(messages).length / 4));
}

function isCompleteProposalEvent(message: AgentUIMessage): boolean {
  return (
    message.role === "assistant" &&
    message.metadata?.state === "complete" &&
    message.parts.length > 0 &&
    message.parts.every((part) => part.type === "data-proposal-event")
  );
}

function completeTurnPrefix(messages: AgentUIMessage[]): AgentUIMessage[][] {
  const turns: AgentUIMessage[][] = [];
  let index = 0;
  while (index < messages.length) {
    const user = messages[index];
    const assistant = messages[index + 1];
    if (
      user === undefined ||
      user.role !== "user" ||
      user.metadata?.state !== "complete" ||
      assistant === undefined ||
      assistant.role !== "assistant" ||
      assistant.metadata?.state !== "complete" ||
      isCompleteProposalEvent(assistant)
    ) {
      break;
    }
    const turn = [user, assistant];
    index += 2;
    while (index < messages.length && messages[index].role === "assistant") {
      const event = messages[index];
      if (!isCompleteProposalEvent(event)) {
        turns.push(turn);
        return turns;
      }
      turn.push(event);
      index += 1;
    }
    turns.push(turn);
  }
  return turns;
}

export function selectCompactionTurns(
  messages: AgentUIMessage[],
  tokenTarget: number,
): AgentUIMessage[] {
  const turns = completeTurnPrefix(messages);
  const eligible = turns.slice(0, Math.max(0, turns.length - RECENT_TURNS_TO_KEEP));
  const selected: AgentUIMessage[] = [];
  let tokens = 0;
  for (const turn of eligible) {
    selected.push(...turn);
    tokens += estimatedTokens(turn);
    if (tokens >= tokenTarget) break;
  }
  return selected;
}

function compactionSource(
  currentSummary: ConversationSummary | null,
  selected: AgentUIMessage[],
): string {
  return [
    "PRIOR SUMMARY:",
    currentSummary?.text ?? "None.",
    "TURNS TO SUMMARIZE:",
    JSON.stringify(selected),
    "Return neutral context containing author decisions, source identities and message ids, story and editing constraints, proposal outcomes, and unresolved questions. Exclude system prompts, tool payload bodies, reasoning, and superseded proposal bodies.",
  ].join("\n\n");
}

export async function compactConversation(args: {
  messages: AgentUIMessage[];
  currentSummary: ConversationSummary | null;
  tokenTarget: number;
  summarize: (source: string) => Promise<string>;
}): Promise<{
  messages: AgentUIMessage[];
  summary: ConversationSummary | null;
}> {
  const boundary =
    args.currentSummary === null
      ? -1
      : args.messages.findIndex(
          (message) =>
            message.id === args.currentSummary?.throughMessageId,
        );
  if (args.currentSummary !== null && boundary < 0) {
    throw new Error(
      `Compaction boundary message is missing: ${args.currentSummary.throughMessageId}`,
    );
  }
  const selected = selectCompactionTurns(
    args.messages.slice(boundary + 1),
    args.tokenTarget,
  );
  const selectedTokens = estimatedTokens(selected);
  if (selectedTokens < args.tokenTarget) {
    throw new Error(
      `Compaction cannot reclaim the required token target: required ${args.tokenTarget}, eligible ${selectedTokens}.`,
    );
  }
  if (selected.length === 0) {
    return { messages: args.messages, summary: args.currentSummary };
  }
  const validated = await validateAgentMessages(selected);
  const sanitized = sanitizeAgentMessages(validated);
  const text = await args.summarize(
    compactionSource(args.currentSummary, sanitized),
  );
  return {
    messages: args.messages,
    summary: {
      text,
      throughMessageId: selected[selected.length - 1].id,
    },
  };
}

export function messagesForNextRequest(
  messages: AgentUIMessage[],
  summary: ConversationSummary | null,
): AgentUIMessage[] {
  if (summary === null) return messages;
  const through = messages.findIndex(
    (message) => message.id === summary.throughMessageId,
  );
  if (through < 0) {
    throw new Error(
      `Compaction boundary message is missing: ${summary.throughMessageId}`,
    );
  }
  const next = messages[through + 1];
  const metadata = next?.metadata ?? messages[through].metadata;
  if (metadata === undefined) {
    throw new Error("Compacted history requires message metadata.");
  }
  return [
    {
      id: `summary-${summary.throughMessageId}`,
      role: "user",
      metadata: { ...metadata, state: "complete" },
      parts: [{ type: "data-compaction", data: summary }],
    },
    ...messages.slice(through + 1),
  ];
}
