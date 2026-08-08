import { generateText, type LanguageModel } from "ai";
import {
  COMPACTION_SYSTEM,
  compactionTokenTarget,
  compactConversation,
  messagesForNextRequest,
  shouldCompactConversation,
} from "@/lib/ai/agent-compaction";
import {
  blockFingerprint,
  cardFingerprint,
  draftContextRefKey,
  findingFingerprint,
  flattenMessageFindings,
  resolveDraftSnapshots,
} from "@/lib/ai/agent-context";
import { buildCharacterGrounding } from "@/lib/ai/character-grounding";
import { settleAgentMessages } from "@/lib/ai/agent-messages";
import { getModel } from "@/lib/ai/model";
import { resolveModelContextWindow } from "@/lib/ai/models";
import { buildAgentInstructions } from "@/lib/ai/agent-prompts";
import {
  buildManuscriptPendingProposal,
  buildOverviewPendingProposal,
  buildOutlinePendingProposal,
} from "@/lib/ai/agent-proposals";
import {
  streamAgentRun,
  type AgentToolFailure,
  type StreamAgentRunInput,
  type StreamAgentRunResult,
} from "@/lib/ai/agent-runtime";
import type { AgentToolEnvironment } from "@/lib/ai/agent-tools";
import type {
  AgentFailure,
  AgentFailureReason,
  AgentIntent,
  AgentMessageMetadata,
  AgentMode,
  AgentRun,
  AgentSessionId,
  AgentTask,
  AgentUIMessage,
  ChapterToolValue,
  ContextSnapshot,
  ConversationContextToolValue,
  DraftContextRef,
  DraftContextSource,
  DraftSourceLocator,
  LoreToolValue,
  OutlineToolValue,
  PendingProposal,
  ProposalEventData,
} from "@/lib/ai/agent-types";
import { agentSessionKey, PROJECT_AGENT_SESSION } from "@/lib/ai/agent-types";
import {
  agentFailureDiagnosticCode,
  failureFromError,
  modelUnselectedFailure,
  type AgentFailurePhase,
} from "@/lib/ai/agent-failure";
import { critique, continuityCheck, type AnchoredContext } from "@/lib/ai/operations";
import { uid } from "@/lib/id";
import { parseChapter } from "@/lib/latex";
import { renderStoryStructure } from "@/lib/outline/grounding";
import { getChapterOutline } from "@/lib/outline/model";
import { buildOutlinePlannerGrounding } from "@/lib/outline/planner-grounding";
import type { OutlinePlannerGroundingInput } from "@/lib/outline/planner-grounding";
import { emptyCharacterProfile } from "@/lib/story-knowledge/model";
import {
  appendAgentFailureLog,
  readTextFile,
  type AgentFailureLogEntry,
} from "@/lib/tauri";
import type {
  AiProvider,
  Block,
  Card,
  CritiqueNote,
  ContinuityFlag,
  ProjectInfo,
  ProjectMeta,
} from "@/lib/types";
import {
  type AgentDraftContextResolution,
  agentConsoleOwnershipStatus,
  agentSessionStore,
  requireAgentSessionProject,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useViewStore } from "@/stores/view-store";

export interface AgentControllerDependencies {
  now: () => string;
  id: () => string;
  getModel: (
    provider: AiProvider,
    modelId: string,
  ) => Promise<LanguageModel>;
  getContextWindow: (
    provider: AiProvider,
    modelId: string,
  ) => Promise<number>;
  summarize: (
    model: LanguageModel,
    source: string,
    signal: AbortSignal,
  ) => Promise<string>;
  stream: (input: StreamAgentRunInput) => Promise<StreamAgentRunResult>;
  recordFailure: (entry: AgentFailureLogEntry) => Promise<void>;
}

export type AgentSubmissionOutcome =
  | { status: "success" }
  | { status: "stopped" }
  | { status: "failure"; failure: AgentFailure };

interface ActiveController {
  projectRoot: string;
  sessionId: AgentSessionId;
  runId: string;
  userMessageId: string;
  assistantMessageId: string;
  controller: AbortController;
}

interface LoadedChapterBlock extends Block {
  order: number;
  fingerprint: string;
}

interface LoadedChapter {
  chapterId: string;
  title: string;
  blocks: LoadedChapterBlock[];
}

interface CapturedContextAttachment {
  ref: DraftContextRef;
  revision: number | null;
}

interface ResolvedContextAttachment {
  attachment: CapturedContextAttachment;
  ref: DraftContextRef;
  source: DraftContextSource;
  snapshot: ContextSnapshot | null;
  inputIndex: number;
}

interface ResolvedDraftContext {
  attachments: ResolvedContextAttachment[];
}

interface DraftContextCapture {
  project: ProjectInfo;
  activeChapter: LoadedChapter | null;
  attachments: CapturedContextAttachment[];
  locators: Record<string, DraftSourceLocator>;
  meta: ProjectMeta;
  messages: AgentUIMessage[];
}

function storeContextResolutions(
  resolved: ResolvedDraftContext,
): AgentDraftContextResolution[] {
  return resolved.attachments.map((attachment) => {
    const revision = attachment.attachment.revision;
    if (revision === null) {
      throw new Error("Draft attachment identity is missing.");
    }
    return {
      attachment: { ref: attachment.attachment.ref, revision },
      ref: attachment.ref,
      source: attachment.source,
    };
  });
}

interface SubmissionCapture {
  projectRoot: string;
  sessionId: AgentSessionId;
  project: ProjectInfo;
  meta: ProjectMeta;
  mode: AgentMode;
  task: AgentTask;
  text: string;
  provider: AiProvider;
  modelId: string | null;
  styleGuide: string;
  editingRules: string;
  messages: AgentUIMessage[];
  summary: ReturnType<typeof useAgentConsoleStore.getState>["summary"];
  lastUsage: ReturnType<typeof useAgentConsoleStore.getState>["lastUsage"];
  pendingProposal: PendingProposal | null;
  retryOf: string | null;
  activeChapter: LoadedChapter | null;
  resolveTaskAndTarget: () => Promise<{
    task: AgentTask;
    chapter: LoadedChapter | null;
  }>;
  resolveAttachments: (
    signal: AbortSignal,
    ownsRun: () => boolean,
  ) => Promise<{ refs: DraftContextRef[]; snapshots: ContextSnapshot[] }>;
  enterRun: (
    run: AgentRun,
    userMessage: AgentUIMessage,
  ) => void;
}

class OutlinePlannerGroundingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OutlinePlannerGroundingError";
  }
}

interface ErrorWithDetails extends Error {
  statusCode?: number;
  status?: number;
  responseBody?: string;
  cause?: unknown;
  agentFailureReason?: AgentFailureReason;
}

function cloneBlock(block: Block): Block {
  return {
    ...block,
    tail: block.tail?.map((segment) => ({ ...segment })),
  };
}

function cloneProject(project: ProjectInfo): ProjectInfo {
  return structuredClone(project);
}

function currentProjectAtRoot(projectRoot: string): ProjectInfo {
  const project = useProjectStore.getState().project;
  if (project === null || project.root !== projectRoot) {
    throw new Error(`Agent project is no longer active: ${projectRoot}`);
  }
  return project;
}

function loadedChapter(
  chapterId: string,
  title: string,
  blocks: Block[],
): LoadedChapter {
  return {
    chapterId,
    title,
    blocks: blocks.map((block, order) => {
      const cloned = cloneBlock(block);
      return {
        ...cloned,
        order,
        fingerprint: blockFingerprint(cloned),
      };
    }),
  };
}

function captureActiveChapter(
  project: ProjectInfo,
  activeChapterId: string | null,
  blocks: Block[],
): LoadedChapter | null {
  if (activeChapterId === null) return null;
  const chapter = project.chapters.find(
    (candidate) => candidate.id === activeChapterId,
  );
  if (chapter === undefined) {
    throw new Error(
      `Active chapter does not belong to the frozen project: ${activeChapterId}`,
    );
  }
  return loadedChapter(chapter.id, chapter.title, blocks);
}

async function loadChapterSnapshot(
  project: ProjectInfo,
  chapterId: string,
  activeChapter: LoadedChapter | null,
): Promise<LoadedChapter> {
  currentProjectAtRoot(project.root);
  const chapter = project.chapters.find((candidate) => candidate.id === chapterId);
  if (chapter === undefined) {
    throw new Error(`Chapter does not belong to the frozen project: ${chapterId}`);
  }
  if (activeChapter?.chapterId === chapterId) return activeChapter;
  const source = await readTextFile(project.root, chapter.file);
  currentProjectAtRoot(project.root);
  return loadedChapter(chapterId, chapter.title, parseChapter(source));
}

function unavailableSource(
  ref: DraftContextRef,
  label: string,
): DraftContextSource {
  return {
    ref,
    available: false,
    label,
    preview: "",
    resolved: null,
  };
}

function sourceFromSnapshot(
  ref: DraftContextRef,
  snapshot: ContextSnapshot,
): DraftContextSource {
  const { id: _id, ...resolved } = snapshot;
  return {
    ref,
    available: true,
    label: snapshot.label,
    preview: snapshot.exactText,
    resolved,
  };
}

function snapshotForBlock(
  ref: Extract<DraftContextRef, { kind: "block" }>,
  chapterId: string,
  order: number,
  block: Block,
  makeId: () => string,
): ContextSnapshot {
  return resolveDraftSnapshots(
    [{ ...ref, chapterId, blockId: block.id }],
    {},
    {
      resolveBlock: () => ({ chapterId, order, block }),
      resolveOutlineCard: () => null,
      resolveFinding: () => null,
    },
    makeId,
  )[0];
}

function snapshotForCard(
  ref: Extract<DraftContextRef, { kind: "outline-card" }>,
  chapterId: string,
  order: number,
  card: Card,
  makeId: () => string,
): ContextSnapshot {
  return resolveDraftSnapshots(
    [ref],
    {},
    {
      resolveBlock: () => null,
      resolveOutlineCard: () => ({ chapterId, order, card }),
      resolveFinding: () => null,
    },
    makeId,
  )[0];
}

function snapshotForFinding(
  ref: Extract<DraftContextRef, { kind: "finding" }>,
  chapterId: string,
  order: number,
  finding: CritiqueNote | ContinuityFlag,
  makeId: () => string,
): ContextSnapshot {
  return resolveDraftSnapshots(
    [ref],
    {},
    {
      resolveBlock: () => null,
      resolveOutlineCard: () => null,
      resolveFinding: () => ({ chapterId, order, finding }),
    },
    makeId,
  )[0];
}

function settledFindings(
  messages: AgentUIMessage[],
  chapterId: string,
): Array<{
  id: string;
  order: number;
  finding: CritiqueNote | ContinuityFlag;
}> {
  const findings: Array<{
    id: string;
    order: number;
    finding: CritiqueNote | ContinuityFlag;
  }> = [];
  for (const message of messages) {
    if (message.metadata?.state === "streaming") continue;
    for (const entry of flattenMessageFindings(message)) {
      if (entry.chapterId !== chapterId) continue;
      findings.push({
        id: entry.id,
        order: findings.length,
        finding: entry.finding,
      });
    }
  }
  return findings;
}

function captureDraftContext(args: {
  project: ProjectInfo;
  activeChapter: LoadedChapter | null;
  attachments: CapturedContextAttachment[];
  locators: Record<string, DraftSourceLocator>;
  meta: ProjectMeta;
  messages: AgentUIMessage[];
}): DraftContextCapture {
  const project = cloneProject(args.project);
  const activeChapter =
    args.activeChapter === null
      ? null
      : structuredClone(args.activeChapter);
  const attachments = structuredClone(args.attachments);
  const locators = structuredClone(args.locators);
  if (activeChapter !== null) {
    for (const attachment of attachments) {
      const ref = attachment.ref;
      if (ref.kind !== "block" || ref.chapterId !== activeChapter.chapterId) {
        continue;
      }
      const order = activeChapter.blocks.findIndex(
        (block) => block.id === ref.blockId,
      );
      if (order < 0) continue;
      locators[draftContextRefKey(ref)] = {
        order,
        sourceFingerprint: activeChapter.blocks[order].fingerprint,
      };
    }
  }
  return {
    project,
    activeChapter,
    attachments,
    locators,
    meta: structuredClone(args.meta),
    messages: structuredClone(args.messages),
  };
}

async function resolveDraftContext(args: DraftContextCapture & {
  makeId: () => string;
}): Promise<ResolvedDraftContext> {
  const documents = new Map<string, Promise<LoadedChapter>>();
  const document = (chapterId: string): Promise<LoadedChapter> => {
    const existing = documents.get(chapterId);
    if (existing !== undefined) return existing;
    const loading = loadChapterSnapshot(
      args.project,
      chapterId,
      args.activeChapter,
    );
    documents.set(chapterId, loading);
    return loading;
  };
  const resolvedAttachments: ResolvedContextAttachment[] = [];

  for (const [inputIndex, attachment] of args.attachments.entries()) {
    const originalRef = attachment.ref;
    const locator = args.locators[draftContextRefKey(originalRef)] ?? null;
    if (originalRef.kind === "block") {
      const chapter = await document(originalRef.chapterId);
      const exactOrder = chapter.blocks.findIndex(
        (block) => block.id === originalRef.blockId,
      );
      const relocated =
        exactOrder >= 0
          ? { order: exactOrder, block: chapter.blocks[exactOrder] }
          : locator !== null &&
              chapter.blocks[locator.order] !== undefined &&
              blockFingerprint(chapter.blocks[locator.order]) ===
                locator.sourceFingerprint
            ? { order: locator.order, block: chapter.blocks[locator.order] }
            : null;
      if (relocated === null) {
        resolvedAttachments.push({
          attachment,
          ref: originalRef,
          source: unavailableSource(
            originalRef,
            "Unavailable manuscript block",
          ),
          snapshot: null,
          inputIndex,
        });
        continue;
      }
      const currentRef: DraftContextRef = {
        kind: "block",
        chapterId: originalRef.chapterId,
        blockId: relocated.block.id,
      };
      const snapshot = snapshotForBlock(
        currentRef,
        chapter.chapterId,
        relocated.order,
        relocated.block,
        args.makeId,
      );
      resolvedAttachments.push({
        attachment,
        ref: currentRef,
        source: sourceFromSnapshot(currentRef, snapshot),
        snapshot,
        inputIndex,
      });
      continue;
    }

    if (originalRef.kind === "outline-card") {
      const cards = args.meta.chapters[originalRef.chapterId]?.cards ?? [];
      const order = cards.findIndex((card) => card.id === originalRef.cardId);
      if (order < 0) {
        resolvedAttachments.push({
          attachment,
          ref: originalRef,
          source: unavailableSource(originalRef, "Unavailable outline card"),
          snapshot: null,
          inputIndex,
        });
        continue;
      }
      const snapshot = snapshotForCard(
        originalRef,
        originalRef.chapterId,
        order,
        cards[order],
        args.makeId,
      );
      resolvedAttachments.push({
        attachment,
        ref: originalRef,
        source: sourceFromSnapshot(originalRef, snapshot),
        snapshot,
        inputIndex,
      });
      continue;
    }

    const findings = settledFindings(args.messages, originalRef.chapterId);
    const exact = findings.find(
      ({ id }) => id === originalRef.findingId,
    );
    const relocated =
      exact ??
      (locator !== null &&
      findings[locator.order] !== undefined &&
      findingFingerprint(findings[locator.order].finding) ===
        locator.sourceFingerprint
        ? findings[locator.order]
        : null);
    if (relocated === null) {
      resolvedAttachments.push({
        attachment,
        ref: originalRef,
        source: unavailableSource(originalRef, "Unavailable finding"),
        snapshot: null,
        inputIndex,
      });
      continue;
    }
    const currentRef: DraftContextRef = {
      kind: "finding",
      chapterId: originalRef.chapterId,
      findingId: relocated.id,
    };
    const snapshot = snapshotForFinding(
      currentRef,
      originalRef.chapterId,
      relocated.order,
      relocated.finding,
      args.makeId,
    );
    resolvedAttachments.push({
      attachment,
      ref: currentRef,
      source: sourceFromSnapshot(currentRef, snapshot),
      snapshot,
      inputIndex,
    });
  }

  const winnerByKey = new Map<string, ResolvedContextAttachment>();
  for (const candidate of resolvedAttachments) {
    const key = draftContextRefKey(candidate.ref);
    const current = winnerByKey.get(key);
    if (current === undefined) {
      winnerByKey.set(key, candidate);
      continue;
    }
    const candidateIsExact =
      draftContextRefKey(candidate.attachment.ref) === key;
    const currentIsExact = draftContextRefKey(current.attachment.ref) === key;
    const candidateRevision = candidate.attachment.revision ?? -1;
    const currentRevision = current.attachment.revision ?? -1;
    const candidateOriginalKey = draftContextRefKey(candidate.attachment.ref);
    const currentOriginalKey = draftContextRefKey(current.attachment.ref);
    if (
      (candidateIsExact && !currentIsExact) ||
      (candidateIsExact === currentIsExact &&
        (candidateRevision > currentRevision ||
          (candidateRevision === currentRevision &&
            candidateOriginalKey.localeCompare(currentOriginalKey) < 0)))
    ) {
      winnerByKey.set(key, candidate);
    }
  }
  return {
    attachments: [...winnerByKey.values()].sort(
      (left, right) => left.inputIndex - right.inputIndex,
    ),
  };
}

function targetChapterId(
  task: AgentTask,
  pendingProposal: PendingProposal | null,
  sessionId: AgentSessionId,
): string | null {
  if (task.kind === "conversation") return task.targetChapterId;
  if (task.kind === "character-describe") return null;
  if (task.kind === "proposal-follow-up") {
    if (
      pendingProposal === null ||
      pendingProposal.id !== task.proposalId
    ) {
      throw new Error(`Pending proposal not found: ${task.proposalId}`);
    }
    return pendingProposal.chapterId ??
      (sessionId.kind === "outline" ? sessionId.chapterId : null);
  }
  return task.chapterId;
}

function requireCharacterDescribeTask(
  task: AgentTask,
  sessionId: AgentSessionId,
): void {
  if (sessionId.kind === "character") {
    if (
      task.kind !== "character-describe" ||
      task.characterId !== sessionId.characterId
    ) {
      const characterId =
        task.kind === "character-describe"
          ? task.characterId
          : sessionId.characterId;
      throw new Error(
        `Character Describe target does not match the session: ${characterId}`,
      );
    }
    return;
  }
  if (task.kind === "character-describe") {
    throw new Error(
      `Character Describe requires its character session: ${task.characterId}`,
    );
  }
}

function requireBridgeAnchor(task: AgentTask, chapter: LoadedChapter): void {
  if (task.kind !== "bridge") return;
  if (chapter.chapterId !== task.chapterId) {
    throw new Error(`Bridge chapter is unavailable: ${task.chapterId}`);
  }
  const anchor = chapter.blocks.find(
    (block) => block.id === task.anchorBlockId,
  );
  if (anchor === undefined) {
    throw new Error(`Bridge anchor not found: ${task.anchorBlockId}`);
  }
  if (anchor.type !== "narration" && anchor.type !== "dialogue") {
    throw new Error(`Bridge anchor is not prose: ${task.anchorBlockId}`);
  }
}

function captureTaskAndTarget(args: {
  project: ProjectInfo;
  activeChapter: LoadedChapter | null;
  task: AgentTask;
  pendingProposal: PendingProposal | null;
  sessionId: AgentSessionId;
}): {
  task: AgentTask;
  resolve: SubmissionCapture["resolveTaskAndTarget"];
} {
  const task = structuredClone(args.task);
  requireCharacterDescribeTask(task, args.sessionId);
  const chapterId = targetChapterId(task, args.pendingProposal, args.sessionId);
  if (chapterId === null) {
    return {
      task,
      resolve: async () => ({ task, chapter: null }),
    };
  }
  if (args.activeChapter?.chapterId === chapterId) {
    requireBridgeAnchor(task, args.activeChapter);
    return {
      task,
      resolve: async () => ({ task, chapter: args.activeChapter }),
    };
  }
  return {
    task,
    resolve: async () => {
      const chapter = await loadChapterSnapshot(
        args.project,
        chapterId,
        args.activeChapter,
      );
      requireBridgeAnchor(task, chapter);
      return { task, chapter };
    },
  };
}

async function resolveOutlinePlannerGroundingInput(
  capture: SubmissionCapture,
  target: LoadedChapter | null,
): Promise<OutlinePlannerGroundingInput | null> {
  if (capture.sessionId.kind !== "outline") return null;
  const chapterId = capture.sessionId.chapterId;
  const index = capture.project.chapters.findIndex(
    (chapter) => chapter.id === chapterId,
  );
  if (index < 0) {
    throw new OutlinePlannerGroundingError(
      `Outline planner chapter not found: ${chapterId}`,
    );
  }
  if (target === null || target.chapterId !== chapterId) {
    throw new OutlinePlannerGroundingError(
      `Outline planner grounding failed for chapter ${chapterId} at target source ${chapterId}: frozen target did not match the planner session.`,
    );
  }
  const previousRef = capture.project.chapters[index - 1] ?? null;
  const nextRef = capture.project.chapters[index + 1] ?? null;
  const load = async (
    source: "target" | "previous" | "next",
    sourceChapterId: string,
  ): Promise<LoadedChapter> => {
    try {
      return await loadChapterSnapshot(
        capture.project,
        sourceChapterId,
        capture.activeChapter,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new OutlinePlannerGroundingError(
        `Outline planner grounding failed for chapter ${chapterId} at ${source} source ${sourceChapterId}: ${message}`,
        { cause: error },
      );
    }
  };
  const [previous, next] = await Promise.all([
    previousRef === null ? Promise.resolve(null) : load("previous", previousRef.id),
    nextRef === null ? Promise.resolve(null) : load("next", nextRef.id),
  ]);
  return {
    chapters: capture.project.chapters,
    meta: capture.meta,
    targetChapterId: chapterId,
    target,
    previous,
    next,
  };
}

function characterDescribeGrounding(
  capture: SubmissionCapture,
  task: AgentTask,
): string | null {
  if (capture.sessionId.kind !== "character") return null;
  requireCharacterDescribeTask(task, capture.sessionId);
  const characterId = capture.sessionId.characterId;
  const frozenCharacter = capture.meta.characters.find(
    (character) => character.id === characterId,
  );
  if (frozenCharacter === undefined) {
    throw new Error(`Character not found in frozen project: ${characterId}`);
  }
  const live = useProjectStore.getState();
  if (live.project === null || live.project.root !== capture.projectRoot) {
    throw new Error("The active project changed before the character run.");
  }
  const liveCharacter = live.meta.characters.find(
    (character) => character.id === characterId,
  );
  if (liveCharacter === undefined) {
    throw new Error(`Character not found in active project: ${characterId}`);
  }
  return buildCharacterGrounding({
    character: frozenCharacter,
    outline: capture.meta.outline,
    chapters: capture.project.chapters.flatMap((chapter) => {
      const knowledge = capture.meta.knowledge.chapters[chapter.id];
      return knowledge === undefined
        ? []
        : [
            {
              chapterId: chapter.id,
              title: chapter.title,
              knowledge,
            },
          ];
    }),
  });
}

async function loadExactTaskAndTarget(args: {
  project: ProjectInfo;
  activeChapter: LoadedChapter | null;
  task: AgentTask;
  pendingProposal: PendingProposal | null;
  sessionId: AgentSessionId;
}): Promise<{ task: AgentTask; chapter: LoadedChapter | null }> {
  const task = structuredClone(args.task);
  requireCharacterDescribeTask(task, args.sessionId);
  const chapterId = targetChapterId(task, args.pendingProposal, args.sessionId);
  return {
    task,
    chapter:
      chapterId === null
        ? null
        : await loadChapterSnapshot(
            args.project,
            chapterId,
            args.activeChapter,
          ),
  };
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

function textExcerpt(message: AgentUIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function messageSnapshots(message: AgentUIMessage): ContextSnapshot[] {
  return message.parts.flatMap((part) =>
    part.type === "data-context"
      ? part.data.snapshots.map((snapshot) => ({ ...snapshot }))
      : [],
  );
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

function errorDetails(error: unknown): string {
  if (typeof error === "string") return error;
  if (!(error instanceof Error)) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  const detailed = error as ErrorWithDetails;
  const details: string[] = [];
  const status = detailed.statusCode ?? detailed.status;
  if (status !== undefined) details.push(`HTTP ${status}`);
  if (detailed.message.length > 0) details.push(detailed.message);
  if (
    detailed.responseBody !== undefined &&
    !details.some((part) => part.includes(detailed.responseBody as string))
  ) {
    details.push(detailed.responseBody);
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

function recordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnosticString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function diagnosticInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function toolFailureChangeTargets(
  toolName: string,
  input: unknown,
): AgentFailureLogEntry["changeTargets"] {
  if (
    toolName !== "stage_manuscript_proposal" &&
    toolName !== "stage_outline_proposal"
  ) {
    return null;
  }
  if (!recordValue(input) || !Array.isArray(input.changes)) return null;
  return input.changes.flatMap((change) => {
    if (!recordValue(change) || typeof change.kind !== "string") return [];
    const blockId = diagnosticString(change.blockId);
    const cardId = diagnosticString(change.cardId);
    return [
      {
        kind: change.kind,
        targetId: blockId === null ? cardId : blockId,
        afterId: diagnosticString(change.afterId),
        toIndex: diagnosticInteger(change.toIndex),
      },
    ];
  });
}

function failureErrorText(error: unknown): string {
  if (error instanceof Error) return (error.message || error.name).slice(0, 2_000);
  if (typeof error === "string") return error.slice(0, 2_000);
  return String(error).slice(0, 2_000);
}

function toolFailureLogEntry(args: {
  failure: AgentToolFailure;
  occurredAt: string;
  provider: AiProvider;
  modelId: string;
  run: AgentRun;
}): AgentFailureLogEntry {
  return {
    kind: "tool",
    occurredAt: args.occurredAt,
    runId: args.run.id,
    provider: args.provider,
    modelId: args.modelId,
    task: args.run.task,
    toolName: args.failure.toolName,
    toolCallId: args.failure.toolCallId,
    changeTargets: toolFailureChangeTargets(
      args.failure.toolName,
      args.failure.input,
    ),
    errorCode: "tool",
    error: failureErrorText(args.failure.error),
  };
}

function runFailureLogEntry(args: {
  occurredAt: string;
  runId: string;
  provider: AiProvider;
  modelId: string | null;
  task: AgentTask;
  failure: AgentFailure;
  diagnostic: unknown;
}): AgentFailureLogEntry {
  return {
    kind: "run",
    occurredAt: args.occurredAt,
    runId: args.runId,
    provider: args.provider,
    modelId: args.modelId,
    task: args.task,
    toolName: null,
    toolCallId: null,
    changeTargets: null,
    errorCode: agentFailureDiagnosticCode(args.failure),
    error: failureErrorText(errorDetails(args.diagnostic)),
  };
}

async function persistAgentFailure(
  recordFailure: (entry: AgentFailureLogEntry) => Promise<void>,
  entry: AgentFailureLogEntry,
): Promise<void> {
  try {
    await recordFailure(entry);
  } catch (error) {
    console.error("Agent failure diagnostic could not be written", {
      cause: error,
      kind: entry.kind,
      runId: entry.runId,
    });
  }
}

function taggedError(
  reason: AgentFailureReason,
  error: unknown,
): ErrorWithDetails {
  const wrapped = new Error(errorDetails(error), { cause: error }) as ErrorWithDetails;
  wrapped.agentFailureReason = reason;
  return wrapped;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function runFailure(
  error: unknown,
  provider: AiProvider,
  phase: AgentFailurePhase,
): AgentFailure {
  if (error instanceof OutlinePlannerGroundingError) {
    return {
      reason: "tool",
      message: error.message,
      action: "retry",
      settingsTarget: null,
    };
  }
  return failureFromError(error, provider, phase);
}

function requireMetadata(message: AgentUIMessage): AgentMessageMetadata {
  if (message.metadata === undefined) {
    throw new Error(`Agent message metadata is missing: ${message.id}`);
  }
  return message.metadata;
}

function userMessage(args: {
  run: AgentRun;
  text: string;
  snapshots: ContextSnapshot[];
  retryOf: string | null;
}): AgentUIMessage {
  return {
    id: args.run.userMessageId,
    role: "user",
    metadata: {
      runId: args.run.id,
      mode: args.run.mode,
      task: args.run.task,
      state: "complete",
      createdAt: args.run.startedAt,
      failure: null,
      retryOf: args.retryOf,
      usage: null,
    },
    parts: [
      { type: "text", text: args.text },
      {
        type: "data-context",
        data: {
          snapshots: args.snapshots.map((snapshot) => ({ ...snapshot })),
        },
      },
    ],
  };
}

function assistantMetadata(args: {
  message: AgentUIMessage;
  run: AgentRun;
  state: AgentMessageMetadata["state"];
  retryOf: string | null;
  failure: AgentFailure | null;
}): AgentUIMessage {
  return {
    ...args.message,
    id: args.message.id,
    role: "assistant",
    metadata: {
      runId: args.run.id,
      mode: args.run.mode,
      task: args.run.task,
      state: args.state,
      createdAt: args.run.startedAt,
      failure: args.failure,
      retryOf: args.retryOf,
      usage: requireMetadata(args.message).usage,
    },
  };
}

function settledAssistantMessage(message: AgentUIMessage): AgentUIMessage {
  const settled = settleAgentMessages([message]);
  if (settled.length !== 1) {
    throw new Error(`Agent run emitted no settled message: ${message.id}`);
  }
  return settled[0];
}

export function createAgentController(
  dependencies: AgentControllerDependencies,
) {
  const activeControllers = new Map<string, ActiveController>();
  const activeRunError = "An agent run is already active";

  const activeControllerFor = (
    sessionId: AgentSessionId,
  ): ActiveController | null =>
    activeControllers.get(agentSessionKey(sessionId)) ?? null;

  const ownsRun = (
    projectRoot: string,
    runId: string,
    sessionId: AgentSessionId,
  ): boolean => {
    const activeController = activeControllerFor(sessionId);
    if (
      activeController === null ||
      activeController.projectRoot !== projectRoot ||
      activeController.runId !== runId
    ) {
      return false;
    }
    const project = useProjectStore.getState().project;
    if (project === null || project.root !== projectRoot) return false;
    const consoleState = agentSessionStore(sessionId).getState();
    if (
      agentConsoleOwnershipStatus(consoleState, projectRoot) !== "ready"
    ) {
      return false;
    }
    return (
      consoleState.runStatus !== "idle" &&
      (consoleState.activeRun === null ||
        consoleState.activeRun.id === runId)
    );
  };

  const checkToolRun = (
    projectRoot: string,
    runId: string,
    sessionId: AgentSessionId,
  ): void => {
    activeControllerFor(sessionId)?.controller.signal.throwIfAborted();
    if (!ownsRun(projectRoot, runId, sessionId)) {
      throw taggedError(
        "tool",
        new Error(`Agent tool no longer owns run: ${runId}`),
      );
    }
  };

  const toolEnvironment = (args: {
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
  }): AgentToolEnvironment => {
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
      checkToolRun(args.run.projectRoot, args.run.id, args.sessionId);
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
      checkToolRun(args.run.projectRoot, args.run.id, args.sessionId);
      return agentSessionStore(args.sessionId).getState().pendingProposal;
    };
    return {
      run: args.run,
      signal: args.signal,
      readChapter: async (chapterId) => {
        checkToolRun(args.run.projectRoot, args.run.id, args.sessionId);
        const cached = chapterSnapshots.get(chapterId);
        if (cached !== undefined) return structuredClone(cached);
        try {
          const chapter = await loadChapterSnapshot(
            args.project,
            chapterId,
            args.targetChapter,
          );
          checkToolRun(args.run.projectRoot, args.run.id, args.sessionId);
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
        checkToolRun(args.run.projectRoot, args.run.id, args.sessionId);
        return outlineValue(args.project, args.meta, chapterId);
      },
      readLore: async (query) => {
        checkToolRun(args.run.projectRoot, args.run.id, args.sessionId);
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
          checkToolRun(args.run.projectRoot, args.run.id, args.sessionId);
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
          checkToolRun(args.run.projectRoot, args.run.id, args.sessionId);
          return result;
        } catch (error) {
          if (isAbortError(error)) throw error;
          throw taggedError("tool", error);
        }
      },
      readConversationContext: (messageIds) => {
        checkToolRun(args.run.projectRoot, args.run.id, args.sessionId);
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
            makeId: dependencies.id,
            now: dependencies.now(),
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
            makeId: dependencies.id,
            now: dependencies.now(),
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
            makeId: dependencies.id,
            now: dependencies.now(),
          });
        } catch (error) {
          throw taggedError("tool", error);
        }
      },
      replacePendingProposal: (proposal) => {
        if (!ownsRun(args.run.projectRoot, args.run.id, args.sessionId)) return;
        const viewState = useViewStore.getState();
        viewState.closeManuscriptReview();
        agentSessionStore(args.sessionId).getState().replacePendingProposal(proposal);
        const projectState = useProjectStore.getState();
        if (
          !viewState.outlineOpen &&
          proposal.kind === "manuscript" &&
          projectState.project !== null &&
          projectState.project.root === proposal.projectRoot &&
          projectState.activeChapterId === proposal.chapterId
        ) {
          viewState.openManuscriptReview(proposal.id);
        }
      },
      updateCharacterProfile: async ({ characterId, profile }) => {
        checkToolRun(args.run.projectRoot, args.run.id, args.sessionId);
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
        checkToolRun(args.run.projectRoot, args.run.id, args.sessionId);
        return character;
      },
    };
  };

  const cancelPreflight = (sessionId: AgentSessionId): void => {
    agentSessionStore(sessionId).setState({
      activeRun: null,
      runStatus: "idle",
      runError: null,
    });
  };

  const interruptVisibleRun = (
    active: ActiveController,
    reason: "stopped" | "project-switch" | "app-exit",
  ): void => {
    const state = agentSessionStore(active.sessionId).getState();
    const activeRun = state.activeRun;
    if (activeRun === null || activeRun.id !== active.runId) {
      cancelPreflight(active.sessionId);
      return;
    }
    const assistant = [...state.messages]
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" &&
          message.metadata?.runId === active.runId,
      );
    if (assistant !== undefined) {
      state.upsertAssistantMessage(
        settledAssistantMessage({
          ...assistant,
          metadata: {
            ...requireMetadata(assistant),
            state: "stopped",
            failure: null,
          },
        }),
      );
    }
    state.interruptRun({
      runId: active.runId,
      userMessageId: active.userMessageId,
      assistantMessageId: assistant?.id ?? null,
      reason,
      interruptedAt: dependencies.now(),
    });
  };

  const runSubmission = async (
    capture: SubmissionCapture,
  ): Promise<AgentSubmissionOutcome> => {
    const runId = dependencies.id();
    const userMessageId = dependencies.id();
    const assistantMessageId = dependencies.id();
    const abortController = new AbortController();
    const sessionStore = agentSessionStore(capture.sessionId);
    try {
      if (activeControllers.size > 0) throw new Error(activeRunError);
      sessionStore.getState().beginPreflight();
    } catch (error) {
      const refusal = runFailure(error, capture.provider, null);
      await persistAgentFailure(
        dependencies.recordFailure,
        runFailureLogEntry({
          occurredAt: dependencies.now(),
          runId,
          provider: capture.provider,
          modelId: capture.modelId,
          task: capture.task,
          failure: refusal,
          diagnostic: error,
        }),
      );
      sessionStore.setState({ runError: refusal });
      return { status: "failure", failure: refusal };
    }
    activeControllers.set(agentSessionKey(capture.sessionId), {
      projectRoot: capture.projectRoot,
      sessionId: capture.sessionId,
      runId,
      userMessageId,
      assistantMessageId,
      controller: abortController,
    });
    const ownsCurrentRun = () =>
      ownsRun(capture.projectRoot, runId, capture.sessionId);
    let enteredRun = false;
    let latestAssistant: AgentUIMessage | null = null;
    let failurePhase: AgentFailurePhase = null;

    try {
      const modelId = capture.modelId;
      if (modelId === null) {
        const failure = modelUnselectedFailure(capture.provider);
        await persistAgentFailure(
          dependencies.recordFailure,
          runFailureLogEntry({
            occurredAt: dependencies.now(),
            runId,
            provider: capture.provider,
            modelId,
            task: capture.task,
            failure,
            diagnostic: failure.message,
          }),
        );
        sessionStore.getState().failPreflight(failure);
        return { status: "failure", failure };
      }
      const [attachmentsResult, targetResult] = await Promise.allSettled([
        capture.resolveAttachments(
          abortController.signal,
          ownsCurrentRun,
        ),
        capture.resolveTaskAndTarget(),
      ]);
      if (!ownsCurrentRun()) return { status: "stopped" };
      if (attachmentsResult.status === "rejected") {
        throw attachmentsResult.reason;
      }
      const attachments = attachmentsResult.value;
      if (attachments.snapshots.length !== attachments.refs.length) {
        throw new Error(
          "Remove unavailable context sources before submitting this request.",
        );
      }
      if (targetResult.status === "rejected") {
        if (capture.sessionId.kind === "outline") {
          const chapterId = capture.sessionId.chapterId;
          const message =
            targetResult.reason instanceof Error
              ? targetResult.reason.message
              : String(targetResult.reason);
          throw new OutlinePlannerGroundingError(
            `Outline planner grounding failed for chapter ${chapterId} at target source ${chapterId}: ${message}`,
            { cause: targetResult.reason },
          );
        }
        throw targetResult.reason;
      }
      const frozen = targetResult.value;
      const describeGrounding = characterDescribeGrounding(
        capture,
        frozen.task,
      );
      const plannerGroundingInput = await resolveOutlinePlannerGroundingInput(
        capture,
        frozen.chapter,
      );

      const model = await dependencies.getModel(
        capture.provider,
        modelId,
      );
      failurePhase = null;
      const contextWindow = await dependencies.getContextWindow(
        capture.provider,
        modelId,
      );
      if (!ownsCurrentRun()) return { status: "stopped" };
      const plannerGrounding =
        plannerGroundingInput === null
          ? null
          : buildOutlinePlannerGrounding(
              plannerGroundingInput,
              Math.max(1, Math.floor(contextWindow / 2)),
            );

      let summary = capture.summary;
      failurePhase = "compaction";
      if (
        capture.lastUsage !== null &&
        shouldCompactConversation(capture.lastUsage)
      ) {
        const compacted = await compactConversation({
          messages: capture.messages,
          currentSummary: summary,
          tokenTarget: compactionTokenTarget(capture.lastUsage),
          summarize: (source) =>
            dependencies.summarize(model, source, abortController.signal),
        });
        if (!ownsCurrentRun()) return { status: "stopped" };
        summary = compacted.summary;
        if (summary !== null && summary !== capture.summary) {
          sessionStore.getState().setSummary(summary);
        }
      }
      if (!ownsCurrentRun()) return { status: "stopped" };

      const run: AgentRun = {
        id: runId,
        projectRoot: capture.projectRoot,
        mode: capture.mode,
        task: frozen.task,
        userMessageId,
        attachments: attachments.snapshots.map((snapshot) => ({ ...snapshot })),
        startedAt: dependencies.now(),
      };
      const user = userMessage({
        run,
        text: capture.text,
        snapshots: run.attachments,
        retryOf: capture.retryOf,
      });
      const requestMessages = [
        ...messagesForNextRequest(capture.messages, summary),
        user,
      ];
      failurePhase = null;
      const baseInstructions = buildAgentInstructions({
        mode: run.mode,
        task: run.task,
        styleGuide: capture.styleGuide,
        editingRules: capture.editingRules,
        sessionId: capture.sessionId,
      });
      const instructions =
        [baseInstructions, plannerGrounding, describeGrounding]
          .filter((part): part is string => part !== null)
          .join("\n\n");
      const environment = toolEnvironment({
        run,
        model,
        styleGuide: capture.styleGuide,
        editingRules: capture.editingRules,
        project: capture.project,
        meta: capture.meta,
        targetChapter: frozen.chapter,
        history: capture.messages,
        assistantMessageId,
        signal: abortController.signal,
        sessionId: capture.sessionId,
      });
      capture.enterRun(run, user);
      enteredRun = true;
      if (!ownsCurrentRun()) return { status: "stopped" };
      sessionStore.getState().markStreaming();

      const result = await dependencies.stream({
        model,
        modelId,
        contextWindow,
        run,
        instructions,
        messages: requestMessages,
        environment,
        signal: abortController.signal,
        generateMessageId: () => assistantMessageId,
        onMessage: (message) => {
          if (!ownsCurrentRun()) return;
          latestAssistant = assistantMetadata({
            message,
            run,
            state: requireMetadata(message).state,
            retryOf: capture.retryOf,
            failure: null,
          });
          sessionStore.getState().upsertAssistantMessage(latestAssistant);
        },
        onToolFailure: async (failure) => {
          await persistAgentFailure(
            dependencies.recordFailure,
            toolFailureLogEntry({
              failure,
              occurredAt: dependencies.now(),
              provider: capture.provider,
              modelId,
              run,
            }),
          );
        },
      });
      if (!ownsCurrentRun()) return { status: "stopped" };
      const completed = assistantMetadata({
        message: result.message,
        run,
        state: "complete",
        retryOf: capture.retryOf,
        failure: null,
      });
      sessionStore
        .getState()
        .finishRun(settledAssistantMessage(completed), result.usage);
      return { status: "success" };
    } catch (error) {
      if (!ownsCurrentRun()) return { status: "stopped" };
      if (isAbortError(error)) {
        const activeController = activeControllerFor(capture.sessionId);
        if (
          activeController !== null &&
          activeController.projectRoot === capture.projectRoot &&
          activeController.runId === runId
        ) {
          interruptVisibleRun(activeController, "stopped");
        }
        return { status: "stopped" };
      }
      const failure = runFailure(error, capture.provider, failurePhase);
      const activeRun = sessionStore.getState().activeRun;
      await persistAgentFailure(
        dependencies.recordFailure,
        runFailureLogEntry({
          occurredAt: dependencies.now(),
          runId,
          provider: capture.provider,
          modelId: capture.modelId,
          task: activeRun === null ? capture.task : activeRun.task,
          failure,
          diagnostic: error,
        }),
      );
      if (!ownsCurrentRun()) return { status: "stopped" };
      console.error("Agent run failed", {
        cause: error,
        reason: failure.reason,
        message: failure.message,
        modelId: capture.modelId,
        provider: capture.provider,
        phase: failurePhase,
        projectRoot: capture.projectRoot,
        runId,
      });
      if (!enteredRun) {
        sessionStore.getState().failPreflight(failure);
      } else {
        if (activeRun === null) return { status: "stopped" };
        const base =
          latestAssistant ??
          ({
            id: assistantMessageId,
            role: "assistant",
            metadata: {
              runId: activeRun.id,
              mode: activeRun.mode,
              task: activeRun.task,
              state: "error",
              createdAt: activeRun.startedAt,
              failure,
              retryOf: capture.retryOf,
              usage: null,
            },
            parts: [],
          } satisfies AgentUIMessage);
        const failed = assistantMetadata({
          message: base,
          run: activeRun,
          state: "error",
          retryOf: capture.retryOf,
          failure,
        });
        sessionStore.getState().failRun(settledAssistantMessage(failed), failure);
      }
      return { status: "failure", failure };
    } finally {
      const activeController = activeControllerFor(capture.sessionId);
      if (
        activeController?.projectRoot === capture.projectRoot &&
        activeController.runId === runId
      ) {
        activeControllers.delete(agentSessionKey(capture.sessionId));
        if (capture.sessionId.kind === "project") {
          void refreshAttachedDraftSources();
        }
      }
    }
  };

  const contextResolver = (args: {
    project: ProjectInfo;
    activeChapter: LoadedChapter | null;
    attachments: CapturedContextAttachment[];
    locators: Record<string, DraftSourceLocator>;
    meta: ProjectMeta;
    messages: AgentUIMessage[];
    publish: (resolved: ResolvedDraftContext) => void;
  }) => {
    const capture = captureDraftContext(args);
    return async (
      _signal: AbortSignal,
      ownsCurrentRun: () => boolean,
    ): Promise<{ refs: DraftContextRef[]; snapshots: ContextSnapshot[] }> => {
      const resolved = await resolveDraftContext({
        ...capture,
        makeId: dependencies.id,
      });
      if (ownsCurrentRun()) args.publish(resolved);
      return {
        refs: resolved.attachments.map((attachment) => attachment.ref),
        snapshots: resolved.attachments.flatMap((attachment) =>
          attachment.snapshot === null ? [] : [attachment.snapshot],
        ),
      };
    };
  };

  const captureBase = (args: {
    mode: AgentMode;
    text: string;
    task: AgentTask;
    retryOf: string | null;
    sessionId: AgentSessionId;
  }): Omit<
    SubmissionCapture,
    "resolveTaskAndTarget" | "resolveAttachments" | "enterRun"
  > => {
    const projectState = useProjectStore.getState();
    const project = projectState.project;
    if (project === null) throw new Error("Open a project before running the agent.");
    const settings = useSettingsStore.getState();
    const consoleState = agentSessionStore(args.sessionId).getState();
    const task = structuredClone(args.task);
    const pendingProposal =
      consoleState.pendingProposal === null
        ? null
        : structuredClone(consoleState.pendingProposal);
    const frozenProject = cloneProject(project);
    const activeChapter = captureActiveChapter(
      frozenProject,
      projectState.activeChapterId,
      projectState.blocks,
    );
    return {
      projectRoot: project.root,
      sessionId: args.sessionId,
      project: frozenProject,
      meta: structuredClone(projectState.meta),
      mode: args.mode,
      task,
      text: args.text,
      provider: settings.aiProvider,
      modelId: settings.aiModel,
      styleGuide: settings.styleGuide,
      editingRules: settings.editingRules,
      messages: structuredClone(consoleState.messages),
      summary:
        consoleState.summary === null
          ? null
          : { ...consoleState.summary },
      lastUsage:
        consoleState.lastUsage === null
          ? null
          : structuredClone(consoleState.lastUsage),
      pendingProposal,
      retryOf: args.retryOf,
      activeChapter,
    };
  };

  const submitAgentDraft = async (
    task: AgentTask,
    requestedSessionId?: AgentSessionId,
  ): Promise<AgentSubmissionOutcome> => {
    const sessionId = structuredClone(
      requestedSessionId ?? PROJECT_AGENT_SESSION,
    );
    const requestedProject = useProjectStore.getState().project;
    if (requestedProject === null) {
      throw new Error("Open a project before running the agent.");
    }
    requireAgentSessionProject(sessionId, requestedProject.root);
    const projectState = useProjectStore.getState();
    const project = projectState.project;
    if (project === null || project.root !== requestedProject.root) {
      throw new Error("The active project changed before the agent could run.");
    }
    const sessionStore = agentSessionStore(sessionId);
    const consoleState = sessionStore.getState();
    const settings = useSettingsStore.getState();
    const submittedDraft = consoleState.captureDraft();
    const attachments = structuredClone(submittedDraft.attachments);
    const text = submittedDraft.text;
    if (text.trim() === "" && attachments.length === 0) {
      return { status: "success" };
    }
    const frozenTask = structuredClone(task);
    const pendingProposal =
      consoleState.pendingProposal === null
        ? null
        : structuredClone(consoleState.pendingProposal);
    const frozenProject = cloneProject(project);
    const activeChapter = captureActiveChapter(
      frozenProject,
      projectState.activeChapterId,
      projectState.blocks,
    );
    const taskTarget = captureTaskAndTarget({
      project: frozenProject,
      activeChapter,
      task: frozenTask,
      pendingProposal,
      sessionId,
    });
    const capture: SubmissionCapture = {
      projectRoot: project.root,
      sessionId,
      project: frozenProject,
      meta: structuredClone(projectState.meta),
      mode: consoleState.mode,
      task: taskTarget.task,
      text,
      provider: settings.aiProvider,
      modelId: settings.aiModel,
      styleGuide: settings.styleGuide,
      editingRules: settings.editingRules,
      messages: structuredClone(consoleState.messages),
      summary:
        consoleState.summary === null
          ? null
          : { ...consoleState.summary },
      lastUsage:
        consoleState.lastUsage === null
          ? null
          : structuredClone(consoleState.lastUsage),
      pendingProposal,
      retryOf: null,
      activeChapter,
      resolveTaskAndTarget: taskTarget.resolve,
      resolveAttachments: contextResolver({
        project: frozenProject,
        activeChapter,
        attachments,
        locators: structuredClone(consoleState.draftSourceLocators),
        meta: structuredClone(projectState.meta),
        messages: structuredClone(consoleState.messages),
        publish: (resolved) => {
          sessionStore.getState().applyDraftContextResolution(
            submittedDraft.attachments,
            storeContextResolutions(resolved),
          );
        },
      }),
      enterRun: (run, user) => {
        sessionStore.getState().beginDraftRun(run, user, submittedDraft);
      },
    };
    return runSubmission(capture);
  };

  const submitAgentRequest = async (
    request: Extract<AgentIntent, { kind: "run" }>,
    requestedSessionId?: AgentSessionId,
  ): Promise<AgentSubmissionOutcome> => {
    const sessionId = structuredClone(
      requestedSessionId ?? PROJECT_AGENT_SESSION,
    );
    const frozenRequest = structuredClone(request);
    if (
      frozenRequest.text.trim() === "" &&
      frozenRequest.refs.length === 0
    ) {
      return { status: "success" };
    }
    const project = useProjectStore.getState().project;
    if (project === null) {
      throw new Error("Open a project before running the agent.");
    }
    requireAgentSessionProject(sessionId, project.root);
    if (useProjectStore.getState().project?.root !== project.root) {
      throw new Error("The active project changed before the agent could run.");
    }
    const base = captureBase({
      mode: frozenRequest.mode,
      text: frozenRequest.text,
      task: frozenRequest.task,
      retryOf: null,
      sessionId,
    });
    const taskTarget = captureTaskAndTarget({
      project: base.project,
      activeChapter: base.activeChapter,
      task: base.task,
      pendingProposal: base.pendingProposal,
      sessionId,
    });
    const sessionStore = agentSessionStore(sessionId);
    const consoleState = sessionStore.getState();
    const attachments: CapturedContextAttachment[] =
      frozenRequest.refs.map((ref) => ({ ref, revision: null }));
    return runSubmission({
      ...base,
      task: taskTarget.task,
      resolveTaskAndTarget: taskTarget.resolve,
      resolveAttachments: contextResolver({
        project: base.project,
        activeChapter: base.activeChapter,
        attachments,
        locators: structuredClone(consoleState.draftSourceLocators),
        meta: base.meta,
        messages: base.messages,
        publish: () => undefined,
      }),
      enterRun: (run, user) => {
        sessionStore.getState().beginRun(run, user);
      },
    });
  };

  const stopAgentRun = (
    requestedSessionId?: AgentSessionId,
  ): void => {
    const sessionId = requestedSessionId ?? PROJECT_AGENT_SESSION;
    const sessionKey = agentSessionKey(sessionId);
    const active = activeControllers.get(sessionKey);
    if (active === undefined) return;
    activeControllers.delete(sessionKey);
    interruptVisibleRun(active, "stopped");
    active.controller.abort();
    if (sessionId.kind === "project") void refreshAttachedDraftSources();
  };

  const retryAgentTurn = async (
    userMessageId: string,
    requestedSessionId?: AgentSessionId,
  ): Promise<AgentSubmissionOutcome> => {
    const sessionId = structuredClone(
      requestedSessionId ?? PROJECT_AGENT_SESSION,
    );
    const project = useProjectStore.getState().project;
    if (project === null) {
      throw new Error("Open a project before running the agent.");
    }
    requireAgentSessionProject(sessionId, project.root);
    if (useProjectStore.getState().project?.root !== project.root) {
      throw new Error("The active project changed before the agent could run.");
    }
    const sessionStore = agentSessionStore(sessionId);
    const consoleState = sessionStore.getState();
    const original = consoleState.messages.find(
      (message) => message.id === userMessageId && message.role === "user",
    );
    if (original === undefined || original.metadata === undefined) {
      throw new Error(`Agent user turn not found: ${userMessageId}`);
    }
    const originalMetadata = original.metadata;
    const text = textExcerpt(original);
    const snapshots = messageSnapshots(original);
    const refs = snapshots.map((snapshot): DraftContextRef => {
      if (snapshot.kind === "block") {
        return {
          kind: "block",
          chapterId: snapshot.chapterId,
          blockId: snapshot.sourceId,
        };
      }
      if (snapshot.kind === "outline-card") {
        return {
          kind: "outline-card",
          chapterId: snapshot.chapterId,
          cardId: snapshot.sourceId,
        };
      }
      return {
        kind: "finding",
        chapterId: snapshot.chapterId,
        findingId: snapshot.sourceId,
      };
    });
    const base = captureBase({
      mode: originalMetadata.mode,
      text,
      task: originalMetadata.task,
      retryOf: userMessageId,
      sessionId,
    });
    return runSubmission({
      ...base,
      resolveTaskAndTarget: () =>
        loadExactTaskAndTarget({
          project: base.project,
          activeChapter: base.activeChapter,
          task: base.task,
          pendingProposal: base.pendingProposal,
          sessionId,
        }),
      resolveAttachments: async () => ({
        refs,
        snapshots: snapshots.map((snapshot) => ({ ...snapshot })),
      }),
      enterRun: (run, user) => {
        sessionStore.getState().beginRun(run, user);
      },
    });
  };

  const recordProposalEvent = (
    event: ProposalEventData,
    requestedSessionId?: AgentSessionId,
  ): void => {
    const sessionId = requestedSessionId ?? PROJECT_AGENT_SESSION;
    const project = useProjectStore.getState().project;
    if (project === null) {
      throw new Error("Open a project before recording a proposal decision.");
    }
    requireAgentSessionProject(sessionId, project.root);
    const sessionStore = agentSessionStore(sessionId);
    const mode = sessionStore.getState().mode;
    const createdAt = dependencies.now();
    const message: AgentUIMessage = {
      id: dependencies.id(),
      role: "assistant",
      metadata: {
        runId: dependencies.id(),
        mode,
        task: { kind: "proposal-follow-up", proposalId: event.proposalId },
        state: "complete",
        createdAt,
        failure: null,
        retryOf: null,
        usage: null,
      },
      parts: [
        {
          type: "data-proposal-event",
          data: { ...event },
        },
      ],
    };
    sessionStore.getState().appendLocalMessage(message);
  };

  const abortAgentRunForProjectSwitch = (
    projectRoot: string,
    reason: "project-switch" | "app-exit",
  ): void => {
    invalidateDraftSourceRefreshes();
    for (const [sessionKey, active] of [...activeControllers.entries()]) {
      if (active.projectRoot !== projectRoot) continue;
      interruptVisibleRun(active, reason);
      active.controller.abort();
      activeControllers.delete(sessionKey);
    }
  };

  const resolveAgentDraftContext = async (
    sessionId: AgentSessionId,
  ): Promise<void> => {
    const requestedProject = useProjectStore.getState().project;
    if (requestedProject === null) {
      throw new Error("Open a project before adding agent context.");
    }
    requireAgentSessionProject(sessionId, requestedProject.root);
    const projectState = useProjectStore.getState();
    if (projectState.project?.root !== requestedProject.root) {
      throw new Error("The active project changed before context could load.");
    }
    const sessionStore = agentSessionStore(sessionId);
    const state = sessionStore.getState();
    const capturedDraft = state.captureDraft();
    const frozenProject = cloneProject(requestedProject);
    const activeChapter = captureActiveChapter(
      frozenProject,
      projectState.activeChapterId,
      projectState.blocks,
    );
    const contextCapture = captureDraftContext({
      project: frozenProject,
      activeChapter,
      attachments: capturedDraft.attachments,
      locators: state.draftSourceLocators,
      meta: projectState.meta,
      messages: state.messages,
    });
    const ownsContextProject = (): boolean => {
      const currentProject = useProjectStore.getState().project;
      const currentConsole = sessionStore.getState();
      return (
        currentProject !== null &&
        currentProject.root === requestedProject.root &&
        agentConsoleOwnershipStatus(
          currentConsole,
          requestedProject.root,
        ) === "ready"
      );
    };
    let resolved: ResolvedDraftContext;
    try {
      resolved = await resolveDraftContext({
        ...contextCapture,
        makeId: dependencies.id,
      });
    } catch (error) {
      if (!ownsContextProject()) return;
      throw error;
    }
    if (ownsContextProject()) {
      sessionStore.getState().applyDraftContextResolution(
        capturedDraft.attachments,
        storeContextResolutions(resolved),
      );
    }
  };

  const addAgentContext = async (
    refs: DraftContextRef[],
    sessionId: AgentSessionId,
  ): Promise<void> => {
    agentSessionStore(sessionId).getState().addDraftContextRefs(refs);
    await resolveAgentDraftContext(sessionId);
  };

  const prefillAgentDraft = async (
    intent: Extract<AgentIntent, { kind: "prefill" }>,
    sessionId: AgentSessionId,
  ): Promise<void> => {
    const store = agentSessionStore(sessionId).getState();
    store.setMode(intent.mode);
    store.setDraftText(intent.text);
    store.setDraftContextRefs(intent.refs);
    await resolveAgentDraftContext(sessionId);
  };

  const dispatchAgentIntent = async (
    intent: AgentIntent,
    requestedSessionId?: AgentSessionId,
  ): Promise<void> => {
    const sessionId = requestedSessionId ?? PROJECT_AGENT_SESSION;
    const sessionStore = agentSessionStore(sessionId);
    const frozenIntent = structuredClone(intent);
    if (sessionId.kind === "project") useViewStore.getState().openAiConsole();
    sessionStore.setState({ runError: null });
    try {
      const project = useProjectStore.getState().project;
      if (project === null) {
        throw new Error("Open a project before using the agent console.");
      }
      requireAgentSessionProject(sessionId, project.root);
      if (frozenIntent.kind === "focus") {
        sessionStore.getState().setMode(frozenIntent.mode);
        return;
      }
      if (frozenIntent.kind === "add-context") {
        await addAgentContext(frozenIntent.refs, sessionId);
        return;
      }
      if (frozenIntent.kind === "prefill") {
        await prefillAgentDraft(frozenIntent, sessionId);
        return;
      }
      sessionStore.getState().setMode(frozenIntent.mode);
      await submitAgentRequest(frozenIntent, sessionId);
    } catch (error) {
      if (sessionStore.getState().runError === null) {
        const failure = runFailure(
          error,
          useSettingsStore.getState().aiProvider,
          null,
        );
        if (frozenIntent.kind === "run") {
          const settings = useSettingsStore.getState();
          await persistAgentFailure(
            dependencies.recordFailure,
            runFailureLogEntry({
              occurredAt: dependencies.now(),
              runId: dependencies.id(),
              provider: settings.aiProvider,
              modelId: settings.aiModel,
              task: frozenIntent.task,
              failure,
              diagnostic: error,
            }),
          );
        }
        sessionStore.setState({ runError: failure });
      }
    }
  };

  return {
    submitAgentDraft,
    submitAgentRequest,
    stopAgentRun,
    retryAgentTurn,
    recordProposalEvent,
    abortAgentRunForProjectSwitch,
    dispatchAgentIntent,
  };
}

let draftSourceRefreshSequence = 0;

interface DraftSourceRefreshOwnership {
  sequence: number;
  projectRoot: string;
}

function invalidateDraftSourceRefreshes(): void {
  draftSourceRefreshSequence += 1;
}

function ownsDraftSourceRefresh(
  ownership: DraftSourceRefreshOwnership,
): boolean {
  const project = useProjectStore.getState().project;
  const consoleState = useAgentConsoleStore.getState();
  return (
    ownership.sequence === draftSourceRefreshSequence &&
    project !== null &&
    project.root === ownership.projectRoot &&
    agentConsoleOwnershipStatus(consoleState, ownership.projectRoot) ===
      "ready" &&
    consoleState.runStatus === "idle"
  );
}

async function refreshAttachedDraftSources(): Promise<void> {
  const sequence = ++draftSourceRefreshSequence;
  const projectState = useProjectStore.getState();
  const project = projectState.project;
  const consoleState = useAgentConsoleStore.getState();
  if (
    project === null ||
    consoleState.runStatus !== "idle" ||
    consoleState.draftContextRefs.length === 0 ||
    agentConsoleOwnershipStatus(consoleState, project.root) !== "ready"
  ) {
    return;
  }
  const capturedDraft = consoleState.captureDraft();
  const frozenProject = cloneProject(project);
  const activeChapter = captureActiveChapter(
    frozenProject,
    projectState.activeChapterId,
    projectState.blocks,
  );
  const contextCapture = captureDraftContext({
    project: frozenProject,
    activeChapter,
    attachments: capturedDraft.attachments,
    locators: consoleState.draftSourceLocators,
    meta: projectState.meta,
    messages: consoleState.messages,
  });
  const ownership: DraftSourceRefreshOwnership = {
    sequence,
    projectRoot: project.root,
  };
  try {
    const resolved = await resolveDraftContext({
      ...contextCapture,
      makeId: () => uid("agent-source"),
    });
    if (!ownsDraftSourceRefresh(ownership)) return;
    useAgentConsoleStore.getState().applyDraftContextResolution(
      capturedDraft.attachments,
      storeContextResolutions(resolved),
    );
  } catch (error) {
    if (!ownsDraftSourceRefresh(ownership)) return;
    console.error("Agent draft context refresh failed", {
      projectRoot: ownership.projectRoot,
      error,
    });
  }
}

useAgentConsoleStore.subscribe((state, previous) => {
  if (
    state.hydratedProjectRoot !== previous.hydratedProjectRoot ||
    (previous.persistenceTransition !== null &&
      state.persistenceTransition === null)
  ) {
    invalidateDraftSourceRefreshes();
    void refreshAttachedDraftSources();
  }
});

useProjectStore.subscribe((state, previous) => {
  if (
    state.project?.root !== previous.project?.root ||
    state.activeChapterId !== previous.activeChapterId ||
    state.blocks !== previous.blocks ||
    state.meta !== previous.meta
  ) {
    void refreshAttachedDraftSources();
  }
});

const productionController = createAgentController({
  now: () => new Date().toISOString(),
  id: () => uid("agent"),
  getModel,
  getContextWindow: resolveModelContextWindow,
  summarize: async (model, source, signal) => {
    const result = await generateText({
      model,
      system: COMPACTION_SYSTEM,
      prompt: source,
      abortSignal: signal,
    });
    return result.text;
  },
  stream: streamAgentRun,
  recordFailure: appendAgentFailureLog,
});

export const submitAgentDraft = productionController.submitAgentDraft;
export const submitAgentRequest = productionController.submitAgentRequest;
export const stopAgentRun = productionController.stopAgentRun;
export const retryAgentTurn = productionController.retryAgentTurn;
export const recordProposalEvent = productionController.recordProposalEvent;
export const abortAgentRunForProjectSwitch =
  productionController.abortAgentRunForProjectSwitch;
export const dispatchAgentIntent = productionController.dispatchAgentIntent;
