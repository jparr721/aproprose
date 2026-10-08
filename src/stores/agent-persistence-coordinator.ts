import type {
  AgentPersistenceIssue,
  PersistedAgentSnapshot,
  PersistedAgentState,
} from "@/lib/ai/agent-types";

export type AgentPersistenceTransitionKind = "load" | "recovery" | "reset";

export interface AgentPersistenceTransition {
  generation: number;
  kind: AgentPersistenceTransitionKind;
  projectRoot: string | null;
}

export type AgentPersistenceTransitionCapture = AgentPersistenceTransition;

export function ownsAgentPersistenceTransition(
  transition: AgentPersistenceTransition | null,
  capture: AgentPersistenceTransitionCapture,
): boolean {
  return (
    transition !== null &&
    transition.generation === capture.generation &&
    transition.projectRoot === capture.projectRoot
  );
}

export type AgentSnapshotSource = Omit<PersistedAgentState, "v">;

interface FailedRecoveryState {
  source: AgentSnapshotSource;
  revision: number;
}

interface FailedSaveBase {
  root: string;
  issue: AgentPersistenceIssue;
  revision: number;
  recovery: FailedRecoveryState | null;
}

export type FailedAgentSave = FailedSaveBase &
  (
    | { kind: "write"; snapshot: PersistedAgentSnapshot }
    | { kind: "snapshot"; source: AgentSnapshotSource }
  );

type PersistenceAccess =
  | { kind: "blocked"; recoveryRoot: string | null }
  | { kind: "writable"; root: string }
  | { kind: "recovery"; root: string };

interface PersistenceRevisions {
  sequence: number;
  active: number;
  persisted: number;
}

interface AgentPersistenceCoordinatorState {
  access: PersistenceAccess;
  revisions: PersistenceRevisions;
  failedSaves: ReadonlyMap<string, FailedAgentSave>;
}

interface AgentPersistenceCoordinator {
  isWritable: (root: string) => boolean;
  isRecovering: (root: string) => boolean;
  suspendWrites: () => void;
  activateProject: () => void;
  establishWritableSnapshot: (args: { root: string; revision: number }) => void;
  restoreRecovery: (args: { root: string; revision: number }) => void;
  resumeWrites: (root: string) => void;
  nextRevision: () => number;
  markActiveRevision: (revision: number) => void;
  markRevisionPersisted: (args: {
    root: string;
    activeProjectRoot: string | null;
    revision: number;
  }) => void;
  hasUnpersistedRevision: () => boolean;
  failedSaveForRoot: (root: string) => FailedAgentSave | null;
  firstFailedSave: () => FailedAgentSave | null;
  failedSaveForRetry: (activeRoot: string | null) => FailedAgentSave | null;
  retainFailure: (failure: FailedAgentSave) => FailedAgentSave;
  retainRecoverySource: (args: {
    root: string;
    source: AgentSnapshotSource;
    revision: number;
  }) => void;
  clearRecoveredFailure: (args: { root: string; revision: number }) => boolean;
  forgetFailure: (root: string) => void;
  enqueueTransition: (work: () => Promise<void>) => Promise<void>;
  enqueueCollectionSave: (args: {
    root: string;
    work: () => Promise<void>;
  }) => Promise<void>;
  hydrateScopedSession: (args: {
    key: string;
    work: () => Promise<void>;
  }) => Promise<void>;
  cancelSnapshotSave: () => void;
  cancelCollectionSave: () => void;
  scheduleSnapshotSave: (args: { work: () => void; delay: number }) => void;
  scheduleCollectionSave: (args: { work: () => void; delay: number }) => void;
}

export function failedAgentSaveRevision(failure: FailedAgentSave): number {
  return failure.recovery === null
    ? failure.revision
    : Math.max(failure.revision, failure.recovery.revision);
}

export function createAgentPersistenceCoordinator(): AgentPersistenceCoordinator {
  let state: AgentPersistenceCoordinatorState = {
    access: { kind: "blocked", recoveryRoot: null },
    revisions: { sequence: 0, active: 0, persisted: 0 },
    failedSaves: new Map<string, FailedAgentSave>(),
  };
  let transitionQueue: Promise<void> = Promise.resolve();
  const collectionQueues = new Map<string, Promise<void>>();
  const scopedHydrations = new Map<string, Promise<void>>();
  let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  let collectionTimer: ReturnType<typeof setTimeout> | null = null;

  const failedSaveForRoot = (root: string): FailedAgentSave | null =>
    state.failedSaves.get(root) ?? null;

  const firstFailedSave = (): FailedAgentSave | null => {
    const first = state.failedSaves.values().next();
    return first.done ? null : first.value;
  };

  const forgetFailure = (root: string): void => {
    const failedSaves = new Map(state.failedSaves);
    failedSaves.delete(root);
    state = { ...state, failedSaves };
  };

  const cancelSnapshotSave = (): void => {
    if (snapshotTimer === null) return;
    clearTimeout(snapshotTimer);
    snapshotTimer = null;
  };

  const cancelCollectionSave = (): void => {
    if (collectionTimer === null) return;
    clearTimeout(collectionTimer);
    collectionTimer = null;
  };

  return {
    isWritable: (root: string): boolean =>
      state.access.kind === "writable" && state.access.root === root,
    isRecovering: (root: string): boolean =>
      state.access.kind === "recovery"
        ? state.access.root === root
        : state.access.kind === "blocked" && state.access.recoveryRoot === root,
    suspendWrites: (): void => {
      const recoveryRoot =
        state.access.kind === "recovery"
          ? state.access.root
          : state.access.kind === "blocked"
            ? state.access.recoveryRoot
            : null;
      state = { ...state, access: { kind: "blocked", recoveryRoot } };
    },
    activateProject: (): void => {
      state = {
        ...state,
        access: { kind: "blocked", recoveryRoot: null },
        revisions: { ...state.revisions, active: 0, persisted: 0 },
      };
    },
    establishWritableSnapshot: (args: { root: string; revision: number }): void => {
      state = {
        ...state,
        access: { kind: "writable", root: args.root },
        revisions: {
          ...state.revisions,
          active: args.revision,
          persisted: args.revision,
        },
      };
    },
    restoreRecovery: (args: { root: string; revision: number }): void => {
      state = {
        ...state,
        access: { kind: "recovery", root: args.root },
        revisions: { ...state.revisions, active: args.revision, persisted: 0 },
      };
    },
    resumeWrites: (root: string): void => {
      state = { ...state, access: { kind: "writable", root } };
    },
    nextRevision: (): number => {
      const sequence = state.revisions.sequence + 1;
      state = { ...state, revisions: { ...state.revisions, sequence } };
      return sequence;
    },
    markActiveRevision: (revision: number): void => {
      state = { ...state, revisions: { ...state.revisions, active: revision } };
    },
    markRevisionPersisted: (args: {
      root: string;
      activeProjectRoot: string | null;
      revision: number;
    }): void => {
      if (
        args.root !== args.activeProjectRoot ||
        args.revision !== state.revisions.active
      ) {
        return;
      }
      state = {
        ...state,
        revisions: { ...state.revisions, persisted: args.revision },
      };
    },
    hasUnpersistedRevision: (): boolean =>
      state.revisions.active !== state.revisions.persisted,
    failedSaveForRoot,
    firstFailedSave,
    failedSaveForRetry: (activeRoot: string | null): FailedAgentSave | null =>
      activeRoot === null
        ? firstFailedSave()
        : failedSaveForRoot(activeRoot) ?? firstFailedSave(),
    retainFailure: (failure: FailedAgentSave): FailedAgentSave => {
      const retained = failedSaveForRoot(failure.root);
      if (
        retained !== null &&
        failedAgentSaveRevision(retained) > failedAgentSaveRevision(failure)
      ) {
        return retained;
      }
      state = {
        ...state,
        failedSaves: new Map(state.failedSaves).set(failure.root, failure),
      };
      return failure;
    },
    retainRecoverySource: (args: {
      root: string;
      source: AgentSnapshotSource;
      revision: number;
    }): void => {
      const failure = failedSaveForRoot(args.root);
      if (failure === null) {
        throw new Error(`Agent recovery state is missing for ${args.root}.`);
      }
      if (
        failure.recovery !== null &&
        failure.recovery.revision > args.revision
      ) {
        return;
      }
      state = {
        ...state,
        failedSaves: new Map(state.failedSaves).set(args.root, {
          ...failure,
          recovery: { source: args.source, revision: args.revision },
        }),
      };
    },
    clearRecoveredFailure: (args: { root: string; revision: number }): boolean => {
      const failure = failedSaveForRoot(args.root);
      if (failure !== null && failedAgentSaveRevision(failure) > args.revision) {
        return false;
      }
      if (failure !== null) forgetFailure(args.root);
      return true;
    },
    forgetFailure,
    enqueueTransition: (work: () => Promise<void>): Promise<void> => {
      const pending = transitionQueue.then(work, work);
      // The caller observes failure; only the queue barrier settles successfully.
      transitionQueue = pending.catch(() => undefined);
      return pending;
    },
    enqueueCollectionSave: (args: {
      root: string;
      work: () => Promise<void>;
    }): Promise<void> => {
      const previous = collectionQueues.get(args.root) ?? Promise.resolve();
      const save = previous.catch(() => undefined).then(args.work);
      const tracked = save.finally(() => {
        if (collectionQueues.get(args.root) === tracked) {
          collectionQueues.delete(args.root);
        }
      });
      collectionQueues.set(args.root, tracked);
      return tracked;
    },
    hydrateScopedSession: (args: {
      key: string;
      work: () => Promise<void>;
    }): Promise<void> => {
      const current = scopedHydrations.get(args.key);
      if (current !== undefined) return current;
      const hydration = args.work().finally(() => {
        if (scopedHydrations.get(args.key) === hydration) {
          scopedHydrations.delete(args.key);
        }
      });
      scopedHydrations.set(args.key, hydration);
      return hydration;
    },
    cancelSnapshotSave,
    cancelCollectionSave,
    scheduleSnapshotSave: (args: { work: () => void; delay: number }): void => {
      cancelSnapshotSave();
      snapshotTimer = setTimeout(() => {
        snapshotTimer = null;
        args.work();
      }, args.delay);
    },
    scheduleCollectionSave: (args: { work: () => void; delay: number }): void => {
      cancelCollectionSave();
      collectionTimer = setTimeout(() => {
        collectionTimer = null;
        args.work();
      }, args.delay);
    },
  };
}
