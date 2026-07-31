import { describe, expect, it } from "vitest";
import {
  convertAgentMessagesToModel,
  sanitizeAgentMessages,
  validateAgentMessages,
} from "@/lib/ai/agent-messages";
import type { AgentUIMessage } from "@/lib/ai/agent-types";

const metadata: AgentUIMessage["metadata"] = {
  runId: "run-1",
  mode: "writing",
  task: { kind: "conversation", targetChapterId: "ch1" },
  state: "complete",
  createdAt: "2026-07-30T00:00:00.000Z",
  error: null,
  errorCode: null,
  retryOf: null,
  usage: null,
};

describe("sanitizeAgentMessages", () => {
  it("removes reasoning and replaces runtime tool values with summaries", () => {
    const messages: AgentUIMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        metadata,
        parts: [
          { type: "reasoning", text: "hidden", state: "done" },
          {
            type: "tool-read_chapter",
            toolCallId: "call-1",
            state: "output-available",
            input: { chapterId: "ch1" },
            output: {
              kind: "runtime",
              summary: {
                label: "Read chapter",
                target: "Chapter 1",
                detail: "2 blocks",
                itemCount: 2,
              },
              value: {
                chapterId: "ch1",
                title: "One",
                blocks: [
                  {
                    id: "b1",
                    order: 0,
                    type: "narration",
                    text: "Secret full chapter text.",
                    fingerprint: "abc",
                  },
                ],
              },
            },
          },
        ],
      },
    ];

    const sanitized = sanitizeAgentMessages(messages);
    expect(JSON.stringify(sanitized)).not.toContain("hidden");
    expect(JSON.stringify(sanitized)).not.toContain("Secret full chapter text.");
    expect(
      (sanitized[0].parts[0] as { output: { kind: string } }).output.kind,
    ).toBe("summary");
  });

  it("returns new messages without modifying the live stream objects", () => {
    const messages: AgentUIMessage[] = [
      {
        id: "user-1",
        role: "user",
        metadata,
        parts: [{ type: "text", text: "Question" }],
      },
    ];
    const sanitized = sanitizeAgentMessages(messages);
    expect(sanitized).not.toBe(messages);
    expect(sanitized[0]).not.toBe(messages[0]);
    expect(messages[0].parts).toEqual([{ type: "text", text: "Question" }]);
  });

  it("omits transient streaming assistant messages from persistence", () => {
    const messages: AgentUIMessage[] = [
      {
        id: "assistant-stream",
        role: "assistant",
        metadata: { ...metadata, state: "streaming" },
        parts: [{ type: "text", text: "Partial response" }],
      },
    ];
    expect(sanitizeAgentMessages(messages)).toEqual([]);
  });
});

describe("validateAgentMessages", () => {
  it("rejects persisted system messages", async () => {
    await expect(
      validateAgentMessages([
        {
          id: "system-1",
          role: "system",
          metadata,
          parts: [{ type: "text", text: "Writing mode system prompt" }],
        },
      ]),
    ).rejects.toThrow("System messages cannot be persisted");
  });
});

describe("convertAgentMessagesToModel", () => {
  it("converts immutable context snapshots into model-visible text", async () => {
    const messages: AgentUIMessage[] = [
      {
        id: "user-1",
        role: "user",
        metadata,
        parts: [
          { type: "text", text: "Compare these." },
          {
            type: "data-context",
            data: {
              snapshots: [
                {
                  id: "snapshot-1",
                  kind: "block",
                  chapterId: "ch1",
                  sourceId: "b1",
                  order: 0,
                  sourceType: "narration",
                  label: "Narration block",
                  exactText: "Frozen exact prose.",
                  sourceFingerprint: "abc",
                },
              ],
            },
          },
        ],
      },
    ];
    const modelMessages = await convertAgentMessagesToModel(messages, {});
    expect(JSON.stringify(modelMessages)).toContain("Frozen exact prose.");
  });
});
