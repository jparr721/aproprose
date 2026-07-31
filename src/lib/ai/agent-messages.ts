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
  AgentUIMessage,
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
    .enum(["configuration", "transport", "tool", "compaction", "unknown"])
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
  const validated = await validateUIMessages<AgentUIMessage>({
    messages,
    metadataSchema,
    dataSchemas,
    tools,
  });
  if (validated.some((message) => message.role === "system")) {
    throw new Error("System messages cannot be persisted in the agent conversation.");
  }
  return validated;
}

function summaryOnly(output: unknown): AgentToolOutput<never> {
  const parsed = completedAgentToolOutputSchema.safeParse(output);
  if (!parsed.success) {
    throw new Error("Completed agent tool output is not safe to persist.");
  }
  const summary = parsed.data.summary;
  return {
    kind: "summary",
    summary: {
      label: summary.label,
      target: summary.target,
      detail: summary.detail,
      itemCount: summary.itemCount,
    },
  } satisfies AgentToolOutput<never>;
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
        if (isToolOrDynamicToolUIPart(part) && part.state === "output-available") {
          return [
            { ...part, output: summaryOnly(part.output) } as AgentUIMessage["parts"][number],
          ];
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
