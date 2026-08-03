import { describe, expect, it, vi } from "vitest";
import {
  compactionTokenTarget,
  compactConversation,
  messagesForNextRequest,
  modelContextWindow,
  selectCompactionTurns,
  shouldCompactConversation,
} from "@/lib/ai/agent-compaction";
import type { ProviderInfo } from "@tokenlens/core";
import type {
  AgentMessageMetadata,
  AgentUIMessage,
  PersistedUsage,
} from "@/lib/ai/agent-types";

const meta = (state: AgentMessageMetadata["state"]): AgentMessageMetadata => ({
  runId: "run",
  mode: "writing",
  task: { kind: "conversation", targetChapterId: "ch1" },
  state,
  createdAt: "2026-07-30T00:00:00.000Z",
  error: null,
  errorCode: null,
  retryOf: null,
  usage: null,
});

const pair = (index: number): AgentUIMessage[] => [
  {
    id: `u${index}`,
    role: "user",
    metadata: meta("complete"),
    parts: [{ type: "text", text: `Question ${index} ${"x".repeat(100)}` }],
  },
  {
    id: `a${index}`,
    role: "assistant",
    metadata: meta("complete"),
    parts: [{ type: "text", text: `Answer ${index} ${"y".repeat(100)}` }],
  },
];

const toolSummary = {
  label: "Read chapter",
  target: "Chapter 1",
  detail: "2 blocks",
  itemCount: 2,
};

function sensitivePair(index: number): AgentUIMessage[] {
  return [
    {
      id: `u${index}`,
      role: "user",
      metadata: meta("complete"),
      parts: [{ type: "text", text: `Question ${index}` }],
    },
    {
      id: `a${index}`,
      role: "assistant",
      metadata: meta("complete"),
      parts: [
        {
          type: "reasoning",
          text: "Hidden compaction reasoning",
          state: "done",
        },
        {
          type: "dynamic-tool",
          toolName: "read_chapter",
          toolCallId: `call-${index}`,
          state: "output-available",
          input: { chapterId: "ch1" },
          output: {
            kind: "runtime",
            summary: toolSummary,
            value: { chapterText: "Secret compaction chapter text" },
          },
        },
      ],
    },
  ];
}

function interruptedPair(
  index: number,
  state: "stopped" | "error",
): AgentUIMessage[] {
  return [
    {
      id: `u${index}`,
      role: "user",
      metadata: meta("complete"),
      parts: [{ type: "text", text: `Interrupted question ${index}` }],
    },
    {
      id: `a${index}`,
      role: "assistant",
      metadata: meta(state),
      parts: [{ type: "text", text: `Interrupted answer ${index}` }],
    },
  ];
}

function proposalEvent(
  id: string,
  state: AgentMessageMetadata["state"],
): AgentUIMessage {
  return {
    id,
    role: "assistant",
    metadata: {
      ...meta(state),
      task: { kind: "proposal-follow-up", proposalId: "proposal-1" },
    },
    parts: [
      {
        type: "data-proposal-event",
        data: {
          proposalId: "proposal-1",
          action: "accepted",
          changeCount: 1,
          text: "Accepted proposal 1",
        },
      },
    ],
  };
}

describe("selectCompactionTurns", () => {
  it("selects oldest complete turns while retaining the latest four", () => {
    const messages = Array.from({ length: 7 }, (_, index) => pair(index)).flat();
    const selected = selectCompactionTurns(messages, 1);
    expect(selected.map((message) => message.id)).toEqual(["u0", "a0"]);
    expect(selected).not.toContainEqual(expect.objectContaining({ id: "u3" }));
  });

  it("never selects an active streaming turn", () => {
    const messages = [
      ...pair(0),
      {
        id: "u1",
        role: "user" as const,
        metadata: meta("complete"),
        parts: [{ type: "text" as const, text: "Active question" }],
      },
      {
        id: "a1",
        role: "assistant" as const,
        metadata: meta("streaming"),
        parts: [{ type: "text" as const, text: "Active answer" }],
      },
    ];
    expect(selectCompactionTurns(messages, 10_000).map((message) => message.id))
      .toEqual([]);
  });

  it("includes complete proposal events with their preceding turn", () => {
    const messages = [
      ...pair(0),
      proposalEvent("event-0", "complete"),
      ...Array.from({ length: 7 }, (_, index) => pair(index + 1)).flat(),
    ];

    expect(selectCompactionTurns(messages, 1).map((message) => message.id))
      .toEqual(["u0", "a0", "event-0"]);
  });

  it("does not treat a proposal event as the missing assistant response", () => {
    const messages = [
      pair(0)[0],
      proposalEvent("event-0", "complete"),
      ...Array.from({ length: 7 }, (_, index) => pair(index + 1)).flat(),
    ];

    expect(selectCompactionTurns(messages, 1)).toEqual([]);
  });

  it.each(["streaming", "stopped", "error"] as const)(
    "stops before a %s proposal-event gap",
    (state) => {
      const messages = [
        ...Array.from({ length: 5 }, (_, index) => pair(index)).flat(),
        proposalEvent("event-gap", state),
        ...Array.from({ length: 5 }, (_, index) => pair(index + 5)).flat(),
      ];

      expect(
        selectCompactionTurns(messages, 100_000).map((message) => message.id),
      ).toEqual(["u0", "a0"]);
    },
  );
});

describe("compaction threshold", () => {
  it("uses tokenlens default 85 percent threshold", () => {
    const usage = {
      modelId: "gpt-4.1",
      inputTokens: 900_000,
      outputTokens: 1_000,
      totalTokens: 901_000,
      contextWindow: 1_047_576,
      raw: {} as PersistedUsage["raw"],
    } satisfies PersistedUsage;
    expect(shouldCompactConversation(usage)).toBe(true);
  });

  it("uses persisted context metadata for a model absent from the bundled catalog", () => {
    const usage = {
      modelId: "gpt-5.6-luna",
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      contextWindow: 1_050_000,
      raw: {} as PersistedUsage["raw"],
    } satisfies PersistedUsage;

    expect(shouldCompactConversation(usage)).toBe(false);
    expect(
      shouldCompactConversation({
        ...usage,
        inputTokens: 900_000,
        outputTokens: 1_000,
        totalTokens: 901_000,
      }),
    ).toBe(true);
    expect(
      compactionTokenTarget({
        ...usage,
        inputTokens: 900_000,
        outputTokens: 1_000,
        totalTokens: 901_000,
      }),
    ).toBe(271_000);
  });
});

describe("modelContextWindow", () => {
  it("reads a current OpenAI model absent from the bundled catalog", () => {
    const currentOpenAiModels = {
      id: "openai",
      name: "OpenAI",
      models: {
        "gpt-5.6-luna": {
          id: "gpt-5.6-luna",
          name: "GPT-5.6 Luna",
          limit: {
            context: 1_050_000,
            input: 922_000,
            output: 128_000,
          },
        },
      },
    } satisfies ProviderInfo;

    expect(modelContextWindow("gpt-5.6-luna", currentOpenAiModels)).toBe(
      1_050_000,
    );
  });
});

describe("compactConversation", () => {
  it("rejects before summarizing when eligible history cannot meet the target", async () => {
    const summarize = vi.fn().mockResolvedValue("Too-small summary.");

    await expect(
      compactConversation({
        messages: Array.from({ length: 7 }, (_, index) => pair(index)).flat(),
        currentSummary: null,
        tokenTarget: 100_000,
        summarize,
      }),
    ).rejects.toThrow("Compaction cannot reclaim the required token target");
    expect(summarize).not.toHaveBeenCalled();
  });

  it("removes reasoning and runtime values before calling the summarizer", async () => {
    const messages = [
      ...sensitivePair(0),
      ...Array.from({ length: 6 }, (_, index) => pair(index + 1)).flat(),
    ];
    let source = "";

    await compactConversation({
      messages,
      currentSummary: null,
      tokenTarget: 1,
      summarize: async (value) => {
        source = value;
        return "Safe summary.";
      },
    });

    expect(source).not.toContain("Hidden compaction reasoning");
    expect(source).not.toContain("Secret compaction chapter text");
    expect(source).toContain("Read chapter");
  });

  it("rejects unsafe completed outputs before calling the summarizer", async () => {
    const unsafe: AgentUIMessage[] = [
      {
        id: "u0",
        role: "user",
        metadata: meta("complete"),
        parts: [{ type: "text", text: "Question 0" }],
      },
      {
        id: "a0",
        role: "assistant",
        metadata: meta("complete"),
        parts: [
          {
            type: "dynamic-tool",
            toolName: "read_chapter",
            toolCallId: "call-unsafe",
            state: "output-available",
            input: { chapterId: "ch1" },
            output: {
              kind: "summary",
              summary: toolSummary,
              hidden: "summarizer secret",
            },
          },
        ],
      },
    ];
    const messages = [
      ...unsafe,
      ...Array.from({ length: 6 }, (_, index) => pair(index + 1)).flat(),
    ];
    let summarizerCalled = false;

    await expect(
      compactConversation({
        messages,
        currentSummary: null,
        tokenTarget: 1,
        summarize: async () => {
          summarizerCalled = true;
          return "Unsafe summary.";
        },
      }),
    ).rejects.toThrow("Completed agent tool output is not safe to persist");
    expect(summarizerCalled).toBe(false);
  });

  it("summarizes selected turns without removing them from the visible transcript", async () => {
    const messages = Array.from({ length: 7 }, (_, index) => pair(index)).flat();
    const summarize = vi.fn().mockResolvedValue("Author chose the locked-room reveal.");
    const result = await compactConversation({
      messages,
      currentSummary: null,
      tokenTarget: 1,
      summarize,
    });
    expect(result.messages).toBe(messages);
    expect(result.summary).toEqual({
      text: "Author chose the locked-room reveal.",
      throughMessageId: "a0",
    });
    expect(summarize).toHaveBeenCalledOnce();
  });

  it("never summarizes turns at or before the saved boundary again", async () => {
    const messages = Array.from({ length: 7 }, (_, index) => pair(index)).flat();
    const summarize = vi.fn().mockResolvedValue("Updated summary.");
    await compactConversation({
      messages,
      currentSummary: {
        text: "Existing summary.",
        throughMessageId: "a0",
      },
      tokenTarget: 1,
      summarize,
    });
    expect(summarize.mock.calls[0][0]).not.toContain("Question 0");
    expect(summarize.mock.calls[0][0]).toContain("Question 1");
  });

  it("advances through proposal events so later turns remain compactable", async () => {
    const messages = [
      ...pair(0),
      proposalEvent("event-0", "complete"),
      ...Array.from({ length: 7 }, (_, index) => pair(index + 1)).flat(),
    ];
    const firstSources: string[] = [];
    const first = await compactConversation({
      messages,
      currentSummary: null,
      tokenTarget: 1,
      summarize: async (source) => {
        firstSources.push(source);
        return "First summary.";
      },
    });

    expect(first.summary?.throughMessageId).toBe("event-0");
    expect(firstSources[0]).toContain("Accepted proposal 1");
    const secondSources: string[] = [];
    const second = await compactConversation({
      messages,
      currentSummary: first.summary,
      tokenTarget: 1,
      summarize: async (source) => {
        secondSources.push(source);
        return "Second summary.";
      },
    });

    expect(second.summary?.throughMessageId).toBe("a1");
    expect(secondSources[0]).toContain("Question 1");
    expect(secondSources[0]).not.toContain("Question 0");
  });

  it.each(["stopped", "error"] as const)(
    "stops before a %s gap and keeps the gap plus later turns in the next request",
    async (state) => {
      const messages = [
        ...Array.from({ length: 5 }, (_, index) => pair(index)).flat(),
        ...interruptedPair(5, state),
        ...Array.from({ length: 5 }, (_, index) => pair(index + 6)).flat(),
      ];
      let source = "";

      const result = await compactConversation({
        messages,
        currentSummary: null,
        tokenTarget: 1,
        summarize: async (value) => {
          source = value;
          return `Summary before ${state}.`;
        },
      });

      expect(result.summary?.throughMessageId).toBe("a0");
      expect(source).toContain("Question 0");
      for (const id of ["u5", "a5", "u6", "a6"]) {
        expect(source).not.toContain(`\"id\":\"${id}\"`);
      }
      if (result.summary === null) {
        throw new Error("Expected a summary before the interrupted turn.");
      }
      const request = messagesForNextRequest(messages, result.summary);
      const requestIds = request.map((message) => message.id);
      expect(requestIds).toEqual(expect.arrayContaining(["u5", "a5", "u6", "a6"]));
      expect(messages.map((message) => message.id)).toEqual(
        expect.arrayContaining(["u5", "a5", "u6", "a6"]),
      );
    },
  );

  it("substitutes the summary only in the next model request", () => {
    const messages = Array.from({ length: 6 }, (_, index) => pair(index)).flat();
    const request = messagesForNextRequest(messages, {
      text: "Earlier decisions.",
      throughMessageId: "a1",
    });
    expect(request[0].role).toBe("user");
    expect(JSON.stringify(request[0])).toContain("Earlier decisions.");
    expect(request.some((message) => message.id === "u0")).toBe(false);
    expect(messages.some((message) => message.id === "u0")).toBe(true);
  });
});
