import { useSyncExternalStore } from "react";
import { create, useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { StateCreator } from "zustand";
import { draftContextRefKey } from "@/lib/ai/agent-context";
import type {
  AgentMode,
  AgentHydrationState,
  AgentProposalRecord,
  AgentSessionId,
  AgentMessageMetadata,
  AgentPersistenceIssue,
  AgentFailure,
  AgentRun,
  AgentRunStatus,
  AgentUIMessage,
  ConversationSummary,
  DraftContextAttachment,
  DraftContextRef,
  DraftContextSource,
  DraftSourceLocator,
  InterruptedRun,
  ManuscriptPendingChange,
  ManuscriptPendingProposal,
  PendingProposal,
  PersistedPendingProposal,
  PersistedUsage,
  ProposalChangeDecision,
  ProposalReviewPreconditions,
  ProposalSource,
  SubmittedAgentDraft,
} from "@/lib/ai/agent-types";
import {
  ownsAgentPersistenceTransition,
  type AgentPersistenceTransition,
  type AgentPersistenceTransitionCapture,
  type AgentPersistenceTransitionKind,
} from "@/stores/agent-persistence-coordinator";

export type {
  AgentPersistenceTransition,
  AgentPersistenceTransitionCapture,
  AgentPersistenceTransitionKind,
} from "@/stores/agent-persistence-coordinator";

export type AgentPersistenceTransitionCompletion =
  | { status: "stale" }
  | { status: "current" };

export type AgentConsoleOwnershipStatus =
  | "ready"
  | "transition"
  | "unavailable";

export interface AgentDraftContextResolution {
  attachment: DraftContextAttachment;
  ref: DraftContextRef;
  source: DraftContextSource;
}

export interface PendingManuscriptTextEdit {
  proposalId: string;
  changeId: string;
  newText: string;
}

export type PendingProposalEditErrorCode =
  | "proposal-mismatch"
  | "wrong-kind"
  | "change-missing"
  | "change-not-editable";

export class PendingProposalEditError extends Error {
  readonly code: PendingProposalEditErrorCode;

  constructor(code: PendingProposalEditErrorCode, message: string) {
    super(message);
    this.name = "PendingProposalEditError";
    this.code = code;
  }
}

export interface AgentConsoleData {
  mode: AgentMode;
  messages: AgentUIMessage[];
  summary: ConversationSummary | null;
  draftText: string;
  draftContextRefs: DraftContextRef[];
  draftContextSources: Record<string, DraftContextSource>;
  draftSourceLocators: Record<string, DraftSourceLocator>;
  pendingProposal: PendingProposal | null;
  proposalRecords: AgentProposalRecord[];
  currentProposalId: string | null;
  lastUsage: PersistedUsage | null;
  interruptedRun: InterruptedRun | null;
  activeRun: AgentRun | null;
  runStatus: AgentRunStatus;
  activityOpenOverride: boolean | null;
  runError: AgentFailure | null;
  persistenceIssue: AgentPersistenceIssue | null;
  requestedProjectRoot: string | null;
  activeProjectRoot: string | null;
  hydratedProjectRoot: string | null;
  draftRevision: number;
  draftTextRevision: number;
  draftContextVersions: Record<string, number>;
  persistenceTransition: AgentPersistenceTransition | null;
  persistenceTransitionSequence: number;
}

export interface AgentConsoleState extends AgentConsoleData {
  hydrate: (projectRoot: string, state: AgentHydrationState) => void;
  beginPersistenceTransition: (
    projectRoot: string | null,
    kind: AgentPersistenceTransitionKind,
  ) => AgentPersistenceTransitionCapture;
  activatePersistenceTransition: (
    capture: AgentPersistenceTransitionCapture,
  ) => boolean;
  completePersistenceTransition: (
    capture: AgentPersistenceTransitionCapture,
    state: AgentHydrationState,
  ) => AgentPersistenceTransitionCompletion;
  finishPersistenceTransition: (
    capture: AgentPersistenceTransitionCapture,
  ) => void;
  resetProject: () => void;
  setMode: (mode: AgentMode) => void;
  setDraftText: (text: string) => void;
  setDraftContextRefs: (refs: DraftContextRef[]) => void;
  addDraftContextRefs: (refs: DraftContextRef[]) => void;
  removeDraftContextRef: (ref: DraftContextRef) => void;
  setDraftContextSources: (sources: DraftContextSource[]) => void;
  applyDraftContextResolution: (
    attachments: DraftContextAttachment[],
    resolutions: AgentDraftContextResolution[],
  ) => void;
  captureDraft: () => SubmittedAgentDraft;
  beginPreflight: () => void;
  failPreflight: (failure: AgentFailure) => void;
  beginRun: (run: AgentRun, userMessage: AgentUIMessage) => void;
  beginDraftRun: (
    run: AgentRun,
    userMessage: AgentUIMessage,
    submitted: SubmittedAgentDraft,
  ) => void;
  markStreaming: () => void;
  upsertAssistantMessage: (message: AgentUIMessage) => void;
  finishRun: (
    message: AgentUIMessage | null,
    usage: PersistedUsage | null,
  ) => void;
  interruptRun: (interrupted: InterruptedRun) => void;
  failRun: (message: AgentUIMessage, failure: AgentFailure) => void;
  replacePendingProposal: (proposal: PendingProposal) => void;
  stageProposal: (proposal: PendingProposal, source: ProposalSource) => void;
  commitProposalReplacement: (
    targetId: string,
    proposal: PendingProposal,
    source: ProposalSource,
  ) => void;
  decideProposalChanges: (
    proposalId: string,
    changeIds: string[],
    decision: ProposalChangeDecision,
    reviewPreconditions?: ProposalReviewPreconditions,
  ) => void;
  restoreProposalChanges: (proposalId: string, changeIds: string[]) => void;
  updatePendingManuscriptText: (edit: PendingManuscriptTextEdit) => void;
  appendLocalMessage: (message: AgentUIMessage) => void;
  setSummary: (summary: ConversationSummary) => void;
  setPersistenceIssue: (issue: AgentPersistenceIssue | null) => void;
  setActivityOpenOverride: (open: boolean) => void;
}

export const EMPTY_AGENT_STATE: AgentConsoleData = {
  mode: "writing",
  messages: [],
  summary: null,
  draftText: "",
  draftContextRefs: [],
  draftContextSources: {},
  draftSourceLocators: {},
  pendingProposal: null,
  proposalRecords: [],
  currentProposalId: null,
  lastUsage: null,
  interruptedRun: null,
  activeRun: null,
  runStatus: "idle",
  activityOpenOverride: null,
  runError: null,
  persistenceIssue: null,
  requestedProjectRoot: null,
  activeProjectRoot: null,
  hydratedProjectRoot: null,
  draftRevision: 0,
  draftTextRevision: 0,
  draftContextVersions: {},
  persistenceTransition: null,
  persistenceTransitionSequence: 0,
};

const ACTIVE_RUN_ERROR = "An agent run is already active";

function upsertMessage(
  messages: AgentUIMessage[],
  message: AgentUIMessage,
): AgentUIMessage[] {
  const existingIndex = messages.findIndex((current) => current.id === message.id);
  if (existingIndex < 0) {
    return [...messages, message];
  }
  return messages.map((current, index) =>
    index === existingIndex ? message : current,
  );
}

function requireAgentMetadata(message: AgentUIMessage): AgentMessageMetadata {
  if (message.metadata === undefined) {
    throw new Error(`Agent message metadata is missing: ${message.id}`);
  }
  return message.metadata;
}

interface HydratedDraftState {
  mode: AgentMode;
  draftText: string;
  draftContextRefs: DraftContextRef[];
  draftContextSources: Record<string, DraftContextSource>;
  draftSourceLocators: Record<string, DraftSourceLocator>;
  draftRevision: number;
  draftTextRevision: number;
  draftContextVersions: Record<string, number>;
}

interface DraftResolutionCandidate {
  index: number;
  ref: DraftContextRef;
  revision: number;
  captured: boolean;
}

function dedupeDraftContextRefs(refs: DraftContextRef[]): DraftContextRef[] {
  const keys = new Set<string>();
  return refs.filter((ref) => {
    const key = draftContextRefKey(ref);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

function hydratedDraftState(
  persisted: AgentHydrationState,
  currentRevision: number,
): HydratedDraftState {
  let draftRevision = currentRevision;
  const nextRevision = (): number => {
    draftRevision += 1;
    return draftRevision;
  };
  const draftContextRefs = dedupeDraftContextRefs(
    persisted.draftContextRefs,
  );
  const draftSourceLocators: Record<string, DraftSourceLocator> = {};
  const draftContextVersions: Record<string, number> = {};

  for (const ref of draftContextRefs) {
    const key = draftContextRefKey(ref);
    draftContextVersions[key] = nextRevision();
    const locator = persisted.draftSourceLocators[key];
    if (locator !== undefined) draftSourceLocators[key] = locator;
  }

  const draftTextRevision = nextRevision();
  return {
    mode: persisted.mode,
    draftText: persisted.draftText,
    draftContextRefs,
    draftContextSources: {},
    draftSourceLocators,
    draftRevision,
    draftTextRevision,
    draftContextVersions,
  };
}

export class AgentConsoleOwnershipError extends Error {
  readonly agentFailureReason = "transition" as const;

  constructor() {
    super(
      "AI conversation is not ready. Retry when loading finishes.",
    );
    this.name = "AgentConsoleOwnershipError";
  }
}

export function agentConsoleOwnershipStatus(
  state: Pick<
    AgentConsoleState,
    | "requestedProjectRoot"
    | "activeProjectRoot"
    | "hydratedProjectRoot"
    | "persistenceTransition"
  >,
  currentProjectRoot: string | null,
): AgentConsoleOwnershipStatus {
  if (state.persistenceTransition !== null) return "transition";
  if (
    currentProjectRoot === null ||
    state.requestedProjectRoot !== currentProjectRoot ||
    state.activeProjectRoot !== currentProjectRoot ||
    state.hydratedProjectRoot !== currentProjectRoot
  ) {
    return "unavailable";
  }
  return "ready";
}

function requireDraftMutationOwnership(state: AgentConsoleState): void {
  if (
    agentConsoleOwnershipStatus(state, state.activeProjectRoot) !== "ready"
  ) {
    throw new AgentConsoleOwnershipError();
  }
}

function editPendingManuscriptChange(
  item: ManuscriptPendingChange,
  edit: PendingManuscriptTextEdit,
): ManuscriptPendingChange {
  if (item.id !== edit.changeId) return item;
  if (
    (item.change.kind !== "rewrite" && item.change.kind !== "insert") ||
    item.change.newText === null
  ) {
    throw new PendingProposalEditError(
      "change-not-editable",
      `Cannot edit pending change ${item.id}: ${item.change.kind} has no editable text.`,
    );
  }
  if (item.change.segments === undefined) {
    return {
      id: item.id,
      change: {
        kind: item.change.kind,
        blockId: item.change.blockId,
        afterId: item.change.afterId,
        type: item.change.type,
        speaker: item.change.speaker,
        newText: edit.newText,
        toIndex: item.change.toIndex,
        reason: item.change.reason,
      },
      precondition: item.precondition,
    };
  }
  return {
    id: item.id,
    change: {
      kind: item.change.kind,
      blockId: item.change.blockId,
      afterId: item.change.afterId,
      type: item.change.type,
      speaker: item.change.speaker,
      segments: item.change.segments,
      newText: edit.newText,
      toIndex: item.change.toIndex,
      reason: item.change.reason,
    },
    precondition: item.precondition,
  };
}

export function requireAgentConsoleProject(projectRoot: string): void {
  const state = useAgentConsoleStore.getState();
  if (agentConsoleOwnershipStatus(state, projectRoot) !== "ready") {
    throw new AgentConsoleOwnershipError();
  }
}

export function requireAgentSessionProject(
  sessionId: AgentSessionId,
  projectRoot: string,
): void {
  const state = agentSessionStore(sessionId).getState();
  if (agentConsoleOwnershipStatus(state, projectRoot) !== "ready") {
    throw new AgentConsoleOwnershipError();
  }
}

export function proposalChangeIds(
  proposal: PendingProposal | PersistedPendingProposal,
): string[] {
  return [
    ...proposal.changes.map((change) => change.id),
    ...(proposal.overviewChange ? [proposal.overviewChange.id] : []),
  ];
}

export function pendingProposalChangeIds(record: AgentProposalRecord): string[] {
  if (record.replacedByProposalId !== null) return [];
  return proposalChangeIds(record.proposal).filter(
    (id) => record.decisions[id] === undefined,
  );
}

export function proposalWithReviewPreconditions(record: AgentProposalRecord): PendingProposal {
  const proposal = record.proposal;
  const review = record.reviewPreconditions;
  if (review === undefined) return proposal;
  if (proposal.kind === "manuscript" && review.kind === "manuscript") {
    return { ...proposal, changes: proposal.changes.map((item) => ({
      ...item, precondition: review.changes[item.id] ?? item.precondition,
    })) };
  }
  if (proposal.kind === "outline" && review.kind === "outline") {
    return { ...proposal, changes: proposal.changes.map((item) => ({
      ...item, precondition: review.changes[item.id] ?? item.precondition,
    })) };
  }
  throw new AgentProposalRecordError(`Review preconditions do not match proposal ${proposal.id}.`);
}

export function selectPendingProposal(
  state: Pick<AgentConsoleData, "proposalRecords">,
  proposalId: string,
): PendingProposal | null {
  const record = state.proposalRecords.find(
    (candidate) => candidate.proposal.id === proposalId,
  );
  if (record === undefined) return null;
  const pendingIds = new Set(pendingProposalChangeIds(record));
  if (pendingIds.size === 0) return null;
  const proposal = proposalWithReviewPreconditions(record);
  if (pendingIds.size === proposalChangeIds(proposal).length) return proposal;
  if (proposal.kind === "overview") return proposal;
  const overviewChange =
    proposal.overviewChange && pendingIds.has(proposal.overviewChange.id)
      ? proposal.overviewChange
      : null;
  if (proposal.kind === "manuscript") {
    return {
      ...proposal,
      changes: proposal.changes.filter((change) => pendingIds.has(change.id)),
      overviewChange,
    };
  }
  return {
    ...proposal,
    changes: proposal.changes.filter((change) => pendingIds.has(change.id)),
    overviewChange,
  };
}

function proposalProjection(
  proposalRecords: AgentProposalRecord[],
  currentProposalId: string | null,
): Pick<AgentConsoleData, "proposalRecords" | "currentProposalId" | "pendingProposal"> {
  return {
    proposalRecords,
    currentProposalId,
    pendingProposal:
      currentProposalId === null
        ? null
        : selectPendingProposal({ proposalRecords }, currentProposalId),
  };
}

function hydratedProposalState(
  state: AgentHydrationState,
): Pick<AgentConsoleData, "proposalRecords" | "currentProposalId" | "pendingProposal"> {
  if (state.v === 4) {
    return proposalProjection(state.proposalRecords, state.currentProposalId);
  }
  const proposal = state.pendingProposal;
  return proposalProjection(
    proposal === null
      ? []
      : [{ proposal, source: { kind: "legacy" }, decisions: {}, replacedByProposalId: null }],
    proposal === null ? null : proposal.id,
  );
}

export class AgentProposalRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentProposalRecordError";
  }
}

function requireProposalRecord(
  state: AgentConsoleState,
  proposalId: string,
): AgentProposalRecord {
  requireDraftMutationOwnership(state);
  const record = state.proposalRecords.find(
    (candidate) => candidate.proposal.id === proposalId,
  );
  if (record === undefined) {
    throw new AgentProposalRecordError(`Retained proposal not found: ${proposalId}`);
  }
  if (record.proposal.projectRoot !== state.activeProjectRoot) {
    throw new AgentProposalRecordError(`Proposal ${proposalId} belongs to another project.`);
  }
  return record;
}

function requireDecisionIds(
  record: AgentProposalRecord,
  changeIds: string[],
): void {
  const known = new Set(proposalChangeIds(record.proposal));
  if (changeIds.length === 0 || new Set(changeIds).size !== changeIds.length) {
    throw new AgentProposalRecordError(`Proposal ${record.proposal.id} requires unique change IDs.`);
  }
  for (const id of changeIds) {
    if (!known.has(id)) {
      throw new AgentProposalRecordError(`Proposal ${record.proposal.id} has no change ${id}.`);
    }
  }
}

function stagedProposalRecord(
  state: AgentConsoleState,
  proposal: PendingProposal,
  source: ProposalSource,
): AgentProposalRecord {
  requireDraftMutationOwnership(state);
  if (proposal.projectRoot !== state.activeProjectRoot) {
    throw new AgentProposalRecordError(`Cannot stage proposal ${proposal.id} for another project.`);
  }
  if (state.proposalRecords.some((record) => record.proposal.id === proposal.id)) {
    throw new AgentProposalRecordError(`Proposal already exists: ${proposal.id}`);
  }
  const ids = proposalChangeIds(proposal);
  if (new Set(ids).size !== ids.length) {
    throw new AgentProposalRecordError(`Proposal ${proposal.id} has duplicate change IDs.`);
  }
  return { proposal, source, decisions: {}, replacedByProposalId: null };
}

const createAgentConsoleState: StateCreator<AgentConsoleState> = (set, get) => ({
  ...EMPTY_AGENT_STATE,
  hydrate: (projectRoot, state) =>
    set((current) => {
      const draft = hydratedDraftState(state, current.draftRevision);
      return {
        ...draft,
        ...hydratedProposalState(state),
        messages: [...state.messages],
        summary: state.summary,
        lastUsage: state.lastUsage,
        interruptedRun: state.interruptedRun,
        activeRun: null,
        runStatus: "idle",
        runError: null,
        persistenceIssue: null,
        requestedProjectRoot: projectRoot,
        activeProjectRoot: projectRoot,
        hydratedProjectRoot: projectRoot,
        persistenceTransition: null,
      };
    }),
  beginPersistenceTransition: (projectRoot, kind) => {
    const state = get();
    const generation = state.persistenceTransitionSequence + 1;
    const capture: AgentPersistenceTransitionCapture = {
      generation,
      kind,
      projectRoot,
    };
    set({
      requestedProjectRoot: projectRoot,
      hydratedProjectRoot: null,
      persistenceTransitionSequence: generation,
      persistenceTransition: { generation, kind, projectRoot },
    });
    return capture;
  },
  activatePersistenceTransition: (capture) => {
    const transition = get().persistenceTransition;
    if (!ownsAgentPersistenceTransition(transition, capture)) {
      return false;
    }
    set({ activeProjectRoot: capture.projectRoot });
    return true;
  },
  completePersistenceTransition: (capture, state) => {
    const transition = get().persistenceTransition;
    if (!ownsAgentPersistenceTransition(transition, capture)) {
      return { status: "stale" };
    }
    if (capture.projectRoot === null) {
      throw new Error("Cannot hydrate a closed agent console transition.");
    }
    set((current) => {
      const draft = hydratedDraftState(state, current.draftRevision);
      return {
        ...draft,
        ...hydratedProposalState(state),
        messages: [...state.messages],
        summary: state.summary,
        lastUsage: state.lastUsage,
        interruptedRun: state.interruptedRun,
        activeRun: null,
        runStatus: "idle",
        runError: null,
        persistenceIssue: null,
        requestedProjectRoot: capture.projectRoot,
        activeProjectRoot: capture.projectRoot,
        hydratedProjectRoot: capture.projectRoot,
        persistenceTransition: null,
      };
    });
    return { status: "current" };
  },
  finishPersistenceTransition: (capture) => {
    const transition = get().persistenceTransition;
    if (!ownsAgentPersistenceTransition(transition, capture)) {
      return;
    }
    set({ persistenceTransition: null });
  },
  resetProject: () =>
    set((state) => {
      const empty = {
        v: 4 as const,
        mode: "writing" as const,
        messages: [],
        summary: null,
        draftText: "",
        draftContextRefs: [],
        draftSourceLocators: {},
        proposalRecords: [],
        currentProposalId: null,
        lastUsage: null,
        interruptedRun: null,
      };
      const draft = hydratedDraftState(empty, state.draftRevision);
      const preservesTransition = state.persistenceTransition !== null;
      return {
        ...EMPTY_AGENT_STATE,
        ...draft,
        messages: [],
        draftContextRefs: [],
        draftContextSources: {},
        draftSourceLocators: {},
        requestedProjectRoot: preservesTransition
          ? state.requestedProjectRoot
          : null,
        activeProjectRoot: preservesTransition
          ? state.activeProjectRoot
          : null,
        persistenceTransition: state.persistenceTransition,
        persistenceTransitionSequence: state.persistenceTransitionSequence,
      };
    }),
  setMode: (mode) =>
    set((state) => {
      requireDraftMutationOwnership(state);
      const revision = state.draftRevision + 1;
      return { mode, draftRevision: revision };
    }),
  setDraftText: (draftText) =>
    set((state) => {
      requireDraftMutationOwnership(state);
      const revision = state.draftRevision + 1;
      return {
        draftText,
        draftTextRevision: revision,
        draftRevision: revision,
      };
    }),
  setDraftContextRefs: (refs) =>
    set((state) => {
      requireDraftMutationOwnership(state);
      const draftContextRefs = dedupeDraftContextRefs(refs);
      const keys = new Set(draftContextRefs.map(draftContextRefKey));
      const draftContextSources: Record<string, DraftContextSource> = {};
      const draftSourceLocators: Record<string, DraftSourceLocator> = {};
      const draftContextVersions: Record<string, number> = {};
      let draftRevision = state.draftRevision + 1;
      for (const key of keys) {
        draftRevision += 1;
        draftContextVersions[key] = draftRevision;
        const source = state.draftContextSources[key];
        if (source !== undefined) draftContextSources[key] = source;
        const locator = state.draftSourceLocators[key];
        if (locator !== undefined) draftSourceLocators[key] = locator;
      }
      return {
        draftContextRefs,
        draftContextSources,
        draftSourceLocators,
        draftRevision,
        draftContextVersions,
      };
    }),
  addDraftContextRefs: (refs) =>
    set((state) => {
      requireDraftMutationOwnership(state);
      const keys = new Set(state.draftContextRefs.map(draftContextRefKey));
      const additions: DraftContextRef[] = [];
      const draftContextVersions = { ...state.draftContextVersions };
      let draftRevision = state.draftRevision;
      for (const ref of refs) {
        const key = draftContextRefKey(ref);
        if (!keys.has(key)) {
          keys.add(key);
          additions.push(ref);
          draftRevision += 1;
          draftContextVersions[key] = draftRevision;
        }
      }
      return additions.length === 0
        ? { draftContextRefs: state.draftContextRefs }
        : {
            draftContextRefs: [...state.draftContextRefs, ...additions],
            draftRevision,
            draftContextVersions,
          };
    }),
  removeDraftContextRef: (ref) =>
    set((state) => {
      requireDraftMutationOwnership(state);
      const key = draftContextRefKey(ref);
      const draftContextSources = { ...state.draftContextSources };
      const draftSourceLocators = { ...state.draftSourceLocators };
      const draftContextVersions = { ...state.draftContextVersions };
      const draftRevision = state.draftRevision + 1;
      delete draftContextSources[key];
      delete draftSourceLocators[key];
      delete draftContextVersions[key];
      return {
        draftContextRefs: state.draftContextRefs.filter(
          (current) => draftContextRefKey(current) !== key,
        ),
        draftContextSources,
        draftSourceLocators,
        draftRevision,
        draftContextVersions,
      };
    }),
  setDraftContextSources: (sources) =>
    set((state) => {
      requireDraftMutationOwnership(state);
      const draftContextSources = { ...state.draftContextSources };
      const draftSourceLocators = { ...state.draftSourceLocators };
      for (const source of sources) {
        const key = draftContextRefKey(source.ref);
        draftContextSources[key] = source;
        if (source.available && source.resolved !== null) {
          draftSourceLocators[key] = {
            order: source.resolved.order,
            sourceFingerprint: source.resolved.sourceFingerprint,
          };
        }
      }
      return { draftContextSources, draftSourceLocators };
    }),
  applyDraftContextResolution: (attachments, resolutions) =>
    set((state) => {
      requireDraftMutationOwnership(state);
      const capturedRevisions = new Set(
        attachments.map((attachment) => attachment.revision),
      );
      const resolutionByRevision = new Map(
        resolutions.map((resolution) => [
          resolution.attachment.revision,
          resolution,
        ]),
      );
      const candidates: DraftResolutionCandidate[] = [];
      state.draftContextRefs.forEach((ref, index) => {
        const key = draftContextRefKey(ref);
        const revision = state.draftContextVersions[key];
        if (revision === undefined) {
          throw new Error(`Draft attachment identity is missing: ${key}`);
        }
        if (!capturedRevisions.has(revision)) {
          candidates.push({ index, ref, revision, captured: false });
          return;
        }
        const resolution = resolutionByRevision.get(revision);
        if (resolution !== undefined) {
          candidates.push({
            index,
            ref: resolution.ref,
            revision,
            captured: true,
          });
        }
      });
      const winnerByKey = new Map<string, DraftResolutionCandidate>();
      for (const candidate of candidates) {
        const key = draftContextRefKey(candidate.ref);
        const current = winnerByKey.get(key);
        if (
          current === undefined ||
          (current.captured && !candidate.captured)
        ) {
          winnerByKey.set(key, candidate);
        }
      }
      const winners = [...winnerByKey.values()].sort(
        (left, right) => left.index - right.index,
      );
      const draftContextRefs = winners.map((winner) => winner.ref);
      const draftContextSources: Record<string, DraftContextSource> = {};
      const draftSourceLocators: Record<string, DraftSourceLocator> = {};
      const draftContextVersions: Record<string, number> = {};

      for (const winner of winners) {
        const key = draftContextRefKey(winner.ref);
        draftContextVersions[key] = winner.revision;
        if (winner.captured) {
          const resolution = resolutionByRevision.get(winner.revision);
          if (resolution === undefined) {
            throw new Error(
              `Draft attachment resolution is missing: ${winner.revision}`,
            );
          }
          draftContextSources[key] = resolution.source;
          if (
            resolution.source.available &&
            resolution.source.resolved !== null
          ) {
            draftSourceLocators[key] = {
              order: resolution.source.resolved.order,
              sourceFingerprint:
                resolution.source.resolved.sourceFingerprint,
            };
          }
          continue;
        }
        const source = state.draftContextSources[key];
        if (source !== undefined) draftContextSources[key] = source;
        const locator = state.draftSourceLocators[key];
        if (locator !== undefined) draftSourceLocators[key] = locator;
      }

      return {
        draftContextRefs,
        draftContextSources,
        draftSourceLocators,
        draftRevision: state.draftRevision + 1,
        draftContextVersions,
      };
    }),
  captureDraft: () => {
    const state = get();
    return {
      text: state.draftText,
      textRevision: state.draftTextRevision,
      attachments: state.draftContextRefs.map((ref) => {
        const key = draftContextRefKey(ref);
        const revision = state.draftContextVersions[key];
        if (revision === undefined) {
          throw new Error(`Draft attachment identity is missing: ${key}`);
        }
        return { ref: structuredClone(ref), revision };
      }),
    };
  },
  beginPreflight: () =>
    set((state) => {
      requireDraftMutationOwnership(state);
      if (state.runStatus !== "idle" || state.activeRun !== null) {
        throw new Error(ACTIVE_RUN_ERROR);
      }
      return { runStatus: "submitted", runError: null };
    }),
  failPreflight: (runError) =>
    set(() => ({ activeRun: null, runStatus: "idle", runError })),
  beginRun: (activeRun, userMessage) =>
    set((state) => {
      requireDraftMutationOwnership(state);
      if (state.activeRun !== null) {
        throw new Error(ACTIVE_RUN_ERROR);
      }
      return {
        messages: [...state.messages, userMessage],
        activeRun,
        runStatus: "submitted",
        runError: null,
      };
    }),
  beginDraftRun: (activeRun, userMessage, submitted) =>
    set((state) => {
      requireDraftMutationOwnership(state);
      if (state.activeRun !== null) {
        throw new Error(ACTIVE_RUN_ERROR);
      }
      const submittedVersions = new Set(
        submitted.attachments.map((attachment) => attachment.revision),
      );
      const draftContextSources = { ...state.draftContextSources };
      const draftSourceLocators = { ...state.draftSourceLocators };
      const draftContextVersions = { ...state.draftContextVersions };
      let draftRevision = state.draftRevision;
      const draftContextRefs = state.draftContextRefs.filter((ref) => {
        const key = draftContextRefKey(ref);
        const currentVersion = state.draftContextVersions[key];
        if (
          currentVersion === undefined ||
          !submittedVersions.has(currentVersion)
        ) {
          return true;
        }
        draftRevision += 1;
        delete draftContextSources[key];
        delete draftSourceLocators[key];
        delete draftContextVersions[key];
        return false;
      });
      const clearsText = state.draftTextRevision === submitted.textRevision;
      let draftTextRevision = state.draftTextRevision;
      if (clearsText) {
        draftRevision += 1;
        draftTextRevision = draftRevision;
      }
      return {
        messages: [...state.messages, userMessage],
        draftText: clearsText ? "" : state.draftText,
        draftContextRefs,
        draftContextSources,
        draftSourceLocators,
        draftRevision,
        draftTextRevision,
        draftContextVersions,
        activeRun,
        runStatus: "submitted",
        runError: null,
      };
    }),
  markStreaming: () => set(() => ({ runStatus: "streaming" })),
  upsertAssistantMessage: (message) =>
    set((state) => ({ messages: upsertMessage(state.messages, message) })),
  finishRun: (message, usage) =>
    set((state) => {
      let finalMessage: AgentUIMessage | null = null;
      if (message !== null) {
        finalMessage = {
          ...message,
          metadata: { ...requireAgentMetadata(message), usage },
        };
      }
      return {
        messages:
          finalMessage === null
            ? state.messages
            : upsertMessage(state.messages, finalMessage),
        lastUsage: usage,
        activeRun: null,
        runStatus: "idle",
        runError: null,
      };
    }),
  interruptRun: (interruptedRun) =>
    set(() => ({
      interruptedRun,
      activeRun: null,
      runStatus: "idle",
      runError: null,
    })),
  failRun: (message, failure) =>
    set((state) => {
      const metadata = requireAgentMetadata(message);
      const failedMessage: AgentUIMessage = {
        ...message,
        metadata: {
          ...metadata,
          state: "error",
          failure,
        },
      };
      return {
        messages: upsertMessage(state.messages, failedMessage),
        activeRun: null,
        runStatus: "idle",
        runError: failure,
      };
    }),
  replacePendingProposal: (proposal) => {
    get().stageProposal(proposal, { kind: "legacy" });
  },
  stageProposal: (proposal, source) =>
    set((state) => {
      if (source.kind === "run" && source.task.kind === "proposal-follow-up") {
        throw new AgentProposalRecordError("Follow-up proposals must commit through the replacement action.");
      }
      const record = stagedProposalRecord(state, proposal, source);
      const predecessor = source.kind === "run"
        ? state.proposalRecords.find((candidate) =>
            candidate.source.kind === "run" &&
            candidate.source.runId === source.runId &&
            candidate.proposal.kind === proposal.kind &&
            candidate.proposal.chapterId === proposal.chapterId &&
            pendingProposalChangeIds(candidate).length > 0,
          )
        : undefined;
      const proposalRecords = predecessor === undefined
        ? state.proposalRecords
        : state.proposalRecords.map((candidate) =>
            candidate.proposal.id === predecessor.proposal.id
              ? { ...candidate, replacedByProposalId: proposal.id }
              : candidate,
          );
      return proposalProjection([...proposalRecords, record], proposal.id);
    }),
  commitProposalReplacement: (targetId, proposal, source) =>
    set((state) => {
      const target = requireProposalRecord(state, targetId);
      if (
        source.kind !== "run" ||
        source.task.kind !== "proposal-follow-up" ||
        source.task.proposalId !== targetId ||
        pendingProposalChangeIds(target).length === 0
      ) {
        throw new AgentProposalRecordError(`Proposal replacement does not match pending target ${targetId}.`);
      }
      const replacement = stagedProposalRecord(state, proposal, source);
      const proposalRecords = state.proposalRecords.map((record) =>
        record.proposal.id === targetId
          ? { ...record, replacedByProposalId: proposal.id }
          : record,
      );
      return proposalProjection([...proposalRecords, replacement], proposal.id);
    }),
  decideProposalChanges: (proposalId, changeIds, decision, reviewPreconditions) =>
    set((state) => {
      const target = requireProposalRecord(state, proposalId);
      requireDecisionIds(target, changeIds);
      const pendingIds = new Set(pendingProposalChangeIds(target));
      for (const id of changeIds) {
        if (!pendingIds.has(id)) {
          throw new AgentProposalRecordError(`Proposal ${proposalId} change ${id} is already decided or replaced.`);
        }
      }
      const decisions = { ...target.decisions };
      for (const id of changeIds) decisions[id] = { ...decision };
      let review = target.reviewPreconditions;
      if (reviewPreconditions !== undefined) {
        if (decision.status !== "applied" || reviewPreconditions.kind !== target.proposal.kind) {
          throw new AgentProposalRecordError(`Only an applied ${target.proposal.kind} decision may advance review preconditions for ${proposalId}.`);
        }
        for (const [id, precondition] of Object.entries(reviewPreconditions.changes)) {
          const item = target.proposal.changes.find((change) => change.id === id);
          if (item === undefined || precondition === undefined || item.precondition.kind !== precondition.kind) {
            throw new AgentProposalRecordError(`Review precondition does not match proposal change ${proposalId}/${id}.`);
          }
        }
        if (reviewPreconditions.kind === "manuscript" && (review === undefined || review.kind === "manuscript")) {
          review = { kind: "manuscript", changes: { ...review?.changes, ...reviewPreconditions.changes } };
        } else if (reviewPreconditions.kind === "outline" && (review === undefined || review.kind === "outline")) {
          review = { kind: "outline", changes: { ...review?.changes, ...reviewPreconditions.changes } };
        } else {
          throw new AgentProposalRecordError(`Review preconditions do not match proposal ${proposalId}.`);
        }
      }
      const proposalRecords = state.proposalRecords.map((record) =>
        record.proposal.id === proposalId ? { ...record, decisions, ...(review === undefined ? {} : { reviewPreconditions: review }) } : record,
      );
      return proposalProjection(proposalRecords, state.currentProposalId);
    }),
  restoreProposalChanges: (proposalId, changeIds) =>
    set((state) => {
      const target = requireProposalRecord(state, proposalId);
      requireDecisionIds(target, changeIds);
      if (target.replacedByProposalId !== null) {
        throw new AgentProposalRecordError(`Replaced proposal ${proposalId} cannot be restored.`);
      }
      for (const id of changeIds) {
        if (target.decisions[id]?.status !== "dismissed") {
          throw new AgentProposalRecordError(`Only dismissed changes can be restored: ${proposalId}/${id}`);
        }
      }
      const restoredIds = new Set(changeIds);
      const decisions = Object.fromEntries(
        Object.entries(target.decisions).filter(([id]) => !restoredIds.has(id)),
      );
      const proposalRecords = state.proposalRecords.map((record) =>
        record.proposal.id === proposalId ? { ...record, decisions } : record,
      );
      return proposalProjection(proposalRecords, state.currentProposalId);
    }),
  updatePendingManuscriptText: (edit) =>
    set((state) => {
      requireDraftMutationOwnership(state);
      const proposal = selectPendingProposal(state, edit.proposalId);
      if (proposal === null) {
        throw new PendingProposalEditError(
          "proposal-mismatch",
          `Cannot edit pending proposal ${edit.proposalId}: it has no pending changes.`,
        );
      }
      const record = requireProposalRecord(state, edit.proposalId);
      if (proposal.kind !== "manuscript" || record.proposal.kind !== "manuscript") {
        throw new PendingProposalEditError(
          "wrong-kind",
          `Cannot edit pending proposal ${edit.proposalId}: only manuscript text is editable.`,
        );
      }
      if (!proposal.changes.some((item) => item.id === edit.changeId)) {
        throw new PendingProposalEditError(
          "change-missing",
          `Cannot edit pending proposal ${edit.proposalId}: change ${edit.changeId} is not pending.`,
        );
      }
      const updatedProposal: ManuscriptPendingProposal = {
        ...record.proposal,
        changes: record.proposal.changes.map((item) =>
          editPendingManuscriptChange(item, edit),
        ),
      };
      const proposalRecords = state.proposalRecords.map((current) =>
        current.proposal.id === edit.proposalId
          ? { ...current, proposal: updatedProposal }
          : current,
      );
      return proposalProjection(proposalRecords, state.currentProposalId);
    }),
  appendLocalMessage: (message) =>
    set((state) => {
      requireDraftMutationOwnership(state);
      return { messages: [...state.messages, message] };
    }),
  setSummary: (summary) => set(() => ({ summary })),
  setPersistenceIssue: (persistenceIssue) => set(() => ({ persistenceIssue })),
  setActivityOpenOverride: (activityOpenOverride) => set(() => ({ activityOpenOverride })),
});

export const useAgentConsoleStore = create<AgentConsoleState>()(
  createAgentConsoleState,
);

export type AgentConsoleStore = StoreApi<AgentConsoleState>;

const outlineAgentStores = new Map<string, AgentConsoleStore>();
const characterAgentStores = new Map<string, AgentConsoleStore>();
const agentSessionRegistryListeners = new Set<() => void>();

export function agentSessionStore(sessionId: AgentSessionId): AgentConsoleStore {
  switch (sessionId.kind) {
    case "project":
      return useAgentConsoleStore;
    case "outline": {
      const current = outlineAgentStores.get(sessionId.chapterId);
      if (current !== undefined) return current;
      const created = createStore<AgentConsoleState>()(createAgentConsoleState);
      outlineAgentStores.set(sessionId.chapterId, created);
      agentSessionRegistryListeners.forEach((listener) => listener());
      return created;
    }
    case "character": {
      const current = characterAgentStores.get(sessionId.characterId);
      if (current !== undefined) return current;
      const created = createStore<AgentConsoleState>()(createAgentConsoleState);
      characterAgentStores.set(sessionId.characterId, created);
      agentSessionRegistryListeners.forEach((listener) => listener());
      return created;
    }
  }
}

export function outlineAgentSessionEntries(): Array<[
  string,
  AgentConsoleStore,
]> {
  return [...outlineAgentStores.entries()];
}

export function deleteOutlineAgentSession(chapterId: string): void {
  const current = outlineAgentStores.get(chapterId);
  if (current !== undefined && current.getState().proposalRecords.length > 0) return;
  if (outlineAgentStores.delete(chapterId)) {
    agentSessionRegistryListeners.forEach((listener) => listener());
  }
}

export function clearOutlineAgentSessions(): void {
  if (outlineAgentStores.size === 0) return;
  outlineAgentStores.clear();
  agentSessionRegistryListeners.forEach((listener) => listener());
}

export function characterAgentSessionEntries(): Array<[
  string,
  AgentConsoleStore,
]> {
  return [...characterAgentStores.entries()];
}

export function deleteCharacterAgentSession(characterId: string): void {
  if (characterAgentStores.delete(characterId)) {
    agentSessionRegistryListeners.forEach((listener) => listener());
  }
}

export function clearCharacterAgentSessions(): void {
  if (characterAgentStores.size === 0) return;
  characterAgentStores.clear();
  agentSessionRegistryListeners.forEach((listener) => listener());
}

export function subscribeAgentSessionRegistry(listener: () => void): () => void {
  agentSessionRegistryListeners.add(listener);
  return () => agentSessionRegistryListeners.delete(listener);
}

export function useAgentSessionStore<T>(
  sessionId: AgentSessionId,
  selector: (state: AgentConsoleState) => T,
): T {
  const store = useSyncExternalStore(
    subscribeAgentSessionRegistry,
    () => agentSessionStore(sessionId),
    () => agentSessionStore(sessionId),
  );
  return useStore(store, selector);
}
