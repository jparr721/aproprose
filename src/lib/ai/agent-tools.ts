import { tool } from "ai";
import { z } from "zod";
import type { AgentCapability, PurposeAgentPolicy } from "@/agents";
import type { Book } from "@/book";
import { contentSnapshotRef } from "@/content/record";
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
  ChapterRangeToolValue,
} from "@/lib/ai/agent-types";
import type {
  BlockChange,
  Character,
  CharacterProfile,
  CharacterProfileField,
  CritiqueNote,
  ContinuityFlag,
  SculptChange,
} from "@/lib/types";

export interface AgentToolEnvironment {
  run: AgentRun;
  policy: PurposeAgentPolicy;
  book: Book;
  assertRunOwnership(): void;
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
  updateCharacterProfile: (input: {
    characterId: string;
    profile: Partial<CharacterProfile>;
  }) => Promise<Character>;
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
  const plural = singular === "entry" ? "entries" : singular === "match" ? "matches" : `${singular}s`;
  return `${count} ${count === 1 ? singular : plural}`;
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
const emptyInputSchema = z.strictObject({});
const characterInputSchema = z.strictObject({ characterId: z.string().min(1) });
const chapterRangeInputSchema = z.strictObject({
  chapterId: z.string().min(1),
  start: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(100),
});
const searchInputSchema = z.strictObject({
  query: z.string().min(1),
  chapterIds: z.array(z.string().min(1)).nullable(),
  limit: z.number().int().min(1).max(100),
});
export const authorQuestionSchema = z.strictObject({
  question: z.string().trim().min(1).max(2000),
  rationale: z.string().trim().min(1).max(3000),
  options: z.array(z.string().trim().min(1).max(500)).max(6),
});
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
const CHARACTER_PROFILE_FIELDS: CharacterProfileField[] = [
  "appearance",
  "mannerisms",
  "motivations",
  "relationships",
  "history",
  "voice",
];
const characterProfileUpdateSchema = z.object({
  characterId: z.string(),
  profile: z.object({
    appearance: z.string().nullable(),
    mannerisms: z.string().nullable(),
    motivations: z.string().nullable(),
    relationships: z.string().nullable(),
    history: z.string().nullable(),
    voice: z.string().nullable(),
  }),
});

export function createAgentToolHandlers(env: AgentToolEnvironment) {
  const check = (name: keyof AgentToolSet): void => {
    env.signal.throwIfAborted();
    env.assertRunOwnership();
    assertAgentToolCapability(env.policy, name);
  };
  return {
    askAuthor: async (input: z.infer<typeof authorQuestionSchema>) => {
      check("ask_author");
      const value = authorQuestionSchema.parse(input);
      return runtimeOutput({ label: "Question for author", target: value.question, detail: value.rationale, itemCount: 1 }, value);
    },
    readBookManifest: async (_input: z.infer<typeof emptyInputSchema>) => {
      check("read_book_manifest");
      const value = env.book.manifest();
      return runtimeOutput({ label: "Read book manifest", target: value.name, detail: countLabel(value.chapters.length, "chapter"), itemCount: value.chapters.length }, value);
    },
    readBookMetadata: async (_input: z.infer<typeof emptyInputSchema>) => {
      check("read_book_metadata");
      const value = env.book.metadata();
      return runtimeOutput({ label: "Read book metadata", target: value.title, detail: "Title, author and publication fields", itemCount: Object.keys(value).length }, value);
    },
    readStoryKnowledge: async (_input: z.infer<typeof emptyInputSchema>) => {
      check("read_story_knowledge");
      const value = env.book.knowledge();
      const count = Object.keys(value.chapters).length;
      return runtimeOutput({ label: "Read story knowledge", target: "Derived story observations", detail: countLabel(count, "chapter"), itemCount: count }, value);
    },
    readCharacter: async (input: z.infer<typeof characterInputSchema>) => {
      check("read_character");
      const value = env.book.readCharacter(input.characterId);
      return runtimeOutput({ label: "Read character", target: value.name, detail: "Complete character profile", itemCount: Object.keys(value.profile).length }, value);
    },
    readChapterRange: async (input: z.infer<typeof chapterRangeInputSchema>) => {
      check("read_chapter_range");
      const range = chapterRangeInputSchema.parse(input);
      const record = await env.book.readChapterRecord(range.chapterId);
      check("read_chapter_range");
      if (range.start > record.value.blocks.length) throw new Error(`Chapter range starts outside the chapter: ${range.chapterId}, start=${range.start}, total=${record.value.blocks.length}`);
      const endExclusive = Math.min(range.start + range.limit, record.value.blocks.length);
      const value: ChapterRangeToolValue = {
        chapterId: record.value.chapterId,
        title: record.value.title,
        blocks: record.value.blocks.slice(range.start, endExclusive),
        totalBlocks: record.value.blocks.length,
        start: range.start,
        endExclusive,
        hasMore: endExclusive < record.value.blocks.length,
        source: contentSnapshotRef(record),
      };
      return runtimeOutput({ label: "Read chapter range", target: value.title, detail: `${value.start}-${value.endExclusive} of ${value.totalBlocks} blocks`, itemCount: value.blocks.length }, value);
    },
    searchBook: async (input: z.infer<typeof searchInputSchema>) => {
      check("search_book");
      const value = await env.book.search({
        query: input.query,
        chapterIds: input.chapterIds === null ? env.book.manifest().chapters.map((chapter) => chapter.id) : input.chapterIds,
        limit: input.limit,
      });
      check("search_book");
      return runtimeOutput({ label: "Search book", target: input.query, detail: countLabel(value.matches.length, "match"), itemCount: value.matches.length }, value);
    },
    readChapter: async (input: z.infer<typeof chapterInputSchema>) => {
      check("read_chapter");
      const value = await env.readChapter(input.chapterId);
      check("read_chapter");
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
      check("read_outline");
      const value = await env.readOutline(input.chapterId);
      check("read_outline");
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
      check("read_lore");
      const value = await env.readLore(input.query);
      check("read_lore");
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
      check("run_critique");
      const findings = await env.runCritique(
        input.chapterId,
        input.focus,
        env.signal,
      );
      check("run_critique");
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
      check("run_continuity");
      const findings = await env.runContinuity(
        input.chapterId,
        input.focus,
        env.signal,
      );
      check("run_continuity");
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
      check("read_conversation_context");
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
      check("read_pending_proposal");
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
      check("stage_manuscript_proposal");
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
      check("stage_outline_proposal");
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
      check("stage_overview_proposal");
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
    updateCharacterProfile: async (
      input: z.infer<typeof characterProfileUpdateSchema>,
    ) => {
      check("update_character_profile");
      if (
        env.run.task.kind !== "character-describe" ||
        env.run.task.characterId !== input.characterId
      ) {
        throw new Error(
          `Character update is outside the frozen target: ${input.characterId}`,
        );
      }
      const profile: Partial<CharacterProfile> = {};
      for (const field of CHARACTER_PROFILE_FIELDS) {
        const value = input.profile[field];
        if (value === null) continue;
        const trimmed = value.trim();
        if (trimmed.length > 0) profile[field] = trimmed;
      }
      const changedFieldCount = Object.keys(profile).length;
      if (changedFieldCount === 0) {
        throw new Error("Character profile update requires at least one field.");
      }
      const character = await env.updateCharacterProfile({
        characterId: input.characterId,
        profile,
      });
      return runtimeOutput(
        {
          label: "Update character profile",
          target: character.name,
          detail: countLabel(changedFieldCount, "field"),
          itemCount: changedFieldCount,
        },
        {
          characterId: character.id,
          characterName: character.name,
          changedFieldCount,
        },
      );
    },
  };
}

export function createAgentTools(env: AgentToolEnvironment) {
  const handlers = createAgentToolHandlers(env);
  return {
    ask_author: tool({
      description: "Ask one consequential question grounded in the inspected book. Record the exact question, a concise public explanation of why its answer matters and up to six distinct options (or an empty array for free text). This persisted tool result is an unanswered question; only a genuine subsequent author message answers it. Do not invent approval, answer or confirmation. Repeat the question concisely in the final response.",
      inputSchema: authorQuestionSchema,
      execute: handlers.askAuthor,
    }),
    read_book_manifest: tool({
      description: "Discover this book's chapter ids and order, metadata, planning coverage, character ids and lore ids without loading chapter prose. Use it before retrieving only the sources the task needs.",
      inputSchema: emptyInputSchema,
      execute: handlers.readBookManifest,
    }),
    read_book_metadata: tool({
      description: "Read the book's exact title, subtitle, author, publisher and ISBN from the frozen book view.",
      inputSchema: emptyInputSchema,
      execute: handlers.readBookMetadata,
    }),
    read_story_knowledge: tool({
      description: "Read derived chapter summaries, story signals, character observations, candidate evidence and accepted/dismissed observation history. Treat observations as retrieval leads and check original prose before asserting a contradiction.",
      inputSchema: emptyInputSchema,
      execute: handlers.readStoryKnowledge,
    }),
    read_character: tool({
      description: "Read a character's complete existing identity, role and six profile fields without updating it. Discover ids through read_book_manifest or read_outline.",
      inputSchema: characterInputSchema,
      execute: handlers.readCharacter,
    }),
    read_chapter_range: tool({
      description: "Read up to 100 complete semantic blocks from a chapter's zero-based start. Includes speakers, chained dialogue, lore/scratch notes, scene levels and exact citation text, plus total and inspected range. Retrieve subsequent ranges before claiming full chapter coverage.",
      inputSchema: chapterRangeInputSchema,
      execute: handlers.readChapterRange,
    }),
    search_book: tool({
      description: "Search exact manuscript block text, full dialogue and chapter notes. Supply chapter ids or null to search the book lazily. Returns up to 100 complete matching blocks with frozen source refs and explicit inspected/uninspected chapter coverage. A limited result is not proof that later matches are absent.",
      inputSchema: searchInputSchema,
      execute: handlers.searchBook,
    }),
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
    update_character_profile: tool({
      description:
        "Update profile fields for the character frozen into this Describe session after the conversation yields profile-worthy detail.",
      inputSchema: characterProfileUpdateSchema,
      execute: handlers.updateCharacterProfile,
    }),
  };
}

export type AgentToolSet = ReturnType<typeof createAgentTools>;

const toolCapabilities = [
  ["ask_author", "ask-author"],
  ["read_book_manifest", "read-book"],
  ["read_book_metadata", "read-book"],
  ["read_story_knowledge", "read-book"],
  ["read_character", "read-book"],
  ["read_chapter_range", "read-book"],
  ["search_book", "read-book"],
  ["read_chapter", "read-book"],
  ["read_outline", "read-book"],
  ["read_lore", "read-book"],
  ["read_conversation_context", "read-book"],
  ["read_pending_proposal", "read-book"],
  ["run_critique", "analyze-chapter"],
  ["run_continuity", "analyze-chapter"],
  ["stage_manuscript_proposal", "stage-manuscript"],
  ["stage_outline_proposal", "stage-outline"],
  ["stage_overview_proposal", "stage-overview"],
  ["update_character_profile", "update-character"],
] satisfies Array<[keyof AgentToolSet, AgentCapability]>;

export function activeAgentTools(capabilities: readonly AgentCapability[]): Array<keyof AgentToolSet> {
  return toolCapabilities.filter(([, capability]) => capabilities.includes(capability)).map(([name]) => name);
}

export function assertAgentToolCapability(policy: PurposeAgentPolicy, toolName: keyof AgentToolSet): void {
  const entry = toolCapabilities.find(([name]) => name === toolName);
  if (entry === undefined) throw new Error(`Agent tool has no capability declaration: ${toolName}`);
  if (!policy.capabilities.includes(entry[1])) throw new Error(`Agent tool is not permitted for action ${policy.action}: ${toolName}`);
}
