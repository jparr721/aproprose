import {
  blockFingerprint,
  draftContextRefKey,
  findingFingerprint,
  flattenMessageFindings,
  resolveDraftSnapshots,
} from "@/lib/ai/agent-context";
import { buildCharacterGrounding } from "@/lib/ai/character-grounding";
import type {
  AgentIntent,
  AgentMode,
  AgentProposalRecord,
  AgentRun,
  AgentSessionId,
  AgentTask,
  AgentUIMessage,
  ContextSnapshot,
  DraftContextRef,
  DraftContextSource,
  DraftSourceLocator,
  PendingProposal,
} from "@/lib/ai/agent-types";
import { PROJECT_AGENT_SESSION } from "@/lib/ai/agent-types";
import { uid } from "@/lib/id";
import { parseChapter } from "@/lib/latex";
import type { OutlinePlannerGroundingInput } from "@/lib/outline/planner-grounding";
import { readTextFile } from "@/lib/tauri";
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
  selectPendingProposal,
  requireAgentSessionProject,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useSettingsStore } from "@/stores/settings-store";

interface LoadedChapterBlock extends Block {
  order: number;
  fingerprint: string;
}

export interface LoadedChapter {
  chapterId: string;
  title: string;
  sourceGeneration: string;
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

export interface SubmissionCapture {
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
  proposalRecords: AgentProposalRecord[];
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

interface AgentSubmissionContext {
  captureDraftSubmission: (
    task: AgentTask,
    requestedSessionId: AgentSessionId | undefined,
  ) => SubmissionCapture | null;
  captureRequestSubmission: (
    request: Extract<AgentIntent, { kind: "run" }>,
    requestedSessionId: AgentSessionId | undefined,
  ) => SubmissionCapture | null;
  captureRetrySubmission: (
    userMessageId: string,
    requestedSessionId: AgentSessionId | undefined,
  ) => SubmissionCapture;
  resolveAgentDraftContext: (sessionId: AgentSessionId) => Promise<void>;
}

export class OutlinePlannerGroundingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OutlinePlannerGroundingError";
  }
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
  sourceGeneration: string,
): LoadedChapter {
  return {
    chapterId,
    title,
    sourceGeneration,
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
  sourceGeneration: string,
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
  return loadedChapter(chapter.id, chapter.title, blocks, sourceGeneration);
}

export async function loadChapterSnapshot(
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
  return loadedChapter(chapterId, chapter.title, parseChapter(source), uid());
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

export function targetChapterId(
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

export function requireBridgeAnchor(task: AgentTask, chapter: LoadedChapter): void {
  if (task.kind !== "bridge") return;
  if (chapter.chapterId !== task.chapterId) {
    throw new Error(`Bridge chapter is unavailable: ${task.chapterId}`);
  }
  if (task.anchorBlockId === null) {
    if (chapter.blocks.some((block) => block.type === "narration" || block.type === "dialogue")) {
      throw new Error("The empty continuation boundary changed. Suggest again from the current prose.");
    }
    return;
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

export async function resolveOutlinePlannerGroundingInput(
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
  return {
    chapters: capture.project.chapters,
    meta: capture.meta,
    targetChapterId: chapterId,
    target,
    previous: null,
    next: null,
  };
}

export function characterDescribeGrounding(
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

export function textExcerpt(message: AgentUIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export function messageSnapshots(message: AgentUIMessage): ContextSnapshot[] {
  return message.parts.flatMap((part) =>
    part.type === "data-context"
      ? part.data.snapshots.map((snapshot) => ({ ...snapshot }))
      : [],
  );
}

export function createAgentSubmissionContext(
  makeId: () => string,
): AgentSubmissionContext {
  const contextResolver = (args: {
    project: ProjectInfo;
    activeChapter: LoadedChapter | null;
    attachments: CapturedContextAttachment[];
    locators: Record<string, DraftSourceLocator>;
    meta: ProjectMeta;
    messages: AgentUIMessage[];
    publish: (resolved: ResolvedDraftContext) => void;
  }): SubmissionCapture["resolveAttachments"] => {
    const capture = captureDraftContext(args);
    return async (
      _signal: AbortSignal,
      ownsCurrentRun: () => boolean,
    ): Promise<{ refs: DraftContextRef[]; snapshots: ContextSnapshot[] }> => {
      const resolved = await resolveDraftContext({
        ...capture,
        makeId,
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
    const pendingTarget = task.kind === "proposal-follow-up"
      ? selectPendingProposal(consoleState, task.proposalId)
      : consoleState.pendingProposal;
    const pendingProposal = pendingTarget === null ? null : structuredClone(pendingTarget);
    const frozenProject = cloneProject(project);
    const activeChapter = captureActiveChapter(
      frozenProject,
      projectState.activeChapterId,
      projectState.blocks,
      projectState.chapterSourceGeneration,
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
      proposalRecords: structuredClone(consoleState.proposalRecords),
      retryOf: args.retryOf,
      activeChapter,
    };
  };

  const captureDraftSubmission = (
    task: AgentTask,
    requestedSessionId: AgentSessionId | undefined,
  ): SubmissionCapture | null => {
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
      return null;
    }
    const frozenTask = structuredClone(task);
    const pendingTarget = frozenTask.kind === "proposal-follow-up"
      ? selectPendingProposal(consoleState, frozenTask.proposalId)
      : consoleState.pendingProposal;
    const pendingProposal = pendingTarget === null ? null : structuredClone(pendingTarget);
    const frozenProject = cloneProject(project);
    const activeChapter = captureActiveChapter(
      frozenProject,
      projectState.activeChapterId,
      projectState.blocks,
      projectState.chapterSourceGeneration,
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
      proposalRecords: structuredClone(consoleState.proposalRecords),
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
    return capture;
  };

  const captureRequestSubmission = (
    request: Extract<AgentIntent, { kind: "run" }>,
    requestedSessionId: AgentSessionId | undefined,
  ): SubmissionCapture | null => {
    const sessionId = structuredClone(
      requestedSessionId ?? PROJECT_AGENT_SESSION,
    );
    const frozenRequest = structuredClone(request);
    if (
      frozenRequest.text.trim() === "" &&
      frozenRequest.refs.length === 0
    ) {
      return null;
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
    return {
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
    };
  };

  const captureRetrySubmission = (
    userMessageId: string,
    requestedSessionId: AgentSessionId | undefined,
  ): SubmissionCapture => {
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
    return {
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
    };
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
      projectState.chapterSourceGeneration,
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
        makeId,
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

  return {
    captureDraftSubmission,
    captureRequestSubmission,
    captureRetrySubmission,
    resolveAgentDraftContext,
  };
}

let draftSourceRefreshSequence = 0;

interface DraftSourceRefreshOwnership {
  sequence: number;
  projectRoot: string;
}

export function invalidateDraftSourceRefreshes(): void {
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

export async function refreshAttachedDraftSources(): Promise<void> {
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
    projectState.chapterSourceGeneration,
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
