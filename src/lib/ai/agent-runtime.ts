import {
  ToolLoopAgent,
  hasToolCall,
  readUIMessageStream,
  stepCountIs,
  type LanguageModel,
  type LanguageModelUsage,
} from "ai";
import {
  convertAgentMessagesToModel,
  validateAgentMessages,
} from "@/lib/ai/agent-messages";
import {
  createAgentTools,
  type AgentToolEnvironment,
} from "@/lib/ai/agent-tools";
import type {
  AgentMessageMetadata,
  AgentRun,
  AgentUIMessage,
  PersistedUsage,
} from "@/lib/ai/agent-types";

export interface StreamAgentRunInput {
  model: LanguageModel;
  modelId: string;
  contextWindow: number;
  run: AgentRun;
  instructions: string;
  messages: AgentUIMessage[];
  environment: AgentToolEnvironment;
  signal: AbortSignal;
  generateMessageId: () => string;
  onMessage: (message: AgentUIMessage) => void;
}

export interface StreamAgentRunResult {
  message: AgentUIMessage;
  usage: PersistedUsage;
}

function messageMetadata(
  run: AgentRun,
  state: AgentMessageMetadata["state"],
): AgentMessageMetadata {
  return {
    runId: run.id,
    mode: run.mode,
    task: run.task,
    state,
    createdAt: run.startedAt,
    error: null,
    errorCode: null,
    retryOf: null,
    usage: null,
  };
}

function normalizeUsage(
  usage: LanguageModelUsage,
  modelId: string,
  contextWindow: number,
): PersistedUsage {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  return {
    modelId,
    inputTokens,
    outputTokens,
    totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
    contextWindow,
    raw: usage,
  };
}

export async function streamAgentRun(
  input: StreamAgentRunInput,
): Promise<StreamAgentRunResult> {
  const tools = createAgentTools(input.environment);
  const validated = await validateAgentMessages(input.messages, tools);
  const modelMessages = await convertAgentMessagesToModel(validated, tools);
  const agent = new ToolLoopAgent({
    model: input.model,
    instructions: input.instructions,
    tools,
    stopWhen: [
      stepCountIs(8),
      hasToolCall("stage_manuscript_proposal"),
      hasToolCall("stage_outline_proposal"),
    ],
  });
  const result = await agent.stream({
    prompt: modelMessages,
    abortSignal: input.signal,
  });
  const stream = result.toUIMessageStream<AgentUIMessage>({
    originalMessages: validated,
    generateMessageId: input.generateMessageId,
    sendReasoning: false,
    messageMetadata: ({ part }) =>
      messageMetadata(
        input.run,
        part.type === "finish" ? "complete" : "streaming",
      ),
  });

  let latest: AgentUIMessage | null = null;
  for await (const message of readUIMessageStream<AgentUIMessage>({ stream })) {
    latest = message;
    input.onMessage(message);
  }
  if (latest === null) {
    throw new Error(`Agent run emitted no assistant message: ${input.run.id}`);
  }
  const usage = await result.totalUsage;
  return {
    message: latest,
    usage: normalizeUsage(usage, input.modelId, input.contextWindow),
  };
}
