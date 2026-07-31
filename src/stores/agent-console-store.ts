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
  DraftContextRef,
  DraftContextSource,
  DraftSourceLocator,
  InterruptedRun,
  PendingProposal,
  PersistedAgentState,
  PersistedUsage,
  SubmittedAgentDraft,
} from "@/lib/ai/agent-types";

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
}

export interface AgentConsoleState extends AgentConsoleData {
  hydrate: (projectRoot: string, state: PersistedAgentState) => void;
  resetProject: () => void;
  setMode: (mode: AgentMode) => void;
  setDraftText: (text: string) => void;
  addDraftContextRefs: (refs: DraftContextRef[]) => void;
  removeDraftContextRef: (ref: DraftContextRef) => void;
  rebaseDraftContextRef: (
    previous: DraftContextRef,
    current: DraftContextRef,
  ) => void;
  setDraftContextSources: (sources: DraftContextSource[]) => void;
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

export const useAgentConsoleStore = create<AgentConsoleState>()((set) => ({
  ...EMPTY_AGENT_STATE,
  hydrate: (projectRoot, state) =>
    set(() => ({
      mode: state.mode,
      messages: [...state.messages],
      summary: state.summary,
      draftText: state.draftText,
      draftContextRefs: [...state.draftContextRefs],
      draftContextSources: {},
      draftSourceLocators: { ...state.draftSourceLocators },
      pendingProposal: state.pendingProposal,
      lastUsage: state.lastUsage,
      interruptedRun: state.interruptedRun,
      activeRun: null,
      runStatus: "idle",
      runError: null,
      persistenceIssue: null,
      hydratedProjectRoot: projectRoot,
    })),
  resetProject: () =>
    set(() => ({
      ...EMPTY_AGENT_STATE,
      messages: [],
      draftContextRefs: [],
      draftContextSources: {},
      draftSourceLocators: {},
    })),
  setMode: (mode) => set(() => ({ mode })),
  setDraftText: (draftText) => set(() => ({ draftText })),
  addDraftContextRefs: (refs) =>
    set((state) => {
      const keys = new Set(state.draftContextRefs.map(draftContextRefKey));
      const additions: DraftContextRef[] = [];
      for (const ref of refs) {
        const key = draftContextRefKey(ref);
        if (!keys.has(key)) {
          keys.add(key);
          additions.push(ref);
        }
      }
      return additions.length === 0
        ? { draftContextRefs: state.draftContextRefs }
        : { draftContextRefs: [...state.draftContextRefs, ...additions] };
    }),
  removeDraftContextRef: (ref) =>
    set((state) => {
      const key = draftContextRefKey(ref);
      const draftContextSources = { ...state.draftContextSources };
      const draftSourceLocators = { ...state.draftSourceLocators };
      delete draftContextSources[key];
      delete draftSourceLocators[key];
      return {
        draftContextRefs: state.draftContextRefs.filter(
          (current) => draftContextRefKey(current) !== key,
        ),
        draftContextSources,
        draftSourceLocators,
      };
    }),
  rebaseDraftContextRef: (previous, current) =>
    set((state) => {
      const previousKey = draftContextRefKey(previous);
      const currentKey = draftContextRefKey(current);
      if (previousKey === currentKey) {
        return {
          draftContextRefs: state.draftContextRefs.map((ref) =>
            draftContextRefKey(ref) === previousKey ? current : ref,
          ),
        };
      }

      const draftContextRefs: DraftContextRef[] = [];
      let hasRebasedRef = false;
      for (const ref of state.draftContextRefs) {
        const key = draftContextRefKey(ref);
        if (key !== previousKey && key !== currentKey) {
          draftContextRefs.push(ref);
        } else if (!hasRebasedRef) {
          draftContextRefs.push(current);
          hasRebasedRef = true;
        }
      }

      const draftContextSources = { ...state.draftContextSources };
      const previousSource = draftContextSources[previousKey];
      delete draftContextSources[previousKey];
      delete draftContextSources[currentKey];
      if (previousSource !== undefined) {
        draftContextSources[currentKey] = { ...previousSource, ref: current };
      }

      const draftSourceLocators = { ...state.draftSourceLocators };
      const previousLocator = draftSourceLocators[previousKey];
      delete draftSourceLocators[previousKey];
      delete draftSourceLocators[currentKey];
      if (previousLocator !== undefined) {
        draftSourceLocators[currentKey] = previousLocator;
      }

      return {
        draftContextRefs,
        draftContextSources,
        draftSourceLocators,
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
      const submittedKeys = new Set(submitted.refs.map(draftContextRefKey));
      const draftContextSources = { ...state.draftContextSources };
      const draftSourceLocators = { ...state.draftSourceLocators };
      for (const key of submittedKeys) {
        delete draftContextSources[key];
        delete draftSourceLocators[key];
      }
      return {
        messages: [...state.messages, userMessage],
        draftText: state.draftText === submitted.text ? "" : state.draftText,
        draftContextRefs: state.draftContextRefs.filter(
          (ref) => !submittedKeys.has(draftContextRefKey(ref)),
        ),
        draftContextSources,
        draftSourceLocators,
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
