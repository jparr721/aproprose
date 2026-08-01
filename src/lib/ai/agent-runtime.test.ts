import type {
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { sanitizeAgentMessages } from "@/lib/ai/agent-messages";
import type { AgentToolEnvironment } from "@/lib/ai/agent-tools";
import type {
  AgentRun,
  AgentUIMessage,
} from "@/lib/ai/agent-types";
import {
  streamAgentRun,
  type StreamAgentRunInput,
} from "@/lib/ai/agent-runtime";
import {
  emptyPersistedAgentState,
  fromAgentSnapshot,
} from "@/stores/agent-persistence";

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

function analysisToolCallResult(
  toolName: "run_critique" | "run_continuity",
): LanguageModelV3StreamResult {
  return streamResult([
    {
      type: "tool-call",
      toolCallId: `call-${toolName}`,
      toolName,
      input: JSON.stringify({ chapterId: "ch1", focus: null }),
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

  it.each([
    {
      toolName: "run_critique" as const,
      kind: "critique" as const,
      task: "critique" as const,
      item: {
        kind: "watch" as const,
        tag: "Pacing",
        text: "The middle stalls.",
        blockIds: ["block-2"],
      },
    },
    {
      toolName: "run_continuity" as const,
      kind: "continuity" as const,
      task: "continuity" as const,
      item: {
        sev: "warn" as const,
        tag: "Timeline",
        text: "The bell rings twice.",
        blockIds: ["block-1", "block-2"],
      },
    },
  ])(
    "projects successful $kind SDK tool output into one typed findings part",
    async ({ toolName, kind, task, item }) => {
      let calls = 0;
      const model = new MockLanguageModelV3({
        doStream: async () => {
          calls += 1;
          return calls === 1
            ? analysisToolCallResult(toolName)
            : textResult("Analysis complete.");
        },
      });
      const base = makeRuntimeInput(model);
      const analysisRun: AgentRun = {
        ...run,
        task: { kind: "chapter-analysis", chapterId: "ch1", analysis: task },
      };
      const environment: AgentToolEnvironment = {
        ...makeEnvironment(),
        run: analysisRun,
        signal: base.signal,
        runCritique: async () =>
          kind === "critique" ? [item] : [],
        runContinuity: async () =>
          kind === "continuity" ? [item] : [],
      };

      const result = await streamAgentRun({
        ...base,
        run: analysisRun,
        environment,
      });

      expect(
        result.message.parts.filter((part) => part.type === "data-findings"),
      ).toEqual([
        {
          type: "data-findings",
          data: { kind, chapterId: "ch1", items: [item] },
        },
      ]);
      const settled = sanitizeAgentMessages([result.message]);
      expect(
        settled[0].parts.filter(
          (part) =>
            part.type === "tool-run_critique" ||
            part.type === "tool-run_continuity",
        ),
      ).toEqual([
        {
          type: `tool-${toolName}`,
          toolCallId: `call-${toolName}`,
          state: "output-available",
          input: { chapterId: "ch1", focus: null },
          output: {
            kind: "summary",
            summary: {
              label: kind === "critique" ? "Run critique" : "Check continuity",
              target: "ch1",
              detail: "1 finding",
              itemCount: 1,
            },
          },
        },
      ]);
      expect(
        settled[0].parts.filter((part) => part.type === "data-findings"),
      ).toEqual([
        {
          type: "data-findings",
          data: { kind, chapterId: "ch1", items: [item] },
        },
      ]);
      expect(JSON.stringify(settled)).not.toContain('"kind":"runtime"');
      expect(JSON.stringify(settled)).not.toContain("Hidden chain of thought");

      const restored = await fromAgentSnapshot("/book", {
        ...emptyPersistedAgentState(),
        messages: settled,
      });
      expect(restored.messages).toEqual(settled);
    },
  );
});
