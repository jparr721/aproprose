import type {
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { AgentToolEnvironment } from "@/lib/ai/agent-tools";
import type {
  AgentRun,
  AgentUIMessage,
} from "@/lib/ai/agent-types";
import {
  streamAgentRun,
  type StreamAgentRunInput,
} from "@/lib/ai/agent-runtime";

const usage = {
  inputTokens: {
    total: 20,
    noCache: 20,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 4,
    text: 4,
    reasoning: 0,
  },
};

const run: AgentRun = {
  id: "run-1",
  projectRoot: "/book",
  mode: "writing",
  task: { kind: "conversation", targetChapterId: "ch1" },
  userMessageId: "user-1",
  attachments: [],
  startedAt: "2026-07-30T12:00:00.000Z",
};

const userMessage: AgentUIMessage = {
  id: "user-1",
  role: "user",
  metadata: {
    runId: run.id,
    mode: run.mode,
    task: run.task,
    state: "complete",
    createdAt: run.startedAt,
    error: null,
    errorCode: null,
    retryOf: null,
    usage: null,
  },
  parts: [
    { type: "text", text: "Continue the scene." },
    { type: "data-context", data: { snapshots: [] } },
  ],
};

function streamResult(
  chunks: LanguageModelV3StreamPart[],
): LanguageModelV3StreamResult {
  return {
    stream: new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  };
}

function textResult(text: string): LanguageModelV3StreamResult {
  return streamResult([
    { type: "reasoning-start", id: "reasoning-1" },
    {
      type: "reasoning-delta",
      id: "reasoning-1",
      delta: "Hidden chain of thought",
    },
    { type: "reasoning-end", id: "reasoning-1" },
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", delta: text },
    { type: "text-end", id: "text-1" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: "stop" },
      usage,
    },
  ]);
}

function toolCallResult(index: number): LanguageModelV3StreamResult {
  return streamResult([
    {
      type: "tool-call",
      toolCallId: `call-${index}`,
      toolName: "read_chapter",
      input: JSON.stringify({ chapterId: "ch1" }),
    },
    {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
      usage,
    },
  ]);
}

function makeEnvironment(): AgentToolEnvironment {
  return {
    run,
    signal: new AbortController().signal,
    readChapter: async (chapterId) => ({
      chapterId,
      title: "Chapter One",
      blocks: [],
    }),
    readOutline: async () => ({ premise: "", chapters: [] }),
    readLore: async () => ({ entries: [] }),
    runCritique: async () => [],
    runContinuity: async () => [],
    readConversationContext: () => ({ messages: [] }),
    getPendingProposal: () => null,
    buildManuscriptProposal: () => {
      throw new Error("Unexpected manuscript proposal");
    },
    buildOutlineProposal: () => {
      throw new Error("Unexpected outline proposal");
    },
    replacePendingProposal: () => {
      throw new Error("Unexpected proposal replacement");
    },
  };
}

function makeRuntimeInput(model: LanguageModel): StreamAgentRunInput {
  const controller = new AbortController();
  return {
    model,
    modelId: "gpt-5",
    contextWindow: 400_000,
    run,
    instructions: "APROPROSE WRITING MODE",
    messages: [userMessage],
    environment: { ...makeEnvironment(), signal: controller.signal },
    signal: controller.signal,
    generateMessageId: () => "assistant-1",
    onMessage: () => undefined,
  };
}

describe("streamAgentRun", () => {
  it("streams an assistant UI message without reasoning parts", async () => {
    const updates = vi.fn();
    const input = makeRuntimeInput(
      new MockLanguageModelV3({
        doStream: async () => textResult("Draft response"),
      }),
    );

    const result = await streamAgentRun({ ...input, onMessage: updates });

    expect(result.message).toMatchObject({
      id: "assistant-1",
      role: "assistant",
      metadata: {
        runId: "run-1",
        mode: "writing",
        state: "complete",
      },
    });
    expect(result.message.parts).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: "Draft response",
        state: "done",
      }),
    );
    expect(
      result.message.parts.some((part) => part.type === "reasoning"),
    ).toBe(false);
    expect(updates).toHaveBeenCalled();
    expect(result.usage).toMatchObject({
      modelId: "gpt-5",
      inputTokens: 20,
      outputTokens: 4,
      totalTokens: 24,
      contextWindow: 400_000,
    });
  });

  it("uses frozen instructions and stops after eight non-staging steps", async () => {
    let calls = 0;
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        calls += 1;
        expect(JSON.stringify(options.prompt)).toContain(
          "APROPROSE WRITING MODE",
        );
        expect(JSON.stringify(options.prompt)).not.toContain(
          "APROPROSE EDIT MODE",
        );
        return toolCallResult(calls);
      },
    });

    await streamAgentRun(makeRuntimeInput(model));

    expect(calls).toBe(8);
  });
});
