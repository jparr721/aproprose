import { tool } from "ai";
import { z } from "zod";
import {
  assertProposalCorrelation,
  pendingProposalForModel,
} from "@/lib/ai/agent-proposals";
import type {
  AgentRun,
  AgentToolOutput,
  AgentToolSummary,
  ChapterToolValue,
  ConversationContextToolValue,
  LoreToolValue,
  OutlineToolValue,
  PendingProposal,
} from "@/lib/ai/agent-types";
import type {
  BlockChange,
  CritiqueNote,
  ContinuityFlag,
  SculptChange,
} from "@/lib/types";

export interface AgentToolEnvironment {
  run: AgentRun;
  signal: AbortSignal;
  readChapter: (chapterId: string) => Promise<ChapterToolValue>;
  readOutline: (chapterId: string | null) => Promise<OutlineToolValue>;
  readLore: (query: string | null) => Promise<LoreToolValue>;
  runCritique: (
    chapterId: string,
    focus: string | null,
    signal: AbortSignal,
  ) => Promise<CritiqueNote[]>;
  runContinuity: (
    chapterId: string,
    focus: string | null,
    signal: AbortSignal,
  ) => Promise<ContinuityFlag[]>;
  readConversationContext: (
    messageIds: string[],
  ) => ConversationContextToolValue;
  getPendingProposal: () => PendingProposal | null;
  buildManuscriptProposal: (input: {
    summary: string;
    changes: BlockChange[];
    overview?: string | null;
  }) => Extract<PendingProposal, { kind: "manuscript" }>;
  buildOutlineProposal: (input: {
    summary: string;
    changes: SculptChange[];
    overview?: string | null;
  }) => Extract<PendingProposal, { kind: "outline" }>;
  buildOverviewProposal: (input: {
    summary: string;
    overview: string;
    reason: string;
  }) => Extract<PendingProposal, { kind: "overview" }>;
  replacePendingProposal: (proposal: PendingProposal) => void;
}

function runtimeOutput<T>(
  summary: AgentToolSummary,
  value: T,
): AgentToolOutput<T> {
  return { kind: "runtime", summary, value };
}

export function agentToolOutputSummary(
  output: AgentToolOutput<unknown>,
): AgentToolSummary {
  return output.summary;
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

const manuscriptChangeSchema = z.object({
  kind: z.enum(["rewrite", "insert", "remove", "move"]),
  blockId: z.string().nullable(),
  afterId: z.string().nullable(),
  type: z.enum(["narration", "dialogue"]).nullable(),
  speaker: z.string().nullable(),
  newText: z.string().nullable(),
  toIndex: z.number().int().nullable(),
  reason: z.string(),
});

const outlineChangeSchema = z.object({
  kind: z.enum(["rewrite", "add", "move", "remove"]),
  cardId: z.string().nullable(),
  title: z.string().nullable(),
  intention: z.string().nullable(),
  toIndex: z.number().int().nullable(),
  reason: z.string(),
});

const chapterInputSchema = z.object({ chapterId: z.string() });
const outlineInputSchema = z.object({ chapterId: z.string().nullable() });
const loreInputSchema = z.object({ query: z.string().nullable() });
const analysisInputSchema = z.object({
  chapterId: z.string(),
  focus: z.string().nullable(),
});
const conversationInputSchema = z.object({
  messageIds: z.array(z.string()),
});
const pendingInputSchema = z.object({ proposalId: z.string() });
const manuscriptStageSchema = z.object({
  summary: z.string(),
  changes: z.array(manuscriptChangeSchema),
  overview: z.string().nullable().optional(),
});
const outlineStageSchema = z.object({
  summary: z.string(),
  changes: z.array(outlineChangeSchema),
  overview: z.string().nullable().optional(),
});
const overviewStageSchema = z.object({
  summary: z.string(),
  overview: z.string(),
  reason: z.string(),
});

export function createAgentToolHandlers(env: AgentToolEnvironment) {
  return {
    readChapter: async (input: z.infer<typeof chapterInputSchema>) => {
      const value = await env.readChapter(input.chapterId);
      const count = value.blocks.length;
      return runtimeOutput(
        {
          label: "Read chapter",
          target: value.title,
          detail: countLabel(count, "block"),
          itemCount: count,
        },
        value,
      );
    },
    readOutline: async (input: z.infer<typeof outlineInputSchema>) => {
      const value = await env.readOutline(input.chapterId);
      const count = value.chapters.reduce(
        (total, chapter) => total + chapter.cards.length,
        0,
      );
      return runtimeOutput(
        {
          label: "Read outline",
          target: input.chapterId ?? "Whole outline",
          detail: countLabel(count, "card"),
          itemCount: count,
        },
        value,
      );
    },
    readLore: async (input: z.infer<typeof loreInputSchema>) => {
      const value = await env.readLore(input.query);
      const count = value.entries.length;
      return runtimeOutput(
        {
          label: "Read lore",
          target: input.query ?? "Project lore",
          detail: countLabel(count, "entry"),
          itemCount: count,
        },
        value,
      );
    },
    runCritique: async (input: z.infer<typeof analysisInputSchema>) => {
      const findings = await env.runCritique(
        input.chapterId,
        input.focus,
        env.signal,
      );
      return runtimeOutput(
        {
          label: "Run critique",
          target: input.chapterId,
          detail: countLabel(findings.length, "finding"),
          itemCount: findings.length,
        },
        { findings },
      );
    },
    runContinuity: async (input: z.infer<typeof analysisInputSchema>) => {
      const findings = await env.runContinuity(
        input.chapterId,
        input.focus,
        env.signal,
      );
      return runtimeOutput(
        {
          label: "Check continuity",
          target: input.chapterId,
          detail: countLabel(findings.length, "finding"),
          itemCount: findings.length,
        },
        { findings },
      );
    },
    readConversationContext: async (
      input: z.infer<typeof conversationInputSchema>,
    ) => {
      const value = env.readConversationContext(input.messageIds);
      return runtimeOutput(
        {
          label: "Read conversation context",
          target: "Conversation archive",
          detail: countLabel(value.messages.length, "message"),
          itemCount: value.messages.length,
        },
        value,
      );
    },
    readPendingProposal: async (
      input: z.infer<typeof pendingInputSchema>,
    ) => {
      const pending = env.getPendingProposal();
      if (pending === null || pending.id !== input.proposalId) {
        throw new Error(`Pending proposal not found: ${input.proposalId}`);
      }
      const value = pendingProposalForModel(pending);
      return runtimeOutput(
        {
          label: "Read pending proposal",
          target: pending.chapterId ?? "Story overview",
          detail: countLabel(
            pending.changes.length + (pending.overviewChange ? 1 : 0),
            "change",
          ),
          itemCount: pending.changes.length + (pending.overviewChange ? 1 : 0),
        },
        value,
      );
    },
    stageManuscript: async (
      input: z.infer<typeof manuscriptStageSchema>,
    ) => {
      const proposal = env.buildManuscriptProposal(input);
      assertProposalCorrelation(proposal);
      env.replacePendingProposal(proposal);
      return runtimeOutput(
        {
          label: "Stage manuscript proposal",
          target: proposal.chapterId,
          detail: countLabel(
            proposal.changes.length + (proposal.overviewChange ? 1 : 0),
            "change",
          ),
          itemCount: proposal.changes.length + (proposal.overviewChange ? 1 : 0),
        },
        {
          proposalId: proposal.id,
          changeCount: proposal.changes.length + (proposal.overviewChange ? 1 : 0),
        },
      );
    },
    stageOutline: async (input: z.infer<typeof outlineStageSchema>) => {
      const proposal = env.buildOutlineProposal(input);
      assertProposalCorrelation(proposal);
      env.replacePendingProposal(proposal);
      return runtimeOutput(
        {
          label: "Stage outline proposal",
          target: proposal.chapterId,
          detail: countLabel(
            proposal.changes.length + (proposal.overviewChange ? 1 : 0),
            "change",
          ),
          itemCount: proposal.changes.length + (proposal.overviewChange ? 1 : 0),
        },
        {
          proposalId: proposal.id,
          changeCount: proposal.changes.length + (proposal.overviewChange ? 1 : 0),
        },
      );
    },
    stageOverview: async (input: z.infer<typeof overviewStageSchema>) => {
      const proposal = env.buildOverviewProposal(input);
      env.replacePendingProposal(proposal);
      return runtimeOutput(
        {
          label: "Stage story overview proposal",
          target: "Story overview",
          detail: "1 change",
          itemCount: 1,
        },
        { proposalId: proposal.id, changeCount: 1 },
      );
    },
  };
}

export function createAgentTools(env: AgentToolEnvironment) {
  const handlers = createAgentToolHandlers(env);
  return {
    read_chapter: tool({
      description:
        "Read ordered blocks and fingerprints for any chapter in the novel before making source-specific claims. Use read_outline first to discover chapter ids. Changes remain limited to the frozen task target.",
      inputSchema: chapterInputSchema,
      execute: handlers.readChapter,
    }),
    read_outline: tool({
      description:
        "Read the whole-novel outline or one chapter's complete planning data, including chapter ids, cast, acts, plot points, goals, conflicts, turns, cards, and lore links.",
      inputSchema: outlineInputSchema,
      execute: handlers.readOutline,
    }),
    read_lore: tool({
      description:
        "Read all or filtered project lore, including linked character ids, without changing it.",
      inputSchema: loreInputSchema,
      execute: handlers.readLore,
    }),
    run_critique: tool({
      description:
        "Run structured, block-linked craft critique for a frozen chapter.",
      inputSchema: analysisInputSchema,
      execute: handlers.runCritique,
    }),
    run_continuity: tool({
      description:
        "Run structured, block-linked continuity analysis for a frozen chapter.",
      inputSchema: analysisInputSchema,
      execute: handlers.runContinuity,
    }),
    read_conversation_context: tool({
      description:
        "Retrieve compacted message excerpts and immutable attachments by stable message id.",
      inputSchema: conversationInputSchema,
      execute: handlers.readConversationContext,
    }),
    read_pending_proposal: tool({
      description:
        "Read the complete current proposal before staging a follow-up replacement.",
      inputSchema: pendingInputSchema,
      execute: handlers.readPendingProposal,
    }),
    stage_manuscript_proposal: tool({
      description:
        "Validate and replace the complete pending manuscript proposal. This never writes the manuscript.",
      inputSchema: manuscriptStageSchema,
      execute: handlers.stageManuscript,
    }),
    stage_outline_proposal: tool({
      description:
        "Validate and replace the complete pending outline proposal. This never writes the outline.",
      inputSchema: outlineStageSchema,
      execute: handlers.stageOutline,
    }),
    stage_overview_proposal: tool({
      description:
        "Stage an independently reviewable replacement for the concise story overview without changing manuscript or outline cards.",
      inputSchema: overviewStageSchema,
      execute: handlers.stageOverview,
    }),
  };
}

export type AgentToolSet = ReturnType<typeof createAgentTools>;
