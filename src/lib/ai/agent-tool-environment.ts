import type { LanguageModel } from "ai";
import { blockFingerprint, cardFingerprint } from "@/lib/ai/agent-context";
import {
  buildManuscriptPendingProposal,
  buildOverviewPendingProposal,
  buildOutlinePendingProposal,
} from "@/lib/ai/agent-proposals";
import {
  loadChapterSnapshot,
  messageSnapshots,
  targetChapterId,
  textExcerpt,
  type LoadedChapter,
} from "@/lib/ai/agent-submission-context";
import type { AgentToolEnvironment } from "@/lib/ai/agent-tools";
import type {
  AgentFailureReason,
  AgentRun,
  AgentSessionId,
  AgentUIMessage,
  ChapterToolValue,
  ConversationContextToolValue,
  LoreToolValue,
  OutlineToolValue,
  PendingProposal,
} from "@/lib/ai/agent-types";
import { critique, continuityCheck, type AnchoredContext } from "@/lib/ai/operations";
import { renderStoryStructure } from "@/lib/outline/grounding";
import { getChapterOutline } from "@/lib/outline/model";
import { emptyCharacterProfile } from "@/lib/story-knowledge/model";
import type { ProjectInfo, ProjectMeta } from "@/lib/types";
import { agentSessionStore, selectPendingProposal } from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";

interface ErrorWithDetails extends Error {
  statusCode?: number;
  status?: number;
  responseBody?: string;
  cause?: unknown;
  agentFailureReason?: AgentFailureReason;
}

interface AgentToolEnvironmentInput {
  run: AgentRun;
  model: LanguageModel;
  styleGuide: string;
  editingRules: string;
  project: ProjectInfo;
  meta: ProjectMeta;
  targetChapter: LoadedChapter | null;
  history: AgentUIMessage[];
  assistantMessageId: string;
  signal: AbortSignal;
  sessionId: AgentSessionId;
  checkRun: () => void;
  ownsRun: () => boolean;
  makeId: () => string;
  now: () => string;
  stageProposal: (proposal: PendingProposal) => void;
}

function outlineValue(
  project: ProjectInfo,
  meta: ProjectMeta,
  chapterId: string | null,
): OutlineToolValue {
  const selected =
    chapterId === null
      ? project.chapters
      : project.chapters.filter((chapter) => chapter.id === chapterId);
  if (chapterId !== null && selected.length === 0) {
    throw new Error(`Outline chapter not found: ${chapterId}`);
  }
  return {
    premise: meta.outline.premise,
    overview: meta.outline.overview,
    characters: meta.characters.map((character) => ({
      ...character,
      profile: { ...character.profile },
    })),
    chapters: selected.map((chapter) => {
      const outline = getChapterOutline(meta.chapters, chapter.id);
      return {
        chapterId: chapter.id,
        title: chapter.title,
        act: outline.act,
        plotPoint: outline.plotPoint,
        premise: outline.premise,
        goal: outline.goal,
        conflict: outline.conflict,
        turn: outline.turn,
        characterIds: [...outline.characterIds],
        cards: outline.cards.map((card, order) => ({
          id: card.id,
          order,
          title: card.title,
          intention: card.intention,
          characterIds: [...card.characterIds],
          loreIds: [...card.loreIds],
          continuityFlags: structuredClone(card.continuityFlags),
          fingerprint: cardFingerprint(card),
        })),
      };
    }),
  };
}

function loreValue(meta: ProjectMeta, query: string | null): LoreToolValue {
  const normalized = query?.trim().toLocaleLowerCase() ?? null;
  const entries =
    normalized === null || normalized.length === 0
      ? meta.lore
      : meta.lore.filter((entry) =>
          [entry.title, entry.description, ...entry.tags].some((value) =>
            value.toLocaleLowerCase().includes(normalized),
          ),
        );
  return {
    entries: entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      description: entry.description,
      characterIds: [...entry.characterIds],
      tags: [...entry.tags],
    })),
  };
}

function conversationValue(
  messages: AgentUIMessage[],
  messageIds: string[],
): ConversationContextToolValue {
  const requested = new Set(messageIds);
  return {
    messages: messages.flatMap((message) =>
      requested.has(message.id) && message.role !== "system"
        ? [
            {
              id: message.id,
              role: message.role,
              excerpt: textExcerpt(message),
              snapshots: messageSnapshots(message),
            },
          ]
        : [],
    ),
  };
}

function anchoredContext(
  chapter: LoadedChapter,
  meta: ProjectMeta,
  focus: string | null,
): AnchoredContext {
  const prose = chapter.blocks.filter(
    (block) =>
      block.type === "narration" ||
      block.type === "dialogue" ||
      (block.type === "chapter" && block.level !== "break"),
  );
  const structure = renderStoryStructure({
    outline: meta.outline,
    chapters: meta.chapters,
    characters: meta.characters,
    activeChapterId: chapter.chapterId,
  });
  const outline = getChapterOutline(meta.chapters, chapter.chapterId);
  const relevantCharacterIds = new Set([
    ...prose.flatMap((block) =>
      block.type === "dialogue" && block.speaker !== undefined
        ? [block.speaker]
        : [],
    ),
    ...outline.characterIds,
    ...outline.cards.flatMap((card) => card.characterIds),
    ...(meta.knowledge.chapters[chapter.chapterId]?.characterObservations.map(
      (observation) => observation.characterId,
    ) ?? []),
  ]);
  return {
    chapterTitle: chapter.title,
    cursorSummary: "Reviewing the frozen chapter.",
    characters: meta.characters.map((character) => ({
      name: character.name,
      role: character.role,
      profile: relevantCharacterIds.has(character.id)
        ? { ...character.profile }
        : emptyCharacterProfile(),
    })),
    instruction: focus ?? undefined,
    structure: structure ?? undefined,
    blocks: prose.map((block) => ({
      id: block.id,
      type: block.type,
      text: block.text,
    })),
  };
}

export function errorDetails(error: unknown): string {
  if (typeof error === "string") return error;
  if (!(error instanceof Error)) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  const detailed: ErrorWithDetails = error;
  const details: string[] = [];
  const status = detailed.statusCode ?? detailed.status;
  if (status !== undefined) details.push(`HTTP ${status}`);
  if (detailed.message.length > 0) details.push(detailed.message);
  const responseBody = detailed.responseBody;
  if (
    responseBody !== undefined &&
    !details.some((part) => part.includes(responseBody))
  ) {
    details.push(responseBody);
  }
  if (detailed.cause !== undefined && detailed.cause !== error) {
    const cause =
      detailed.cause instanceof Error
        ? detailed.cause.message
        : String(detailed.cause);
    if (!details.some((part) => part.includes(cause))) {
      details.push(`cause: ${cause}`);
    }
  }
  return details.join(" - ") || detailed.name;
}

export function taggedError(
  reason: AgentFailureReason,
  error: unknown,
): ErrorWithDetails {
  return Object.assign(new Error(errorDetails(error), { cause: error }), {
    agentFailureReason: reason,
  });
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function createAgentToolEnvironment(
  args: AgentToolEnvironmentInput,
): AgentToolEnvironment {
  const chapterSnapshots = new Map<string, ChapterToolValue>();
  if (args.targetChapter !== null) {
    chapterSnapshots.set(args.targetChapter.chapterId, {
      chapterId: args.targetChapter.chapterId,
      title: args.targetChapter.title,
      blocks: args.targetChapter.blocks.map((block, order) => ({
        id: block.id,
        order,
        type: block.type,
        text: block.text,
        fingerprint: blockFingerprint(block),
      })),
    });
  }
  const requireTarget = (chapterId: string): LoadedChapter => {
    args.checkRun();
    if (
      args.targetChapter === null ||
      args.targetChapter.chapterId !== chapterId
    ) {
      throw taggedError(
        "tool",
        new Error(`Chapter is outside the frozen run target: ${chapterId}`),
      );
    }
    return args.targetChapter;
  };
  const currentPending = (): PendingProposal | null => {
    args.checkRun();
    const state = agentSessionStore(args.sessionId).getState();
    return args.run.task.kind === "proposal-follow-up"
      ? selectPendingProposal(state, args.run.task.proposalId)
      : state.pendingProposal;
  };
  return {
    run: args.run,
    signal: args.signal,
    readChapter: async (chapterId) => {
      args.checkRun();
      const cached = chapterSnapshots.get(chapterId);
      if (cached !== undefined) return structuredClone(cached);
      try {
        const chapter = await loadChapterSnapshot(
          args.project,
          chapterId,
          args.targetChapter,
        );
        args.checkRun();
        const snapshot: ChapterToolValue = {
          chapterId: chapter.chapterId,
          title: chapter.title,
          blocks: chapter.blocks.map((block, order) => ({
            id: block.id,
            order,
            type: block.type,
            text: block.text,
            fingerprint: blockFingerprint(block),
          })),
        };
        chapterSnapshots.set(chapterId, snapshot);
        return structuredClone(snapshot);
      } catch (error) {
        if (isAbortError(error)) throw error;
        throw taggedError("tool", error);
      }
    },
    readOutline: async (chapterId) => {
      args.checkRun();
      return outlineValue(args.project, args.meta, chapterId);
    },
    readLore: async (query) => {
      args.checkRun();
      return loreValue(args.meta, query);
    },
    runCritique: async (chapterId, focus, signal) => {
      const chapter = requireTarget(chapterId);
      try {
        const result = await critique(
          anchoredContext(chapter, args.meta, focus),
          {
            signal,
            model: args.model,
            preferences: {
              styleGuide: args.styleGuide,
              editingRules: args.editingRules,
            },
          },
        );
        args.checkRun();
        return result;
      } catch (error) {
        if (isAbortError(error)) throw error;
        throw taggedError("tool", error);
      }
    },
    runContinuity: async (chapterId, focus, signal) => {
      const chapter = requireTarget(chapterId);
      try {
        const result = await continuityCheck(
          anchoredContext(chapter, args.meta, focus),
          {
            signal,
            model: args.model,
            preferences: {
              styleGuide: args.styleGuide,
              editingRules: args.editingRules,
            },
          },
        );
        args.checkRun();
        return result;
      } catch (error) {
        if (isAbortError(error)) throw error;
        throw taggedError("tool", error);
      }
    },
    readConversationContext: (messageIds) => {
      args.checkRun();
      return conversationValue(args.history, messageIds);
    },
    getPendingProposal: currentPending,
    buildManuscriptProposal: (input) => {
      const chapterId = targetChapterId(
        args.run.task,
        currentPending(),
        args.sessionId,
      );
      if (chapterId === null) {
        throw taggedError(
          "tool",
          new Error("The frozen run has no manuscript target."),
        );
      }
      const chapter = requireTarget(chapterId);
      try {
        return buildManuscriptPendingProposal({
          run: args.run,
          raw: { chapterId, ...input },
          blocks: chapter.blocks,
          currentPending: currentPending(),
          originatingMessageId: args.assistantMessageId,
          makeId: args.makeId,
          now: args.now(),
          currentOverview: args.meta.outline.overview,
          overviewReplacement: input.overview,
        });
      } catch (error) {
        throw taggedError("tool", error);
      }
    },
    buildOutlineProposal: (input) => {
      const chapterId = targetChapterId(
        args.run.task,
        currentPending(),
        args.sessionId,
      );
      if (chapterId === null) {
        throw taggedError(
          "tool",
          new Error("The frozen run has no outline target."),
        );
      }
      requireTarget(chapterId);
      const cards = getChapterOutline(args.meta.chapters, chapterId).cards;
      try {
        return buildOutlinePendingProposal({
          run: args.run,
          raw: { chapterId, ...input },
          cards,
          currentPending: currentPending(),
          originatingMessageId: args.assistantMessageId,
          makeId: args.makeId,
          now: args.now(),
          currentOverview: args.meta.outline.overview,
          overviewReplacement: input.overview,
        });
      } catch (error) {
        throw taggedError("tool", error);
      }
    },
    buildOverviewProposal: (input) => {
      if (args.sessionId.kind === "character") {
        throw taggedError(
          "tool",
          new Error(
            "The frozen character run cannot stage source changes.",
          ),
        );
      }
      try {
        return buildOverviewPendingProposal({
          run: args.run,
          currentPending: currentPending(),
          summary: input.summary,
          overview: input.overview,
          reason: input.reason,
          currentOverview: args.meta.outline.overview,
          originatingMessageId: args.assistantMessageId,
          makeId: args.makeId,
          now: args.now(),
        });
      } catch (error) {
        throw taggedError("tool", error);
      }
    },
    replacePendingProposal: (proposal) => {
      if (!args.ownsRun()) return;
      args.stageProposal(proposal);
    },
    updateCharacterProfile: async ({ characterId, profile }) => {
      args.checkRun();
      if (
        args.sessionId.kind !== "character" ||
        args.run.task.kind !== "character-describe" ||
        args.sessionId.characterId !== characterId ||
        args.run.task.characterId !== characterId
      ) {
        throw taggedError(
          "tool",
          new Error(
            `Character update is outside the frozen target: ${characterId}`,
          ),
        );
      }
      const live = useProjectStore.getState();
      const current = live.meta.characters.find(
        (character) => character.id === characterId,
      );
      if (current === undefined) {
        throw taggedError(
          "tool",
          new Error(`Character not found: ${characterId}`),
        );
      }
      const nextProfile = { ...current.profile, ...profile };
      const character = await live.applyCharacterProfileFromAgent(
        args.run.projectRoot,
        characterId,
        nextProfile,
      );
      args.checkRun();
      return character;
    },
  };
}
