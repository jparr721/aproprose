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

const RECENT_TURNS_TO_KEEP = 4;

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
  return Math.max(1, Math.ceil(JSON.stringify(messages).length / 4));
}

function completeTurns(messages: AgentUIMessage[]): AgentUIMessage[][] {
  const turns: AgentUIMessage[][] = [];
  for (let index = 0; index < messages.length - 1; index += 1) {
    const user = messages[index];
    const assistant = messages[index + 1];
    if (
      user.role === "user" &&
      assistant.role === "assistant" &&
      assistant.metadata?.state === "complete"
    ) {
      turns.push([user, assistant]);
      index += 1;
    }
  }
  return turns;
}

export function selectCompactionTurns(
  messages: AgentUIMessage[],
  tokenTarget: number,
): AgentUIMessage[] {
  const turns = completeTurns(messages);
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
  if (selected.length === 0) {
    return { messages: args.messages, summary: args.currentSummary };
  }
  const text = await args.summarize(
    compactionSource(args.currentSummary, selected),
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
