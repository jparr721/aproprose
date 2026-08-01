import { create } from "zustand";
import { draftContextRefKey } from "@/lib/ai/agent-context";
import type {
  AgentMode,
  AgentMessageMetadata,
  AgentPersistenceIssue,
  AgentRun,
  AgentRunError,
  AgentRunStatus,
  AgentUIMessage,
  ConversationSummary,
  DraftContextAttachment,
  DraftContextRef,
  DraftContextSource,
  DraftSourceLocator,
  InterruptedRun,
  PendingProposal,
  PersistedAgentState,
  PersistedUsage,
  SubmittedAgentDraft,
} from "@/lib/ai/agent-types";

export type AgentPersistenceTransitionKind = "load" | "recovery" | "reset";

export interface AgentPersistenceTransition {
  generation: number;
  kind: AgentPersistenceTransitionKind;
  projectRoot: string;
}

export interface AgentPersistenceTransitionCapture
  extends AgentPersistenceTransition {
  draftRevision: number;
}

export type AgentPersistenceTransitionCompletion =
  | { status: "stale" }
  | { status: "current"; rebasedMutation: boolean };

export interface AgentDraftContextResolution {
  attachment: DraftContextAttachment;
  ref: DraftContextRef;
  source: DraftContextSource;
}

interface AgentConsoleData {
  mode: AgentMode;
  messages: AgentUIMessage[];
  summary: ConversationSummary | null;
  draftText: string;
  draftContextRefs: DraftContextRef[];
  draftContextSources: Record<string, DraftContextSource>;
  draftSourceLocators: Record<string, DraftSourceLocator>;
  pendingProposal: PendingProposal | null;
  lastUsage: PersistedUsage | null;
  interruptedRun: InterruptedRun | null;
  activeRun: AgentRun | null;
  runStatus: AgentRunStatus;
  runError: AgentRunError | null;
  persistenceIssue: AgentPersistenceIssue | null;
  hydratedProjectRoot: string | null;
  draftRevision: number;
  modeRevision: number;
  draftTextRevision: number;
  draftContextVersions: Record<string, number>;
  draftContextMutationRevisions: Record<string, number>;
  draftContextReplacementRevision: number;
  persistenceTransition: AgentPersistenceTransition | null;
  persistenceTransitionSequence: number;
}

export interface AgentConsoleState extends AgentConsoleData {
  hydrate: (projectRoot: string, state: PersistedAgentState) => void;
  beginPersistenceTransition: (
    projectRoot: string,
    kind: AgentPersistenceTransitionKind,
  ) => AgentPersistenceTransitionCapture;
  completePersistenceTransition: (
    capture: AgentPersistenceTransitionCapture,
    state: PersistedAgentState,
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
  failPreflight: (error: AgentRunError) => void;
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
  failRun: (message: AgentUIMessage, error: string) => void;
  replacePendingProposal: (proposal: PendingProposal) => void;
  removePendingChanges: (changeIds: string[]) => void;
  clearPendingProposal: () => void;
  appendLocalMessage: (message: AgentUIMessage) => void;
  setSummary: (summary: ConversationSummary) => void;
  setPersistenceIssue: (issue: AgentPersistenceIssue | null) => void;
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
  lastUsage: null,
  interruptedRun: null,
  activeRun: null,
  runStatus: "idle",
  runError: null,
  persistenceIssue: null,
  hydratedProjectRoot: null,
  draftRevision: 0,
  modeRevision: 0,
  draftTextRevision: 0,
  draftContextVersions: {},
  draftContextMutationRevisions: {},
  draftContextReplacementRevision: 0,
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

interface RebasedDraftState {
  mode: AgentMode;
  draftText: string;
  draftContextRefs: DraftContextRef[];
  draftContextSources: Record<string, DraftContextSource>;
  draftSourceLocators: Record<string, DraftSourceLocator>;
  draftRevision: number;
  modeRevision: number;
  draftTextRevision: number;
  draftContextVersions: Record<string, number>;
  draftContextMutationRevisions: Record<string, number>;
  draftContextReplacementRevision: number;
}

interface RebasedDraftResult {
  draft: RebasedDraftState;
  rebasedMutation: boolean;
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

function rebaseDraftState(
  current: AgentConsoleData,
  persisted: PersistedAgentState,
  capturedRevision: number,
): RebasedDraftResult {
  let draftRevision = current.draftRevision;
  const nextRevision = (): number => {
    draftRevision += 1;
    return draftRevision;
  };
  const preserveMode = current.modeRevision > capturedRevision;
  const preserveText = current.draftTextRevision > capturedRevision;
  const replaceContext =
    current.draftContextReplacementRevision > capturedRevision;
  const mutatedKeys = new Set(
    Object.entries(current.draftContextMutationRevisions)
      .filter(([, revision]) => revision > capturedRevision)
      .map(([key]) => key),
  );
  const persistedRefs = dedupeDraftContextRefs(persisted.draftContextRefs);
  const draftContextRefs = replaceContext
    ? [...current.draftContextRefs]
    : [
        ...persistedRefs.filter(
          (ref) => !mutatedKeys.has(draftContextRefKey(ref)),
        ),
        ...current.draftContextRefs.filter((ref) =>
          mutatedKeys.has(draftContextRefKey(ref)),
        ),
      ];
  const currentKeys = new Set(
    current.draftContextRefs.map(draftContextRefKey),
  );
  const draftContextSources: Record<string, DraftContextSource> = {};
  const draftSourceLocators: Record<string, DraftSourceLocator> = {};
  const draftContextVersions: Record<string, number> = {};
  const draftContextMutationRevisions: Record<string, number> = {};

  for (const ref of draftContextRefs) {
    const key = draftContextRefKey(ref);
    const preserveCurrentRef =
      currentKeys.has(key) && (replaceContext || mutatedKeys.has(key));
    const version = preserveCurrentRef
      ? current.draftContextVersions[key]
      : nextRevision();
    if (version === undefined) {
      throw new Error(`Draft attachment identity is missing: ${key}`);
    }
    draftContextVersions[key] = version;
    draftContextMutationRevisions[key] = version;
    if (preserveCurrentRef) {
      const source = current.draftContextSources[key];
      if (source !== undefined) draftContextSources[key] = source;
      const locator = current.draftSourceLocators[key];
      if (locator !== undefined) draftSourceLocators[key] = locator;
    } else {
      const locator = persisted.draftSourceLocators[key];
      if (locator !== undefined) draftSourceLocators[key] = locator;
    }
  }

  const modeRevision = preserveMode ? current.modeRevision : nextRevision();
  const draftTextRevision = preserveText
    ? current.draftTextRevision
    : nextRevision();
  const draftContextReplacementRevision = nextRevision();
  return {
    draft: {
      mode: preserveMode ? current.mode : persisted.mode,
      draftText: preserveText ? current.draftText : persisted.draftText,
      draftContextRefs,
      draftContextSources,
      draftSourceLocators,
      draftRevision,
      modeRevision,
      draftTextRevision,
      draftContextVersions,
      draftContextMutationRevisions,
      draftContextReplacementRevision,
    },
    rebasedMutation:
      preserveMode || preserveText || replaceContext || mutatedKeys.size > 0,
  };
}

function unavailableProjectError(): AgentConsoleProjectUnavailableError {
  return new AgentConsoleProjectUnavailableError(
    "AI conversation is unavailable. Resolve the storage error and retry.",
  );
}

export class AgentConsoleProjectUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentConsoleProjectUnavailableError";
  }
}

export class AgentConsoleProjectTransitionError extends Error {
  readonly agentErrorCode = "transition" as const;

  constructor(projectRoot: string) {
    super(
      `AI conversation is loading for ${projectRoot}. Retry when loading finishes.`,
    );
    this.name = "AgentConsoleProjectTransitionError";
  }
}

function requireDraftMutationOwnership(state: AgentConsoleState): void {
  const transition = state.persistenceTransition;
  if (
    transition !== null &&
    state.hydratedProjectRoot !== transition.projectRoot
  ) {
    throw new AgentConsoleProjectTransitionError(transition.projectRoot);
  }
}

export function requireAgentConsoleProject(projectRoot: string): void {
  const state = useAgentConsoleStore.getState();
  if (state.persistenceTransition !== null) {
    throw new AgentConsoleProjectTransitionError(projectRoot);
  }
  if (state.hydratedProjectRoot !== projectRoot) {
    throw unavailableProjectError();
  }
}

export const useAgentConsoleStore = create<AgentConsoleState>()((set, get) => ({
  ...EMPTY_AGENT_STATE,
  hydrate: (projectRoot, state) =>
    set((current) => {
      const result = rebaseDraftState(current, state, current.draftRevision);
      return {
        ...result.draft,
        messages: [...state.messages],
        summary: state.summary,
        pendingProposal: state.pendingProposal,
        lastUsage: state.lastUsage,
        interruptedRun: state.interruptedRun,
        activeRun: null,
        runStatus: "idle",
        runError: null,
        persistenceIssue: null,
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
      draftRevision: state.draftRevision,
    };
    set({
      persistenceTransitionSequence: generation,
      persistenceTransition: { generation, kind, projectRoot },
    });
    return capture;
  },
  completePersistenceTransition: (capture, state) => {
    const transition = get().persistenceTransition;
    if (
      transition?.generation !== capture.generation ||
      transition.projectRoot !== capture.projectRoot
    ) {
      return { status: "stale" };
    }
    let rebasedMutation = false;
    set((current) => {
      const result = rebaseDraftState(current, state, capture.draftRevision);
      rebasedMutation = result.rebasedMutation;
      return {
        ...result.draft,
        messages: [...state.messages],
        summary: state.summary,
        pendingProposal: state.pendingProposal,
        lastUsage: state.lastUsage,
        interruptedRun: state.interruptedRun,
        activeRun: null,
        runStatus: "idle",
        runError: null,
        persistenceIssue: null,
        hydratedProjectRoot: capture.projectRoot,
        persistenceTransition: null,
      };
    });
    return { status: "current", rebasedMutation };
  },
  finishPersistenceTransition: (capture) => {
    const transition = get().persistenceTransition;
    if (
      transition?.generation !== capture.generation ||
      transition.projectRoot !== capture.projectRoot
    ) {
      return;
    }
    set({ persistenceTransition: null });
  },
  resetProject: () =>
    set((state) => {
      const empty = {
        v: 3 as const,
        mode: "writing" as const,
        messages: [],
        summary: null,
        draftText: "",
        draftContextRefs: [],
        draftSourceLocators: {},
        pendingProposal: null,
        lastUsage: null,
        interruptedRun: null,
      };
      const result = rebaseDraftState(state, empty, state.draftRevision);
      return {
        ...EMPTY_AGENT_STATE,
        ...result.draft,
        messages: [],
        draftContextRefs: [],
        draftContextSources: {},
        draftSourceLocators: {},
        persistenceTransitionSequence: state.persistenceTransitionSequence,
      };
    }),
  setMode: (mode) =>
    set((state) => {
      requireDraftMutationOwnership(state);
      const revision = state.draftRevision + 1;
      return { mode, modeRevision: revision, draftRevision: revision };
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
      const draftContextMutationRevisions = {
        ...state.draftContextMutationRevisions,
      };
      let draftRevision = state.draftRevision + 1;
      const draftContextReplacementRevision = draftRevision;
      for (const current of state.draftContextRefs) {
        draftRevision += 1;
        draftContextMutationRevisions[draftContextRefKey(current)] =
          draftRevision;
      }
      for (const key of keys) {
        draftRevision += 1;
        draftContextVersions[key] = draftRevision;
        draftContextMutationRevisions[key] = draftRevision;
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
        draftContextMutationRevisions,
        draftContextReplacementRevision,
      };
    }),
  addDraftContextRefs: (refs) =>
    set((state) => {
      requireDraftMutationOwnership(state);
      const keys = new Set(state.draftContextRefs.map(draftContextRefKey));
      const additions: DraftContextRef[] = [];
      const draftContextVersions = { ...state.draftContextVersions };
      const draftContextMutationRevisions = {
        ...state.draftContextMutationRevisions,
      };
      let draftRevision = state.draftRevision;
      for (const ref of refs) {
        const key = draftContextRefKey(ref);
        if (!keys.has(key)) {
          keys.add(key);
          additions.push(ref);
          draftRevision += 1;
          draftContextVersions[key] = draftRevision;
          draftContextMutationRevisions[key] = draftRevision;
        }
      }
      return additions.length === 0
        ? { draftContextRefs: state.draftContextRefs }
        : {
            draftContextRefs: [...state.draftContextRefs, ...additions],
            draftRevision,
            draftContextVersions,
            draftContextMutationRevisions,
          };
    }),
  removeDraftContextRef: (ref) =>
    set((state) => {
      requireDraftMutationOwnership(state);
      const key = draftContextRefKey(ref);
      const draftContextSources = { ...state.draftContextSources };
      const draftSourceLocators = { ...state.draftSourceLocators };
      const draftContextVersions = { ...state.draftContextVersions };
      const draftContextMutationRevisions = {
        ...state.draftContextMutationRevisions,
      };
      const draftRevision = state.draftRevision + 1;
      delete draftContextSources[key];
      delete draftSourceLocators[key];
      delete draftContextVersions[key];
      draftContextMutationRevisions[key] = draftRevision;
      return {
        draftContextRefs: state.draftContextRefs.filter(
          (current) => draftContextRefKey(current) !== key,
        ),
        draftContextSources,
        draftSourceLocators,
        draftRevision,
        draftContextVersions,
        draftContextMutationRevisions,
      };
    }),
  setDraftContextSources: (sources) =>
    set((state) => {
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
      const draftContextMutationRevisions = {
        ...state.draftContextMutationRevisions,
      };
      let draftRevision = state.draftRevision;

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
          draftRevision += 1;
          const originalKey = draftContextRefKey(
            resolution.attachment.ref,
          );
          draftContextMutationRevisions[originalKey] = draftRevision;
          draftContextMutationRevisions[key] = draftRevision;
          continue;
        }
        const source = state.draftContextSources[key];
        if (source !== undefined) draftContextSources[key] = source;
        const locator = state.draftSourceLocators[key];
        if (locator !== undefined) draftSourceLocators[key] = locator;
      }

      for (const attachment of attachments) {
        if (
          state.draftContextRefs.some(
            (ref) =>
              state.draftContextVersions[draftContextRefKey(ref)] ===
              attachment.revision,
          ) &&
          !resolutionByRevision.has(attachment.revision)
        ) {
          draftRevision += 1;
          draftContextMutationRevisions[
            draftContextRefKey(attachment.ref)
          ] = draftRevision;
        }
      }

      return {
        draftContextRefs,
        draftContextSources,
        draftSourceLocators,
        draftRevision,
        draftContextVersions,
        draftContextMutationRevisions,
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
      if (state.runStatus !== "idle" || state.activeRun !== null) {
        throw new Error(ACTIVE_RUN_ERROR);
      }
      return { runStatus: "submitted", runError: null };
    }),
  failPreflight: (runError) =>
    set(() => ({ activeRun: null, runStatus: "idle", runError })),
  beginRun: (activeRun, userMessage) =>
    set((state) => {
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
      if (state.activeRun !== null) {
        throw new Error(ACTIVE_RUN_ERROR);
      }
      const submittedVersions = new Set(
        submitted.attachments.map((attachment) => attachment.revision),
      );
      const draftContextSources = { ...state.draftContextSources };
      const draftSourceLocators = { ...state.draftSourceLocators };
      const draftContextVersions = { ...state.draftContextVersions };
      const draftContextMutationRevisions = {
        ...state.draftContextMutationRevisions,
      };
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
        draftContextMutationRevisions[key] = draftRevision;
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
        draftContextMutationRevisions,
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
  failRun: (message, error) =>
    set((state) => {
      const metadata = requireAgentMetadata(message);
      const errorCode = metadata.errorCode ?? "unknown";
      const failedMessage: AgentUIMessage = {
        ...message,
        metadata: {
          ...metadata,
          state: "error",
          error,
          errorCode,
        },
      };
      return {
        messages: upsertMessage(state.messages, failedMessage),
        activeRun: null,
        runStatus: "idle",
        runError: { code: errorCode, message: error },
      };
    }),
  replacePendingProposal: (pendingProposal) =>
    set(() => ({ pendingProposal })),
  removePendingChanges: (changeIds) =>
    set((state) => {
      if (state.pendingProposal === null) {
        return { pendingProposal: null };
      }
      const removedIds = new Set(changeIds);
      if (state.pendingProposal.kind === "manuscript") {
        const changes = state.pendingProposal.changes.filter(
          (change) => !removedIds.has(change.id),
        );
        return {
          pendingProposal:
            changes.length === 0
              ? null
              : { ...state.pendingProposal, changes },
        };
      }
      const changes = state.pendingProposal.changes.filter(
        (change) => !removedIds.has(change.id),
      );
      return {
        pendingProposal:
          changes.length === 0
            ? null
            : { ...state.pendingProposal, changes },
      };
    }),
  clearPendingProposal: () => set(() => ({ pendingProposal: null })),
  appendLocalMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  setSummary: (summary) => set(() => ({ summary })),
  setPersistenceIssue: (persistenceIssue) => set(() => ({ persistenceIssue })),
}));
