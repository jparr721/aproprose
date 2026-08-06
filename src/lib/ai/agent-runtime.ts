import {
  ToolLoopAgent,
  readUIMessageStream,
  stepCountIs,
  type LanguageModel,
  type LanguageModelUsage,
  type StopCondition,
} from "ai";
import {
  convertAgentMessagesToModel,
  hasAssistantOutput,
  validateAgentMessages,
} from "@/lib/ai/agent-messages";
import {
  createAgentTools,
  type AgentToolEnvironment,
  type AgentToolSet,
} from "@/lib/ai/agent-tools";
import type {
  AgentDataParts,
  AgentMessageMetadata,
  AgentRun,
  AgentUIMessage,
  PersistedUsage,
} from "@/lib/ai/agent-types";

export interface AgentToolFailure {
  toolCallId: string;
  toolName: string;
  input: unknown;
  error: unknown;
}

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
  onToolFailure: (failure: AgentToolFailure) => Promise<void>;
}

export interface StreamAgentRunResult {
  message: AgentUIMessage;
  usage: PersistedUsage;
}

function proposalStageSucceeded({
  steps,
}: Parameters<StopCondition<AgentToolSet>>[0]): boolean {
  const step = steps.at(-1);
  return (
    step?.content.some(
      (part) =>
        part.type === "tool-result" &&
        (part.toolName === "stage_manuscript_proposal" ||
          part.toolName === "stage_outline_proposal" ||
          part.toolName === "stage_overview_proposal"),
    ) ?? false
  );
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
    failure: null,
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

function findingsDataFromToolPart(
  part: AgentUIMessage["parts"][number],
): AgentDataParts["findings"] | null {
  if (
    part.type === "tool-run_critique" &&
    part.state === "output-available" &&
    part.output.kind === "runtime"
  ) {
    return {
      kind: "critique",
      chapterId: part.input.chapterId,
      items: part.output.value.findings,
    };
  }
  if (
    part.type === "tool-run_continuity" &&
    part.state === "output-available" &&
    part.output.kind === "runtime"
  ) {
    return {
      kind: "continuity",
      chapterId: part.input.chapterId,
      items: part.output.value.findings,
    };
  }
  return null;
}

function projectAnalysisFindings(message: AgentUIMessage): AgentUIMessage {
  const existing = new Set(
    message.parts.flatMap((part) =>
      part.type === "data-findings" ? [JSON.stringify(part.data)] : [],
    ),
  );
  const additions: AgentUIMessage["parts"] = [];
  for (const part of message.parts) {
    const data = findingsDataFromToolPart(part);
    if (data === null) continue;
    const key = JSON.stringify(data);
    if (existing.has(key)) continue;
    existing.add(key);
    additions.push({ type: "data-findings", data });
  }
  return additions.length === 0
    ? message
    : { ...message, parts: [...message.parts, ...additions] };
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
      proposalStageSucceeded,
    ],
    onStepFinish: async (step) => {
      for (const part of step.content) {
        if (part.type !== "tool-error") continue;
        try {
          await input.onToolFailure({
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
            error: part.error,
          });
        } catch (error) {
          console.error("Agent tool failure diagnostic could not be written", {
            cause: error,
            runId: input.run.id,
            toolCallId: part.toolCallId,
            toolName: part.toolName,
          });
        }
      }
    },
  });
  const result = await agent.stream({
    prompt: modelMessages,
    abortSignal: input.signal,
  });
  const streamErrors = new Map<string, unknown>();
  let streamErrorId = 0;
  const stream = result.toUIMessageStream<AgentUIMessage>({
    originalMessages: validated,
    generateMessageId: input.generateMessageId,
    sendReasoning: true,
    onError: (error) => {
      streamErrorId += 1;
      const errorToken = `Agent stream error ${streamErrorId}`;
      streamErrors.set(errorToken, error);
      return errorToken;
    },
    messageMetadata: ({ part }) =>
      messageMetadata(
        input.run,
        part.type === "finish" ? "complete" : "streaming",
      ),
  });

  let latest: AgentUIMessage | null = null;
  try {
    for await (const message of readUIMessageStream<AgentUIMessage>({
      stream,
      terminateOnError: true,
    })) {
      latest = projectAnalysisFindings(message);
      input.onMessage(latest);
    }
  } catch (error) {
    if (error instanceof Error && streamErrors.has(error.message)) {
      throw streamErrors.get(error.message);
    }
    throw error;
  }
  if (latest === null) {
    throw new Error(`Agent run emitted no assistant message: ${input.run.id}`);
  }
  if (!hasAssistantOutput(latest)) {
    throw new Error(`Agent run emitted no assistant output: ${input.run.id}`);
  }
  const usage = await result.totalUsage;
  return {
    message: latest,
    usage: normalizeUsage(usage, input.modelId, input.contextWindow),
  };
}
