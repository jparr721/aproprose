import {
  convertToModelMessages,
  isToolOrDynamicToolUIPart,
  validateUIMessages,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { z } from "zod";
import type {
  AgentMessageMetadata,
  AgentToolOutput,
  AgentToolSummary,
  AgentUIMessage,
  AgentUiTools,
  ContextSnapshot,
} from "@/lib/ai/agent-types";
import type { ContinuityFlag, CritiqueNote } from "@/lib/types";

const agentModeSchema = z.enum(["writing", "edit"]);

const agentTaskSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("conversation"),
    targetChapterId: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("bridge"),
    chapterId: z.string(),
    anchorBlockId: z.string(),
    successorBlockId: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("selected-block-edit"),
    chapterId: z.string(),
    blockIds: z.array(z.string()),
    operation: z.enum(["clean", "structure", "custom"]),
  }),
  z.object({
    kind: z.literal("chapter-analysis"),
    chapterId: z.string(),
    analysis: z.enum(["critique", "continuity"]),
  }),
  z.object({ kind: z.literal("outline-sculpt"), chapterId: z.string() }),
  z.object({ kind: z.literal("proposal-follow-up"), proposalId: z.string() }),
]);

const metadataSchema = z.object({
  runId: z.string(),
  mode: agentModeSchema,
  task: agentTaskSchema,
  state: z.enum(["complete", "streaming", "stopped", "error"]),
  createdAt: z.string(),
  error: z.string().nullable(),
  errorCode: z
    .enum([
      "configuration",
      "transport",
      "tool",
      "compaction",
      "transition",
      "unknown",
    ])
    .nullable(),
  retryOf: z.string().nullable(),
  usage: z.unknown().nullable(),
});

const contextSnapshotSchema = z.object({
  id: z.string(),
  kind: z.enum(["block", "outline-card", "finding"]),
  chapterId: z.string(),
  sourceId: z.string(),
  order: z.number().int(),
  sourceType: z.string(),
  label: z.string(),
  exactText: z.string(),
  sourceFingerprint: z.string(),
});

const agentToolSummarySchema = z
  .object({
    label: z.string(),
    target: z.string(),
    detail: z.string(),
    itemCount: z.number(),
  })
  .strict();

const completedAgentToolOutputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("runtime"),
      summary: agentToolSummarySchema,
      value: z.unknown(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("summary"),
      summary: agentToolSummarySchema,
    })
    .strict(),
]);

type AgentToolName = keyof AgentUiTools;

interface AgentToolDescriptor {
  title: string;
  targetFallback: string;
  itemName: string;
}

const agentToolDescriptors: Record<AgentToolName, AgentToolDescriptor> = {
  read_chapter: {
    title: "Read chapter",
    targetFallback: "Chapter",
    itemName: "block",
  },
  read_outline: {
    title: "Read outline",
    targetFallback: "Outline",
    itemName: "card",
  },
  read_lore: {
    title: "Read lore",
    targetFallback: "Lore",
    itemName: "entry",
  },
  run_critique: {
    title: "Run critique",
    targetFallback: "Chapter",
    itemName: "finding",
  },
  run_continuity: {
    title: "Check continuity",
    targetFallback: "Chapter",
    itemName: "finding",
  },
  read_conversation_context: {
    title: "Read conversation context",
    targetFallback: "Conversation",
    itemName: "message",
  },
  read_pending_proposal: {
    title: "Read proposal",
    targetFallback: "Proposal",
    itemName: "change",
  },
  stage_manuscript_proposal: {
    title: "Stage manuscript proposal",
    targetFallback: "Manuscript proposal",
    itemName: "change",
  },
  stage_outline_proposal: {
    title: "Stage outline proposal",
    targetFallback: "Outline proposal",
    itemName: "change",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolName(part: AgentUIMessage["parts"][number]): AgentToolName {
  const name =
    part.type === "dynamic-tool"
      ? part.toolName
      : part.type.startsWith("tool-")
        ? part.type.slice("tool-".length)
        : "";
  if (!Object.hasOwn(agentToolDescriptors, name)) {
    throw new Error("Unknown agent tool cannot be persisted.");
  }
  return name as AgentToolName;
}

function containsAbsolutePath(value: string): boolean {
  return (
    /(^|[\s("'=])\/(?!\/)\S+/.test(value) ||
    /(^|[\s("'=])[A-Za-z]:[\\/]\S+/.test(value) ||
    /(^|[\s("'=])\\\\[^\\\s]+\\/.test(value) ||
    /\bfile:\/\/\//i.test(value)
  );
}

function safeTarget(value: unknown, fallback: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    containsAbsolutePath(value)
  ) {
    return fallback;
  }
  return value;
}

function inputValue(input: unknown, key: string): unknown {
  return isRecord(input) ? input[key] : undefined;
}

function safeCompletedToolInput(name: AgentToolName, input: unknown): unknown {
  const descriptor = agentToolDescriptors[name];
  switch (name) {
    case "read_chapter":
      return {
        chapterId: safeTarget(
          inputValue(input, "chapterId"),
          descriptor.targetFallback,
        ),
      };
    case "read_outline": {
      const chapterId = inputValue(input, "chapterId");
      return {
        chapterId:
          chapterId === null
            ? null
            : safeTarget(chapterId, descriptor.targetFallback),
      };
    }
    case "read_lore":
      return { query: null };
    case "run_critique":
    case "run_continuity":
      return {
        chapterId: safeTarget(
          inputValue(input, "chapterId"),
          descriptor.targetFallback,
        ),
        focus: null,
      };
    case "read_conversation_context":
      return { messageIds: [] };
    case "read_pending_proposal":
      return {
        proposalId: safeTarget(
          inputValue(input, "proposalId"),
          descriptor.targetFallback,
        ),
      };
    case "stage_manuscript_proposal":
    case "stage_outline_proposal":
      return { summary: "", changes: [] };
  }
}

function genericFailedToolInput(name: AgentToolName): unknown {
  const descriptor = agentToolDescriptors[name];
  switch (name) {
    case "read_chapter":
    case "read_outline":
      return { chapterId: descriptor.targetFallback };
    case "read_lore":
      return { query: null };
    case "run_critique":
    case "run_continuity":
      return {
        chapterId: descriptor.targetFallback,
        focus: null,
      };
    case "read_conversation_context":
      return { messageIds: [] };
    case "read_pending_proposal":
      return { proposalId: descriptor.targetFallback };
    case "stage_manuscript_proposal":
    case "stage_outline_proposal":
      return { summary: "", changes: [] };
  }
}

function countDetail(name: AgentToolName, count: number): string {
  const itemName = agentToolDescriptors[name].itemName;
  return `${count} ${itemName}${count === 1 ? "" : "s"}`;
}

function safeToolSummary(
  name: AgentToolName,
  summary: AgentToolSummary,
): AgentToolSummary {
  const descriptor = agentToolDescriptors[name];
  return {
    label: descriptor.title,
    target: safeTarget(summary.target, descriptor.targetFallback),
    detail: countDetail(name, summary.itemCount),
    itemCount: summary.itemCount,
  };
}

const dataSchemas = {
  context: z.object({ snapshots: z.array(contextSnapshotSchema) }),
  "proposal-event": z.object({
    proposalId: z.string(),
    action: z.enum([
      "staged",
      "accepted",
      "accepted-all",
      "rejected",
      "rejected-all",
    ]),
    changeCount: z.number().int(),
    text: z.string(),
  }),
  compaction: z.object({
    throughMessageId: z.string(),
    text: z.string(),
  }),
  findings: z.object({
    kind: z.enum(["critique", "continuity"]),
    chapterId: z.string(),
    items: z.array(z.custom<CritiqueNote | ContinuityFlag>()),
  }),
};

export type AgentMessageTools = ToolSet;

export async function validateAgentMessages(
  messages: unknown,
  tools?: AgentMessageTools,
): Promise<AgentUIMessage[]> {
  if (Array.isArray(messages) && messages.length === 0) return [];
  const emptyErrorIndexes = new Set<number>();
  const validationInput = Array.isArray(messages)
    ? messages.map((message, index) => {
        if (
          typeof message !== "object" ||
          message === null ||
          !("role" in message) ||
          message.role !== "assistant" ||
          !("metadata" in message) ||
          typeof message.metadata !== "object" ||
          message.metadata === null ||
          !("state" in message.metadata) ||
          message.metadata.state !== "error" ||
          !("parts" in message) ||
          !Array.isArray(message.parts) ||
          message.parts.length !== 0
        ) {
          return message;
        }
        emptyErrorIndexes.add(index);
        return { ...message, parts: [{ type: "text", text: "" }] };
      })
    : messages;
  const validatedInput = await validateUIMessages<AgentUIMessage>({
    messages: validationInput,
    metadataSchema,
    dataSchemas,
    tools,
  });
  const validated = validatedInput.map((message, index) =>
    emptyErrorIndexes.has(index) ? { ...message, parts: [] } : message,
  );
  if (validated.some((message) => message.role === "system")) {
    throw new Error("System messages cannot be persisted in the agent conversation.");
  }
  return validated;
}

function summaryOnly(
  name: AgentToolName,
  output: unknown,
): AgentToolOutput<never> {
  const parsed = completedAgentToolOutputSchema.safeParse(output);
  if (!parsed.success) {
    throw new Error("Completed agent tool output is not safe to persist.");
  }
  return {
    kind: "summary",
    summary: safeToolSummary(name, parsed.data.summary),
  } satisfies AgentToolOutput<never>;
}

function settledToolProjection(
  part: AgentUIMessage["parts"][number],
): AgentUIMessage["parts"][number] | null {
  if (!isToolOrDynamicToolUIPart(part)) {
    throw new Error("Agent tool projection requires a tool part.");
  }
  if (
    part.state !== "output-available" &&
    part.state !== "output-error" &&
    part.state !== "output-denied"
  ) {
    return null;
  }
  if (part.state === "output-available" && part.preliminary === true) {
    return null;
  }
  const name = toolName(part);
  const identity =
    part.type === "dynamic-tool"
      ? {
          type: "dynamic-tool" as const,
          toolName: name,
          toolCallId: part.toolCallId,
        }
      : {
          type: `tool-${name}` as const,
          toolCallId: part.toolCallId,
        };
  if (part.state === "output-available") {
    return {
      ...identity,
      state: "output-available",
      input: safeCompletedToolInput(name, part.input),
      output: summaryOnly(name, part.output),
    } as AgentUIMessage["parts"][number];
  }
  const input = genericFailedToolInput(name);
  if (part.state === "output-error") {
    return {
      ...identity,
      state: "output-error",
      input,
      errorText: "Tool execution failed.",
    } as AgentUIMessage["parts"][number];
  }
  return {
    ...identity,
    state: "output-denied",
    input,
    approval: {
      id: part.toolCallId,
      approved: false,
    },
  } as AgentUIMessage["parts"][number];
}

export function sanitizeAgentMessages(
  messages: AgentUIMessage[],
): AgentUIMessage[] {
  return messages.flatMap((message) => {
    if (
      message.role === "assistant" &&
      message.metadata?.state === "streaming"
    ) {
      return [];
    }
    return [{
      ...message,
      metadata:
        message.metadata === undefined
          ? undefined
          : ({ ...message.metadata } satisfies AgentMessageMetadata),
      parts: message.parts.flatMap((part): AgentUIMessage["parts"] => {
        if (part.type === "reasoning") return [];
        if (
          part.type !== "text" &&
          part.type !== "source-url" &&
          part.type !== "source-document" &&
          part.type !== "file" &&
          part.type !== "step-start" &&
          part.type !== "data-context" &&
          part.type !== "data-proposal-event" &&
          part.type !== "data-compaction" &&
          part.type !== "data-findings" &&
          part.type !== "dynamic-tool" &&
          part.type !== "tool-read_chapter" &&
          part.type !== "tool-read_outline" &&
          part.type !== "tool-read_lore" &&
          part.type !== "tool-run_critique" &&
          part.type !== "tool-run_continuity" &&
          part.type !== "tool-read_conversation_context" &&
          part.type !== "tool-read_pending_proposal" &&
          part.type !== "tool-stage_manuscript_proposal" &&
          part.type !== "tool-stage_outline_proposal"
        ) {
          throw new Error("Unknown agent message part cannot be persisted.");
        }
        if (part.type === "text") {
          return [{ ...part, state: "done" }];
        }
        if (isToolOrDynamicToolUIPart(part)) {
          const projected = settledToolProjection(part);
          return projected === null ? [] : [projected];
        }
        return [{ ...part }];
      }),
    }];
  });
}

function renderSnapshots(snapshots: ContextSnapshot[]): string {
  return [
    "ATTACHED MANUSCRIPT CONTEXT:",
    ...snapshots.map(
      (snapshot) =>
        `[${snapshot.kind}:${snapshot.chapterId}:${snapshot.sourceId}] ${snapshot.label}\n${snapshot.exactText}`,
    ),
  ].join("\n\n");
}

export async function convertAgentMessagesToModel(
  messages: AgentUIMessage[],
  tools: AgentMessageTools,
): Promise<ModelMessage[]> {
  const validated = await validateAgentMessages(messages, tools);
  const sanitized = sanitizeAgentMessages(validated);
  return convertToModelMessages<AgentUIMessage>(sanitized, {
    tools,
    ignoreIncompleteToolCalls: true,
    convertDataPart: (part) => {
      if (part.type === "data-context") {
        return { type: "text", text: renderSnapshots(part.data.snapshots) };
      }
      if (part.type === "data-compaction") {
        return { type: "text", text: part.data.text };
      }
      if (part.type === "data-proposal-event") {
        return { type: "text", text: part.data.text };
      }
      if (part.type === "data-findings") {
        return { type: "text", text: JSON.stringify(part.data) };
      }
      return undefined;
    },
  });
}
