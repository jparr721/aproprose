import { useSyncExternalStore } from "react";
import type {
  AgentFailure,
  AgentPersistenceIssue,
  AgentProposalRecord,
  AgentRunStatus,
  AgentSessionId,
  PendingProposal,
} from "@/lib/ai/agent-types";
import { agentSessionKey, PROJECT_AGENT_SESSION } from "@/lib/ai/agent-types";
import {
  agentConsoleOwnershipStatus,
  characterAgentSessionEntries,
  outlineAgentSessionEntries,
  pendingProposalChangeIds,
  selectPendingProposal,
  subscribeAgentSessionRegistry,
  useAgentConsoleStore,
  type AgentConsoleState,
  type AgentConsoleStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";

export interface AgentChangesEntry {
  sessionId: AgentSessionId;
  sessionKey: string;
  record: AgentProposalRecord;
  pendingProposal: PendingProposal | null;
  pendingChangeCount: number;
}

export interface AgentChangesPersistence {
  sessionId: AgentSessionId;
  sessionKey: string;
  issue: AgentPersistenceIssue | null;
  available: boolean;
  runStatus: AgentRunStatus;
  runError: AgentFailure | null;
}

export interface AgentChangesSnapshot {
  records: AgentChangesEntry[];
  pendingCount: number;
  pendingChangeCount: number;
  runStatus: AgentRunStatus;
  activeSessionId: AgentSessionId | null;
  persistence: AgentChangesPersistence[];
}

interface SessionEntry {
  sessionId: AgentSessionId;
  store: AgentConsoleStore;
}

function sessionEntries(): SessionEntry[] {
  return [
    { sessionId: PROJECT_AGENT_SESSION, store: useAgentConsoleStore },
    ...outlineAgentSessionEntries().map(([chapterId, store]): SessionEntry => ({
      sessionId: { kind: "outline", chapterId },
      store,
    })),
    ...characterAgentSessionEntries().map(([characterId, store]): SessionEntry => ({
      sessionId: { kind: "character", characterId },
      store,
    })),
  ];
}

function sameReviewState(state: AgentConsoleState, previous: AgentConsoleState): boolean {
  return state.proposalRecords === previous.proposalRecords &&
    state.currentProposalId === previous.currentProposalId &&
    state.requestedProjectRoot === previous.requestedProjectRoot &&
    state.activeProjectRoot === previous.activeProjectRoot &&
    state.hydratedProjectRoot === previous.hydratedProjectRoot &&
    state.persistenceTransition === previous.persistenceTransition &&
    state.persistenceIssue === previous.persistenceIssue &&
    state.runStatus === previous.runStatus &&
    state.runError === previous.runError;
}

let cachedRoot: string | null = null;
let cachedStores: AgentConsoleStore[] = [];
let cachedStates: AgentConsoleState[] = [];
let cachedSnapshot: AgentChangesSnapshot = {
  records: [],
  pendingCount: 0,
  pendingChangeCount: 0,
  runStatus: "idle",
  activeSessionId: null,
  persistence: [],
};

export function getAgentChangesSnapshot(): AgentChangesSnapshot {
  const root = useProjectStore.getState().project?.root ?? null;
  const sessions = sessionEntries();
  const states = sessions.map(({ store }) => store.getState());
  if (
    root === cachedRoot &&
    sessions.length === cachedStores.length &&
    sessions.every(({ store }, index) =>
      store === cachedStores[index] && sameReviewState(states[index], cachedStates[index]),
    )
  ) {
    return cachedSnapshot;
  }
  const records: AgentChangesEntry[] = [];
  const persistence: AgentChangesPersistence[] = [];
  for (const [index, entry] of sessions.entries()) {
    const state = states[index];
    const sessionKey = agentSessionKey(entry.sessionId);
    const available = agentConsoleOwnershipStatus(state, root) === "ready";
    const ownsRoot = root !== null && state.activeProjectRoot === root;
    persistence.push({
      sessionId: entry.sessionId,
      sessionKey,
      issue: ownsRoot ? state.persistenceIssue : null,
      available,
      runStatus: ownsRoot ? state.runStatus : "idle",
      runError: ownsRoot ? state.runError : null,
    });
    if (!available || entry.sessionId.kind === "character") continue;
    for (const record of state.proposalRecords) {
      records.push({
        sessionId: entry.sessionId,
        sessionKey,
        record,
        pendingProposal: selectPendingProposal(state, record.proposal.id),
        pendingChangeCount: pendingProposalChangeIds(record).length,
      });
    }
  }
  records.sort((first, second) =>
    second.record.proposal.createdAt.localeCompare(first.record.proposal.createdAt),
  );
  const active = persistence.find((entry) => entry.runStatus !== "idle");
  cachedRoot = root;
  cachedStores = sessions.map(({ store }) => store);
  cachedStates = states;
  cachedSnapshot = {
    records,
    pendingCount: records.filter((entry) => entry.pendingChangeCount > 0).length,
    pendingChangeCount: records.reduce((count, entry) => count + entry.pendingChangeCount, 0),
    runStatus: active === undefined ? "idle" : active.runStatus,
    activeSessionId: active === undefined ? null : active.sessionId,
    persistence,
  };
  return cachedSnapshot;
}

function subscribeChanges(listener: () => void): () => void {
  let unsubscribes: Array<() => void> = [];
  const subscribeSessions = (): void => {
    unsubscribes.forEach((unsubscribe) => unsubscribe());
    unsubscribes = sessionEntries().map(({ store }) => store.subscribe(listener));
  };
  subscribeSessions();
  const unsubscribeRegistry = subscribeAgentSessionRegistry(() => {
    subscribeSessions();
    listener();
  });
  const unsubscribeProject = useProjectStore.subscribe(listener);
  return () => {
    unsubscribes.forEach((unsubscribe) => unsubscribe());
    unsubscribeRegistry();
    unsubscribeProject();
  };
}

export function useAgentChanges(): AgentChangesSnapshot {
  return useSyncExternalStore(subscribeChanges, getAgentChangesSnapshot, getAgentChangesSnapshot);
}
