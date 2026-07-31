import { generateText, type LanguageModel } from "ai";
import {
  compactionTokenTarget,
  compactConversation,
  messagesForNextRequest,
  modelContextWindow,
  shouldCompactConversation,
} from "@/lib/ai/agent-compaction";
import {
  blockFingerprint,
  cardFingerprint,
  draftContextRefKey,
  findBridgeSuccessor,
  findingFingerprint,
  resolveDraftSnapshots,
} from "@/lib/ai/agent-context";
import { sanitizeAgentMessages } from "@/lib/ai/agent-messages";
import { getModel } from "@/lib/ai/model";
import { buildAgentInstructions } from "@/lib/ai/agent-prompts";
import {
  buildManuscriptPendingProposal,
  buildOutlinePendingProposal,
} from "@/lib/ai/agent-proposals";
import {
  streamAgentRun,
  type StreamAgentRunInput,
  type StreamAgentRunResult,
} from "@/lib/ai/agent-runtime";
import type { AgentToolEnvironment } from "@/lib/ai/agent-tools";
import type {
  AgentErrorCode,
  AgentIntent,
  AgentMessageMetadata,
  AgentMode,
  AgentRun,
  AgentRunError,
  AgentTask,
  AgentUIMessage,
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
import { critique, continuityCheck, type AnchoredContext } from "@/lib/ai/operations";
import { uid } from "@/lib/id";
import { parseChapter } from "@/lib/latex";
import { renderStoryStructure } from "@/lib/outline/grounding";
import { readTextFile } from "@/lib/tauri";
import type {
  Block,
  Card,
  CritiqueNote,
  ContinuityFlag,
  ProjectInfo,
  ProjectMeta,
} from "@/lib/types";
import { useAgentConsoleStore } from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useViewStore } from "@/stores/view-store";

export interface AgentControllerDependencies {
  now: () => string;
  id: () => string;
  getModel: () => Promise<LanguageModel>;
  summarize: (
    model: LanguageModel,
    source: string,
    signal: AbortSignal,
  ) => Promise<string>;
  stream: (input: StreamAgentRunInput) => Promise<StreamAgentRunResult>;
}

interface ActiveController {
  projectRoot: string;
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

interface ResolvedDraftContext {
  refs: DraftContextRef[];
  sources: DraftContextSource[];
  snapshots: ContextSnapshot[];
}

interface SubmissionCapture {
  projectRoot: string;
  project: ProjectInfo;
  meta: ProjectMeta;
  mode: AgentMode;
  task: AgentTask;
  text: string;
  modelId: string | null;
  styleGuide: string;
  editingRules: string;
  messages: AgentUIMessage[];
  summary: ReturnType<typeof useAgentConsoleStore.getState>["summary"];
  lastUsage: ReturnType<typeof useAgentConsoleStore.getState>["lastUsage"];
  pendingProposal: PendingProposal | null;
  retryOf: string | null;
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
    resolvedRefs: DraftContextRef[],
  ) => void;
}

interface ErrorWithDetails extends Error {
  statusCode?: number;
  status?: number;
  responseBody?: string;
  cause?: unknown;
  agentErrorCode?: AgentErrorCode;
}

const ACTIVE_RUN_ERROR = "An agent run is already active";

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

async function loadChapterSnapshot(
  projectRoot: string,
  chapterId: string,
): Promise<LoadedChapter> {
  const before = useProjectStore.getState();
  const project = currentProjectAtRoot(projectRoot);
  const chapter = project.chapters.find((candidate) => candidate.id === chapterId);
  if (chapter === undefined) {
    throw new Error(`Chapter does not belong to the frozen project: ${chapterId}`);
  }
  if (before.activeChapterId === chapterId) {
    return {
      chapterId,
      title: chapter.title,
      blocks: before.blocks.map((block, order) => {
        const cloned = cloneBlock(block);
        return {
          ...cloned,
          order,
          fingerprint: blockFingerprint(cloned),
        };
      }),
    };
  }
  const source = await readTextFile(projectRoot, chapter.file);
  currentProjectAtRoot(projectRoot);
  return {
    chapterId,
    title: chapter.title,
    blocks: parseChapter(source).map((block, order) => {
      const cloned = cloneBlock(block);
      return {
        ...cloned,
        order,
        fingerprint: blockFingerprint(cloned),
      };
    }),
  };
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
): Array<{ order: number; finding: CritiqueNote | ContinuityFlag }> {
  const findings: Array<{
    order: number;
    finding: CritiqueNote | ContinuityFlag;
  }> = [];
  for (const message of messages) {
    if (message.metadata?.state === "streaming") continue;
    for (const part of message.parts) {
      if (
        part.type !== "data-findings" ||
        part.data.chapterId !== chapterId
      ) {
        continue;
      }
      for (const finding of part.data.items) {
        findings.push({ order: findings.length, finding });
      }
    }
  }
  return findings;
}

async function resolveDraftContext(args: {
  projectRoot: string;
  refs: DraftContextRef[];
  locators: Record<string, DraftSourceLocator>;
  meta: ProjectMeta;
  messages: AgentUIMessage[];
  makeId: () => string;
  rebase: (previous: DraftContextRef, current: DraftContextRef) => void;
}): Promise<ResolvedDraftContext> {
  const documents = new Map<string, Promise<LoadedChapter>>();
  const document = (chapterId: string): Promise<LoadedChapter> => {
    const existing = documents.get(chapterId);
    if (existing !== undefined) return existing;
    const loading = loadChapterSnapshot(args.projectRoot, chapterId);
    documents.set(chapterId, loading);
    return loading;
  };
  const refs: DraftContextRef[] = [];
  const sources: DraftContextSource[] = [];
  const snapshots: ContextSnapshot[] = [];

  for (const originalRef of args.refs) {
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
        refs.push(originalRef);
        sources.push(unavailableSource(originalRef, "Unavailable manuscript block"));
        continue;
      }
      const currentRef: DraftContextRef = {
        kind: "block",
        chapterId: originalRef.chapterId,
        blockId: relocated.block.id,
      };
      if (currentRef.blockId !== originalRef.blockId) {
        args.rebase(originalRef, currentRef);
      }
      const snapshot = snapshotForBlock(
        currentRef,
        chapter.chapterId,
        relocated.order,
        relocated.block,
        args.makeId,
      );
      refs.push(currentRef);
      sources.push(sourceFromSnapshot(currentRef, snapshot));
      snapshots.push(snapshot);
      continue;
    }

    if (originalRef.kind === "outline-card") {
      const cards = args.meta.chapters[originalRef.chapterId]?.cards ?? [];
      const order = cards.findIndex((card) => card.id === originalRef.cardId);
      if (order < 0) {
        refs.push(originalRef);
        sources.push(unavailableSource(originalRef, "Unavailable outline card"));
        continue;
      }
      const snapshot = snapshotForCard(
        originalRef,
        originalRef.chapterId,
        order,
        cards[order],
        args.makeId,
      );
      refs.push(originalRef);
      sources.push(sourceFromSnapshot(originalRef, snapshot));
      snapshots.push(snapshot);
      continue;
    }

    const findings = settledFindings(args.messages, originalRef.chapterId);
    const exact = findings.find(
      ({ finding }) => findingFingerprint(finding) === originalRef.findingId,
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
      refs.push(originalRef);
      sources.push(unavailableSource(originalRef, "Unavailable finding"));
      continue;
    }
    const snapshot = snapshotForFinding(
      originalRef,
      originalRef.chapterId,
      relocated.order,
      relocated.finding,
      args.makeId,
    );
    refs.push(originalRef);
    sources.push(sourceFromSnapshot(originalRef, snapshot));
    snapshots.push(snapshot);
  }

  return { refs, sources, snapshots };
}

function targetChapterId(
  task: AgentTask,
  pendingProposal: PendingProposal | null,
): string | null {
  if (task.kind === "conversation") return task.targetChapterId;
  if (task.kind === "proposal-follow-up") {
    if (
      pendingProposal === null ||
      pendingProposal.id !== task.proposalId
    ) {
      throw new Error(`Pending proposal not found: ${task.proposalId}`);
    }
    return pendingProposal.chapterId;
  }
  return task.chapterId;
}

async function freezeTaskAndTarget(args: {
  projectRoot: string;
  task: AgentTask;
  pendingProposal: PendingProposal | null;
}): Promise<{ task: AgentTask; chapter: LoadedChapter | null }> {
  const task = structuredClone(args.task);
  const chapterId = targetChapterId(task, args.pendingProposal);
  const chapter =
    chapterId === null
      ? null
      : await loadChapterSnapshot(args.projectRoot, chapterId);
  if (task.kind !== "bridge") return { task, chapter };
  if (chapter === null || chapter.chapterId !== task.chapterId) {
    throw new Error(`Bridge chapter is unavailable: ${task.chapterId}`);
  }
  return {
    task: {
      ...task,
      successorBlockId: findBridgeSuccessor(
        chapter.blocks,
        task.anchorBlockId,
      ),
    },
    chapter,
  };
}

async function loadExactTaskAndTarget(args: {
  projectRoot: string;
  task: AgentTask;
  pendingProposal: PendingProposal | null;
}): Promise<{ task: AgentTask; chapter: LoadedChapter | null }> {
  const task = structuredClone(args.task);
  const chapterId = targetChapterId(task, args.pendingProposal);
  return {
    task,
    chapter:
      chapterId === null
        ? null
        : await loadChapterSnapshot(args.projectRoot, chapterId),
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
    chapters: selected.map((chapter) => {
      const cards = meta.chapters[chapter.id]?.cards ?? [];
      return {
        chapterId: chapter.id,
        title: chapter.title,
        cards: cards.map((card, order) => ({
          id: card.id,
          order,
          title: card.title,
          intention: card.intention,
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
  return {
    chapterTitle: chapter.title,
    blocksText: prose.map((block) => block.text).join("\n\n"),
    cursorSummary: "Reviewing the frozen chapter.",
    characters: meta.characters.map((character) => ({
      name: character.name,
      role: character.role,
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

function taggedError(code: AgentErrorCode, error: unknown): ErrorWithDetails {
  const wrapped = new Error(errorDetails(error), { cause: error }) as ErrorWithDetails;
  wrapped.agentErrorCode = code;
  return wrapped;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorCode(error: unknown, phase: AgentErrorCode | null): AgentErrorCode {
  if (phase !== null) return phase;
  if (
    error instanceof Error &&
    (error as ErrorWithDetails).agentErrorCode !== undefined
  ) {
    return (error as ErrorWithDetails).agentErrorCode as AgentErrorCode;
  }
  if (!(error instanceof Error)) return "unknown";
  if (
    error.name.includes("APICallError") ||
    error.name.includes("RetryError") ||
    error.name.includes("DownloadError") ||
    error.name.includes("EmptyResponseBodyError") ||
    "statusCode" in error ||
    "status" in error
  ) {
    return "transport";
  }
  if (
    error.name.includes("InvalidTool") ||
    error.name.includes("NoSuchTool") ||
    error.name.includes("ToolCall")
  ) {
    return "tool";
  }
  return "unknown";
}

function runError(error: unknown, phase: AgentErrorCode | null): AgentRunError {
  return { code: errorCode(error, phase), message: errorDetails(error) };
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
      error: null,
      errorCode: null,
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
  error: string | null;
  errorCode: AgentErrorCode | null;
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
      error: args.error,
      errorCode: args.errorCode,
      retryOf: args.retryOf,
      usage: requireMetadata(args.message).usage,
    },
  };
}

export function createAgentController(
  dependencies: AgentControllerDependencies,
) {
  let activeController: ActiveController | null = null;

  const ownsRun = (projectRoot: string, runId: string): boolean => {
    if (
      activeController === null ||
      activeController.projectRoot !== projectRoot ||
      activeController.runId !== runId
    ) {
      return false;
    }
    const project = useProjectStore.getState().project;
    if (project === null || project.root !== projectRoot) return false;
    const consoleState = useAgentConsoleStore.getState();
    if (
      consoleState.hydratedProjectRoot !== null &&
      consoleState.hydratedProjectRoot !== projectRoot
    ) {
      return false;
    }
    return (
      consoleState.runStatus !== "idle" &&
      (consoleState.activeRun === null ||
        consoleState.activeRun.id === runId)
    );
  };

  const checkToolRun = (projectRoot: string, runId: string): void => {
    activeController?.controller.signal.throwIfAborted();
    if (!ownsRun(projectRoot, runId)) {
      throw taggedError(
        "tool",
        new Error(`Agent tool no longer owns run: ${runId}`),
      );
    }
  };

  const toolEnvironment = (args: {
    run: AgentRun;
    project: ProjectInfo;
    meta: ProjectMeta;
    targetChapter: LoadedChapter | null;
    history: AgentUIMessage[];
    assistantMessageId: string;
    signal: AbortSignal;
  }): AgentToolEnvironment => {
    const targetSnapshot =
      args.targetChapter === null
        ? null
        : {
            chapterId: args.targetChapter.chapterId,
            title: args.targetChapter.title,
            blocks: args.targetChapter.blocks.map((block, order) => ({
              id: block.id,
              order,
              type: block.type,
              text: block.text,
              fingerprint: blockFingerprint(block),
            })),
          };
    const requireTarget = (chapterId: string): LoadedChapter => {
      checkToolRun(args.run.projectRoot, args.run.id);
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
      checkToolRun(args.run.projectRoot, args.run.id);
      return useAgentConsoleStore.getState().pendingProposal;
    };
    return {
      run: args.run,
      signal: args.signal,
      readChapter: async (chapterId) => {
        requireTarget(chapterId);
        if (targetSnapshot === null) {
          throw taggedError(
            "tool",
            new Error(`Chapter snapshot is unavailable: ${chapterId}`),
          );
        }
        return structuredClone(targetSnapshot);
      },
      readOutline: async (chapterId) => {
        checkToolRun(args.run.projectRoot, args.run.id);
        return outlineValue(args.project, args.meta, chapterId);
      },
      readLore: async (query) => {
        checkToolRun(args.run.projectRoot, args.run.id);
        return loreValue(args.meta, query);
      },
      runCritique: async (chapterId, focus, signal) => {
        const chapter = requireTarget(chapterId);
        try {
          const result = await critique(
            anchoredContext(chapter, args.meta, focus),
            { signal },
          );
          checkToolRun(args.run.projectRoot, args.run.id);
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
            { signal },
          );
          checkToolRun(args.run.projectRoot, args.run.id);
          return result;
        } catch (error) {
          if (isAbortError(error)) throw error;
          throw taggedError("tool", error);
        }
      },
      readConversationContext: (messageIds) => {
        checkToolRun(args.run.projectRoot, args.run.id);
        return conversationValue(args.history, messageIds);
      },
      getPendingProposal: currentPending,
      buildManuscriptProposal: (input) => {
        const chapterId = targetChapterId(args.run.task, currentPending());
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
          });
        } catch (error) {
          throw taggedError("tool", error);
        }
      },
      buildOutlineProposal: (input) => {
        const chapterId = targetChapterId(args.run.task, currentPending());
        if (chapterId === null) {
          throw taggedError(
            "tool",
            new Error("The frozen run has no outline target."),
          );
        }
        requireTarget(chapterId);
        const cards = args.meta.chapters[chapterId]?.cards ?? [];
        try {
          return buildOutlinePendingProposal({
            run: args.run,
            raw: { chapterId, ...input },
            cards,
            currentPending: currentPending(),
            originatingMessageId: args.assistantMessageId,
            makeId: dependencies.id,
            now: dependencies.now(),
          });
        } catch (error) {
          throw taggedError("tool", error);
        }
      },
      replacePendingProposal: (proposal) => {
        if (!ownsRun(args.run.projectRoot, args.run.id)) return;
        useAgentConsoleStore.getState().replacePendingProposal(proposal);
      },
    };
  };

  const cancelPreflight = (): void => {
    useAgentConsoleStore.setState({
      activeRun: null,
      runStatus: "idle",
      runError: null,
    });
  };

  const interruptVisibleRun = (
    active: ActiveController,
    reason: "stopped" | "project-switch" | "app-exit",
  ): void => {
    const state = useAgentConsoleStore.getState();
    const activeRun = state.activeRun;
    if (activeRun === null || activeRun.id !== active.runId) {
      cancelPreflight();
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
      state.upsertAssistantMessage({
        ...assistant,
        metadata: {
          ...requireMetadata(assistant),
          state: "stopped",
          error: null,
          errorCode: null,
        },
      });
    }
    state.interruptRun({
      runId: active.runId,
      userMessageId: active.userMessageId,
      assistantMessageId: assistant?.id ?? null,
      reason,
      interruptedAt: dependencies.now(),
    });
  };

  const runSubmission = async (capture: SubmissionCapture): Promise<void> => {
    const runId = dependencies.id();
    const userMessageId = dependencies.id();
    const assistantMessageId = dependencies.id();
    const abortController = new AbortController();
    try {
      useAgentConsoleStore.getState().beginPreflight();
    } catch (error) {
      const refusal = { code: "unknown" as const, message: ACTIVE_RUN_ERROR };
      useAgentConsoleStore.setState({ runError: refusal });
      throw error;
    }
    activeController = {
      projectRoot: capture.projectRoot,
      runId,
      userMessageId,
      assistantMessageId,
      controller: abortController,
    };
    const ownsCurrentRun = () => ownsRun(capture.projectRoot, runId);
    let enteredRun = false;
    let latestAssistant: AgentUIMessage | null = null;
    let failurePhase: AgentErrorCode | null = null;

    try {
      if (capture.modelId === null) {
        failurePhase = "configuration";
        throw new Error(
          "Select an AI model in Settings before using AI features.",
        );
      }
      failurePhase = "configuration";
      const model = await dependencies.getModel();
      if (!ownsCurrentRun()) return;
      const contextWindow = modelContextWindow(capture.modelId);
      failurePhase = null;

      const attachments = await capture.resolveAttachments(
        abortController.signal,
        ownsCurrentRun,
      );
      if (!ownsCurrentRun()) return;
      if (attachments.snapshots.length !== attachments.refs.length) {
        throw new Error(
          "Remove unavailable context sources before submitting this request.",
        );
      }

      const frozen = await capture.resolveTaskAndTarget();
      if (!ownsCurrentRun()) return;

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
        if (!ownsCurrentRun()) return;
        summary = compacted.summary;
        if (summary !== null && summary !== capture.summary) {
          useAgentConsoleStore.getState().setSummary(summary);
        }
      }
      if (!ownsCurrentRun()) return;

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
      const instructions = buildAgentInstructions({
        mode: run.mode,
        task: run.task,
        styleGuide: capture.styleGuide,
        editingRules: capture.editingRules,
      });
      const environment = toolEnvironment({
        run,
        project: capture.project,
        meta: capture.meta,
        targetChapter: frozen.chapter,
        history: capture.messages,
        assistantMessageId,
        signal: abortController.signal,
      });
      capture.enterRun(run, user, attachments.refs);
      enteredRun = true;
      if (!ownsCurrentRun()) return;
      useAgentConsoleStore.getState().markStreaming();

      const result = await dependencies.stream({
        model,
        modelId: capture.modelId,
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
            error: null,
            errorCode: null,
          });
          useAgentConsoleStore
            .getState()
            .upsertAssistantMessage(latestAssistant);
        },
      });
      if (!ownsCurrentRun()) return;
      const completed = assistantMetadata({
        message: result.message,
        run,
        state: "complete",
        retryOf: capture.retryOf,
        error: null,
        errorCode: null,
      });
      const sanitized = sanitizeAgentMessages([completed]);
      if (sanitized.length !== 1) {
        throw new Error(`Agent run emitted no settled message: ${run.id}`);
      }
      useAgentConsoleStore.getState().finishRun(sanitized[0], result.usage);
    } catch (error) {
      if (!ownsCurrentRun()) return;
      if (isAbortError(error)) {
        if (activeController !== null) {
          interruptVisibleRun(activeController, "stopped");
        }
        return;
      }
      const failure = runError(error, failurePhase);
      if (!enteredRun) {
        useAgentConsoleStore.getState().failPreflight(failure);
      } else {
        const run = useAgentConsoleStore.getState().activeRun;
        if (run === null) return;
        const base =
          latestAssistant ??
          ({
            id: assistantMessageId,
            role: "assistant",
            metadata: {
              runId: run.id,
              mode: run.mode,
              task: run.task,
              state: "error",
              createdAt: run.startedAt,
              error: failure.message,
              errorCode: failure.code,
              retryOf: capture.retryOf,
              usage: null,
            },
            parts: [],
          } satisfies AgentUIMessage);
        const failed = assistantMetadata({
          message: base,
          run,
          state: "error",
          retryOf: capture.retryOf,
          error: failure.message,
          errorCode: failure.code,
        });
        useAgentConsoleStore.getState().failRun(failed, failure.message);
      }
      throw error;
    } finally {
      if (
        activeController?.projectRoot === capture.projectRoot &&
        activeController.runId === runId
      ) {
        activeController = null;
        void refreshAttachedDraftSources();
      }
    }
  };

  const contextResolver = (args: {
    projectRoot: string;
    refs: DraftContextRef[];
    locators: Record<string, DraftSourceLocator>;
    meta: ProjectMeta;
    messages: AgentUIMessage[];
    publish: (resolved: ResolvedDraftContext) => void;
  }) => {
    return async (
      _signal: AbortSignal,
      ownsCurrentRun: () => boolean,
    ): Promise<{ refs: DraftContextRef[]; snapshots: ContextSnapshot[] }> => {
      const resolved = await resolveDraftContext({
        projectRoot: args.projectRoot,
        refs: args.refs,
        locators: args.locators,
        meta: args.meta,
        messages: args.messages,
        makeId: dependencies.id,
        rebase: (previous, current) => {
          if (!ownsCurrentRun()) return;
          useAgentConsoleStore
            .getState()
            .rebaseDraftContextRef(previous, current);
        },
      });
      if (ownsCurrentRun()) args.publish(resolved);
      return { refs: resolved.refs, snapshots: resolved.snapshots };
    };
  };

  const captureBase = (args: {
    mode: AgentMode;
    text: string;
    task: AgentTask;
    retryOf: string | null;
  }): Omit<
    SubmissionCapture,
    "resolveAttachments" | "enterRun"
  > => {
    const projectState = useProjectStore.getState();
    const project = projectState.project;
    if (project === null) throw new Error("Open a project before running the agent.");
    const settings = useSettingsStore.getState();
    const consoleState = useAgentConsoleStore.getState();
    const task = structuredClone(args.task);
    const pendingProposal =
      consoleState.pendingProposal === null
        ? null
        : structuredClone(consoleState.pendingProposal);
    return {
      projectRoot: project.root,
      project: cloneProject(project),
      meta: structuredClone(projectState.meta),
      mode: args.mode,
      task,
      text: args.text,
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
      resolveTaskAndTarget: () =>
        freezeTaskAndTarget({
          projectRoot: project.root,
          task,
          pendingProposal,
        }),
    };
  };

  const submitAgentDraft = async (task: AgentTask): Promise<void> => {
    const projectState = useProjectStore.getState();
    const project = projectState.project;
    if (project === null) throw new Error("Open a project before running the agent.");
    const consoleState = useAgentConsoleStore.getState();
    const settings = useSettingsStore.getState();
    const refs = structuredClone(consoleState.draftContextRefs);
    const text = consoleState.draftText;
    const frozenTask = structuredClone(task);
    const pendingProposal =
      consoleState.pendingProposal === null
        ? null
        : structuredClone(consoleState.pendingProposal);
    const capture: SubmissionCapture = {
      projectRoot: project.root,
      project: cloneProject(project),
      meta: structuredClone(projectState.meta),
      mode: consoleState.mode,
      task: frozenTask,
      text,
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
      resolveTaskAndTarget: () =>
        freezeTaskAndTarget({
          projectRoot: project.root,
          task: frozenTask,
          pendingProposal,
        }),
      resolveAttachments: contextResolver({
        projectRoot: project.root,
        refs,
        locators: structuredClone(consoleState.draftSourceLocators),
        meta: structuredClone(projectState.meta),
        messages: structuredClone(consoleState.messages),
        publish: (resolved) => {
          useAgentConsoleStore
            .getState()
            .setDraftContextSources(resolved.sources);
        },
      }),
      enterRun: (run, user, resolvedRefs) => {
        useAgentConsoleStore.getState().beginDraftRun(run, user, {
          text,
          refs: resolvedRefs,
        });
      },
    };
    await runSubmission(capture);
  };

  const submitAgentRequest = async (
    request: Extract<AgentIntent, { kind: "run" }>,
  ): Promise<void> => {
    const base = captureBase({
      mode: request.mode,
      text: request.text,
      task: request.task,
      retryOf: null,
    });
    const consoleState = useAgentConsoleStore.getState();
    const refs = structuredClone(request.refs);
    await runSubmission({
      ...base,
      resolveAttachments: contextResolver({
        projectRoot: base.projectRoot,
        refs,
        locators: structuredClone(consoleState.draftSourceLocators),
        meta: base.meta,
        messages: base.messages,
        publish: () => undefined,
      }),
      enterRun: (run, user) => {
        useAgentConsoleStore.getState().beginRun(run, user);
      },
    });
  };

  const stopAgentRun = (): void => {
    const active = activeController;
    if (active === null) return;
    interruptVisibleRun(active, "stopped");
    active.controller.abort();
    activeController = null;
    void refreshAttachedDraftSources();
  };

  const retryAgentTurn = async (userMessageId: string): Promise<void> => {
    const consoleState = useAgentConsoleStore.getState();
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
    });
    await runSubmission({
      ...base,
      resolveTaskAndTarget: () =>
        loadExactTaskAndTarget({
          projectRoot: base.projectRoot,
          task: base.task,
          pendingProposal: base.pendingProposal,
        }),
      resolveAttachments: async () => ({
        refs,
        snapshots: snapshots.map((snapshot) => ({ ...snapshot })),
      }),
      enterRun: (run, user) => {
        useAgentConsoleStore.getState().beginRun(run, user);
      },
    });
  };

  const recordProposalEvent = (event: ProposalEventData): void => {
    const mode = useAgentConsoleStore.getState().mode;
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
        error: null,
        errorCode: null,
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
    useAgentConsoleStore.getState().appendLocalMessage(message);
  };

  const abortAgentRunForProjectSwitch = (
    projectRoot: string,
    reason: "project-switch" | "app-exit",
  ): void => {
    const active = activeController;
    if (active === null || active.projectRoot !== projectRoot) return;
    interruptVisibleRun(active, reason);
    active.controller.abort();
    activeController = null;
  };

  const dispatchAgentIntent = async (intent: AgentIntent): Promise<void> => {
    useViewStore.setState({ aiOpen: true, aiCollapsed: false });
    try {
      if (intent.kind === "focus") {
        useAgentConsoleStore.getState().setMode(intent.mode);
        return;
      }
      if (intent.kind === "add-context") {
        const store = useAgentConsoleStore.getState();
        store.addDraftContextRefs(intent.refs);
        const state = useAgentConsoleStore.getState();
        const projectState = useProjectStore.getState();
        const project = projectState.project;
        if (project === null) {
          throw new Error("Open a project before adding agent context.");
        }
        const ownsContextProject = (): boolean => {
          const currentProject = useProjectStore.getState().project;
          const hydratedRoot =
            useAgentConsoleStore.getState().hydratedProjectRoot;
          return (
            currentProject !== null &&
            currentProject.root === project.root &&
            (hydratedRoot === null || hydratedRoot === project.root)
          );
        };
        let resolved: ResolvedDraftContext;
        try {
          resolved = await resolveDraftContext({
            projectRoot: project.root,
            refs: state.draftContextRefs,
            locators: state.draftSourceLocators,
            meta: structuredClone(projectState.meta),
            messages: structuredClone(state.messages),
            makeId: dependencies.id,
            rebase: (previous, current) => {
              if (!ownsContextProject()) return;
              useAgentConsoleStore
                .getState()
                .rebaseDraftContextRef(previous, current);
            },
          });
        } catch (error) {
          if (!ownsContextProject()) return;
          throw error;
        }
        if (ownsContextProject()) {
          useAgentConsoleStore
            .getState()
            .setDraftContextSources(resolved.sources);
        }
        return;
      }
      if (intent.kind === "prefill") {
        const store = useAgentConsoleStore.getState();
        store.setMode(intent.mode);
        store.setDraftText(intent.text);
        store.addDraftContextRefs(intent.refs);
        await dispatchAgentIntent({ kind: "add-context", refs: [] });
        return;
      }
      useAgentConsoleStore.getState().setMode(intent.mode);
      await submitAgentRequest(intent);
    } catch (error) {
      if (useAgentConsoleStore.getState().runError === null) {
        const failure = runError(error, null);
        useAgentConsoleStore.setState({ runError: failure });
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

async function refreshAttachedDraftSources(): Promise<void> {
  const sequence = ++draftSourceRefreshSequence;
  const projectState = useProjectStore.getState();
  const project = projectState.project;
  const consoleState = useAgentConsoleStore.getState();
  if (
    project === null ||
    consoleState.runStatus !== "idle" ||
    consoleState.draftContextRefs.length === 0 ||
    (consoleState.hydratedProjectRoot !== null &&
      consoleState.hydratedProjectRoot !== project.root)
  ) {
    return;
  }
  const expectedRoot = project.root;
  const expectedRefs = consoleState.draftContextRefs.map(draftContextRefKey);
  try {
    const resolved = await resolveDraftContext({
      projectRoot: expectedRoot,
      refs: structuredClone(consoleState.draftContextRefs),
      locators: structuredClone(consoleState.draftSourceLocators),
      meta: structuredClone(projectState.meta),
      messages: structuredClone(consoleState.messages),
      makeId: () => uid("agent-source"),
      rebase: (previous, current) => {
        if (sequence !== draftSourceRefreshSequence) return;
        useAgentConsoleStore
          .getState()
          .rebaseDraftContextRef(previous, current);
      },
    });
    const currentProject = useProjectStore.getState().project;
    const currentConsole = useAgentConsoleStore.getState();
    const currentRefs = currentConsole.draftContextRefs.map(draftContextRefKey);
    const resolvedRefs = resolved.refs.map(draftContextRefKey);
    if (
      sequence !== draftSourceRefreshSequence ||
      currentProject === null ||
      currentProject.root !== expectedRoot ||
      currentConsole.runStatus !== "idle" ||
      (currentRefs.join("\n") !== expectedRefs.join("\n") &&
        currentRefs.join("\n") !== resolvedRefs.join("\n"))
    ) {
      return;
    }
    currentConsole.setDraftContextSources(resolved.sources);
  } catch (error) {
    console.error("Agent draft context refresh failed", {
      projectRoot: expectedRoot,
      error,
    });
  }
}

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
  summarize: async (model, source, signal) => {
    const result = await generateText({
      model,
      prompt: source,
      abortSignal: signal,
    });
    return result.text;
  },
  stream: streamAgentRun,
});

export const submitAgentDraft = productionController.submitAgentDraft;
export const submitAgentRequest = productionController.submitAgentRequest;
export const stopAgentRun = productionController.stopAgentRun;
export const retryAgentTurn = productionController.retryAgentTurn;
export const recordProposalEvent = productionController.recordProposalEvent;
export const abortAgentRunForProjectSwitch =
  productionController.abortAgentRunForProjectSwitch;
export const dispatchAgentIntent = productionController.dispatchAgentIntent;
