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

const toolSummary = {
  label: "Read chapter",
  target: "Chapter 1",
  detail: "2 blocks",
  itemCount: 2,
};

function dynamicToolPart(
  output: unknown,
): AgentUIMessage["parts"][number] {
  return {
    type: "dynamic-tool",
    toolName: "read_chapter",
    toolCallId: "call-1",
    state: "output-available",
    input: { chapterId: "ch1" },
    output,
  };
}

function assistantWithOutput(id: string, output: unknown): AgentUIMessage {
  return {
    id,
    role: "assistant",
    metadata,
    parts: [dynamicToolPart(output)],
  };
}

function assistantWithUnsafeToolFailures(): AgentUIMessage {
  return {
    id: "assistant-tool-failures",
    role: "assistant",
    metadata: {
      ...metadata,
      state: "error",
      error: "Tool failed",
      errorCode: "tool",
    },
    parts: [
      {
        type: "tool-run_critique",
        toolCallId: "call-error",
        state: "output-error",
        input: {
          chapterId: "/Users/author/private/chapter.tex",
          focus: "PRIVATE ERROR FOCUS",
        },
        rawInput: "PRIVATE RAW INPUT",
        errorText: "ENOENT /Users/author/private/chapter.tex PRIVATE ERROR",
      },
      {
        type: "tool-stage_manuscript_proposal",
        toolCallId: "call-denied",
        state: "output-denied",
        input: {
          summary: "PRIVATE DENIED SUMMARY",
          changes: [
            {
              kind: "rewrite",
              blockId: "block-1",
              afterId: null,
              type: null,
              speaker: null,
              newText: "PRIVATE DENIED PROSE",
              toIndex: null,
              reason: "PRIVATE DENIED REASON",
            },
          ],
        },
        approval: {
          id: "PRIVATE APPROVAL ID",
          approved: false,
          reason: "PRIVATE APPROVAL REASON",
        },
      },
    ],
  } as AgentUIMessage;
}

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

  it("settles retained text and removes incomplete tool calls from interrupted messages", () => {
    const messages = [
      {
        id: "assistant-interrupted",
        role: "assistant",
        metadata: { ...metadata, state: "stopped" },
        parts: [
          { type: "text", text: "Retained partial answer", state: "streaming" },
          {
            type: "dynamic-tool",
            toolName: "read_chapter",
            toolCallId: "call-streaming",
            state: "input-streaming",
            input: { chapterId: "ch1", raw: "Transient tool input" },
          },
          {
            type: "tool-read_outline",
            toolCallId: "call-ready",
            state: "input-available",
            input: { chapterId: "ch1", raw: "Unexecuted tool input" },
          },
          {
            ...dynamicToolPart({
              kind: "runtime",
              summary: toolSummary,
              value: { exactText: "Preliminary runtime tool value" },
            }),
            toolCallId: "call-preliminary",
            preliminary: true,
          },
          dynamicToolPart({
            kind: "runtime",
            summary: toolSummary,
            value: { exactText: "Private runtime tool value" },
          }),
        ],
      },
    ] as unknown as AgentUIMessage[];

    const sanitized = sanitizeAgentMessages(messages);
    const serialized = JSON.stringify(sanitized);

    expect(sanitized[0].parts).toHaveLength(2);
    expect(sanitized[0].parts[0]).toEqual({
      type: "text",
      text: "Retained partial answer",
      state: "done",
    });
    expect(sanitized[0].parts[1]).toMatchObject({
      state: "output-available",
      output: { kind: "summary", summary: toolSummary },
    });
    expect(serialized).not.toContain("input-streaming");
    expect(serialized).not.toContain("input-available");
    expect(serialized).not.toContain("Transient tool input");
    expect(serialized).not.toContain("Unexecuted tool input");
    expect(serialized).not.toContain("Preliminary runtime tool value");
    expect(serialized).not.toContain("Private runtime tool value");
  });

  it("projects failed and denied tools into safe settled lifecycle rows", () => {
    const sanitized = sanitizeAgentMessages([
      assistantWithUnsafeToolFailures(),
    ]);

    expect(sanitized[0].parts).toEqual([
      {
        type: "tool-run_critique",
        toolCallId: "call-error",
        state: "output-error",
        input: { chapterId: "Chapter", focus: null },
        errorText: "Tool execution failed.",
      },
      {
        type: "tool-stage_manuscript_proposal",
        toolCallId: "call-denied",
        state: "output-denied",
        input: { summary: "", changes: [] },
        approval: {
          id: "call-denied",
          approved: false,
        },
      },
    ]);
    expect(JSON.stringify(sanitized)).not.toMatch(/PRIVATE|\/Users\/author/);
  });

  it("projects completed tool input and summaries into safe canonical fields", () => {
    const messages = [
      {
        id: "assistant-completed-private",
        role: "assistant",
        metadata,
        parts: [
          {
            type: "tool-run_continuity",
            toolCallId: "call-complete",
            state: "output-available",
            input: {
              chapterId: "file:///Users/author/private/chapter.tex",
              focus: "PRIVATE COMPLETED FOCUS",
            },
            output: {
              kind: "runtime",
              summary: {
                label: "PRIVATE COMPLETED LABEL",
                target: "/Users/author/private/chapter.tex",
                detail: "PRIVATE COMPLETED DETAIL",
                itemCount: 3,
              },
              value: { findings: "PRIVATE COMPLETED OUTPUT" },
            },
          },
        ],
      },
    ] as AgentUIMessage[];

    const sanitized = sanitizeAgentMessages(messages);

    expect(sanitized[0].parts).toEqual([
      {
        type: "tool-run_continuity",
        toolCallId: "call-complete",
        state: "output-available",
        input: { chapterId: "Chapter", focus: null },
        output: {
          kind: "summary",
          summary: {
            label: "Check continuity",
            target: "Chapter",
            detail: "3 findings",
            itemCount: 3,
          },
        },
      },
    ]);
    expect(JSON.stringify(sanitized)).not.toMatch(/PRIVATE|\/Users\/author/);
  });

  it("rejects summary outputs with unexpected top-level fields", () => {
    const messages = [
      assistantWithOutput("assistant-extra", {
        kind: "summary",
        summary: toolSummary,
        hidden: "top-level secret",
      }),
    ];

    expect(() => sanitizeAgentMessages(messages)).toThrow(
      "Completed agent tool output is not safe to persist",
    );
  });

  it("rejects summary outputs with unexpected nested fields", () => {
    const messages = [
      assistantWithOutput("assistant-nested-extra", {
        kind: "summary",
        summary: {
          ...toolSummary,
          hidden: "nested secret",
        },
      }),
    ];

    expect(() => sanitizeAgentMessages(messages)).toThrow(
      "Completed agent tool output is not safe to persist",
    );
  });

  it("reconstructs valid summary outputs without modifying the original", () => {
    const output = {
      kind: "summary",
      summary: { ...toolSummary },
    } as const;
    const messages = [assistantWithOutput("assistant-summary", output)];

    const sanitized = sanitizeAgentMessages(messages);
    const sanitizedPart = sanitized[0].parts[0] as {
      output: { kind: "summary"; summary: typeof toolSummary };
    };

    expect(sanitizedPart.output).not.toBe(output);
    expect(sanitizedPart.output.summary).not.toBe(output.summary);
    expect(sanitizedPart.output).toEqual(output);
    expect(output).toEqual({
      kind: "summary",
      summary: toolSummary,
    });
  });

  it("rejects unknown parts instead of persisting them", () => {
    const messages = [
      {
        id: "assistant-unknown",
        role: "assistant",
        metadata,
        parts: [{ type: "provider-private", value: "raw payload" }],
      },
    ] as unknown as AgentUIMessage[];

    expect(() => sanitizeAgentMessages(messages)).toThrow(
      "Unknown agent message part cannot be persisted",
    );
  });
});

describe("validateAgentMessages", () => {
  it("accepts an empty conversation", async () => {
    await expect(validateAgentMessages([])).resolves.toEqual([]);
  });

  it("accepts a settled assistant error with no renderable parts", async () => {
    const message: AgentUIMessage = {
      id: "assistant-error",
      role: "assistant",
      metadata: {
        ...metadata,
        state: "error",
        error: "Transport failed",
        errorCode: "transport",
      },
      parts: [],
    };

    await expect(validateAgentMessages([message])).resolves.toEqual([message]);
  });

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
  it("rejects system messages at the model boundary", async () => {
    await expect(
      convertAgentMessagesToModel(
        [
          {
            id: "system-model",
            role: "system",
            metadata,
            parts: [{ type: "text", text: "Hidden system instructions" }],
          },
        ],
        {},
      ),
    ).rejects.toThrow("System messages cannot be persisted");
  });

  it("removes reasoning and runtime values at the model boundary", async () => {
    const messages: AgentUIMessage[] = [
      {
        id: "assistant-model",
        role: "assistant",
        metadata,
        parts: [
          { type: "reasoning", text: "Hidden model reasoning", state: "done" },
          dynamicToolPart({
            kind: "runtime",
            summary: toolSummary,
            value: { chapterText: "Secret model chapter text" },
          }),
        ],
      },
    ];

    const modelMessages = await convertAgentMessagesToModel(messages, {});
    const serialized = JSON.stringify(modelMessages);

    expect(serialized).not.toContain("Hidden model reasoning");
    expect(serialized).not.toContain("Secret model chapter text");
    expect(serialized).toContain("Read chapter");
  });

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

  it("replays safe failed and denied tool projections without raw data", async () => {
    const modelMessages = await convertAgentMessagesToModel(
      [assistantWithUnsafeToolFailures()],
      {},
    );
    const serialized = JSON.stringify(modelMessages);

    expect(serialized).toContain("run_critique");
    expect(serialized).toContain("stage_manuscript_proposal");
    expect(serialized).toContain("Tool execution failed.");
    expect(serialized).toContain("Tool execution denied.");
    expect(serialized).not.toMatch(/PRIVATE|\/Users\/author/);
  });
});
