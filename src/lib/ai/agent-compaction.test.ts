import { describe, expect, it, vi } from "vitest";
import {
  compactConversation,
  messagesForNextRequest,
  selectCompactionTurns,
  shouldCompactConversation,
} from "@/lib/ai/agent-compaction";
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
});

describe("compactConversation", () => {
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
