import { create, type StateCreator } from "zustand";

import { describeAiError } from "@/lib/ai/errors";
import { parseChapter } from "@/lib/latex";
import type {
  buildStoryRefresh,
  StoryRefreshCapture,
  StoryRefreshDependencies,
  StoryRefreshFollowUpReason,
  StoryRefreshProgress,
  StoryRefreshResult,
} from "@/lib/story-knowledge/refresh";
import { useProjectStore } from "@/stores/project-store";
import { useSettingsStore } from "@/stores/settings-store";

export type StoryRefreshStatus = "idle" | "refreshing" | "failed";

export interface StoryRefreshState {
  status: StoryRefreshStatus;
  progress: StoryRefreshProgress;
  error: string | null;
  pendingFingerprints: Record<string, string>;
  pendingTopologyRevision: number | null;
  pendingFollowUpReasons: StoryRefreshFollowUpReason[];
  latestSavedFingerprints: Record<string, string>;
  enqueueSavedChapter: (
    projectRoot: string,
    chapterId: string,
    fingerprint: string,
  ) => void;
  enqueueChapterTopology: (projectRoot: string) => void;
  retry: () => void;
  cancel: () => void;
}

export interface StoryRefreshStoreDependencies {
  capture: () => Omit<
    StoryRefreshCapture,
    "modelId" | "reconcileCandidates"
  > & {
    modelId: string | null;
  };
  buildStoryRefresh: typeof buildStoryRefresh;
  refreshDependencies: StoryRefreshDependencies;
  commitStoryRefresh: (
    result: StoryRefreshResult,
    latestSavedFingerprints: Record<string, string>,
  ) => Promise<{ followUpReasons: StoryRefreshFollowUpReason[] }>;
  describeError: (error: unknown) => string;
}

const EMPTY_PROGRESS: StoryRefreshProgress = {
  completedChapters: 0,
  totalChapters: 0,
};

const defaultStoryRefreshDependencies: StoryRefreshDependencies = {
  readTextFile: async (root, path) =>
    (await import("@/lib/tauri")).readTextFile(root, path),
  parseChapter,
  getModel: async (provider, modelId) =>
    (await import("@/lib/ai/model")).getModel(provider, modelId),
  analyzeStoryChunk: async (input, options) =>
    (await import("@/lib/story-knowledge/operations")).analyzeStoryChunk(
      input,
      options,
    ),
  reduceChapterKnowledge: async (input, options) =>
    (await import("@/lib/story-knowledge/operations")).reduceChapterKnowledge(
      input,
      options,
    ),
  reduceStoryFields: async (input, options) =>
    (await import("@/lib/story-knowledge/operations")).reduceStoryFields(
      input,
      options,
    ),
  reduceCharacterPatch: async (input, options) =>
    (await import("@/lib/story-knowledge/operations")).reduceCharacterPatch(
      input,
      options,
    ),
  reduceCharacterCandidates: async (input, options) =>
    (await import("@/lib/story-knowledge/operations")).reduceCharacterCandidates(
      input,
      options,
    ),
};

const defaultBuildStoryRefresh: typeof buildStoryRefresh = async (
  capture,
  dependencies,
  signal,
  onProgress,
) =>
  (await import("@/lib/story-knowledge/refresh")).buildStoryRefresh(
    capture,
    dependencies,
    signal,
    onProgress,
  );

function withoutProcessedFingerprints(
  pending: Record<string, string>,
  processed: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(pending).filter(
      ([chapterId, fingerprint]) =>
        processed[chapterId] === undefined ||
        processed[chapterId] !== fingerprint,
    ),
  );
}

function characterFailureMessage(
  failures: StoryRefreshResult["characterFailures"],
): string {
  return failures
    .map((failure) => `${failure.characterId}: ${failure.message}`)
    .join("\n");
}

function mergeFollowUpReasons(
  current: StoryRefreshFollowUpReason[],
  additions: StoryRefreshFollowUpReason[],
): StoryRefreshFollowUpReason[] {
  return [...new Set([...current, ...additions])];
}

export function createStoryRefreshState(
  dependencies: StoryRefreshStoreDependencies,
): StateCreator<StoryRefreshState> {
  return (set, get) => {
    let controller: AbortController | null = null;
    let projectRoot: string | null = null;
    let generation = 0;
    let nextTopologyRevision = 0;

    const execute = async (root: string): Promise<void> => {
      const currentGeneration = generation + 1;
      generation = currentGeneration;
      const currentController = new AbortController();
      controller = currentController;
      const processingFingerprints = { ...get().pendingFingerprints };
      const processingTopologyRevision = get().pendingTopologyRevision;
      const processingFollowUpReasons = [...get().pendingFollowUpReasons];
      set({ status: "refreshing", progress: EMPTY_PROGRESS, error: null });

      try {
        const captured = dependencies.capture();
        if (captured.project.root !== root) {
          throw new Error(
            `Story refresh project does not match the saved project: ${root}`,
          );
        }
        if (captured.modelId === null) {
          throw new Error(
            "Choose an AI model in Settings before refreshing story knowledge.",
          );
        }
        const capture: StoryRefreshCapture = {
          project: structuredClone(captured.project),
          meta: structuredClone(captured.meta),
          provider: captured.provider,
          modelId: captured.modelId,
          reconcileCandidates: processingFollowUpReasons.includes(
            "candidate-input-stale",
          ),
        };
        const result = await dependencies.buildStoryRefresh(
          capture,
          dependencies.refreshDependencies,
          currentController.signal,
          (progress) => {
            if (
              generation === currentGeneration &&
              !currentController.signal.aborted
            ) {
              set({ progress });
            }
          },
        );
        if (
          generation !== currentGeneration ||
          currentController.signal.aborted
        ) {
          return;
        }

        const committed = await dependencies.commitStoryRefresh(
          result,
          { ...get().latestSavedFingerprints },
        );
        if (
          generation !== currentGeneration ||
          currentController.signal.aborted
        ) {
          return;
        }

        const pendingFingerprints = withoutProcessedFingerprints(
          get().pendingFingerprints,
          processingFingerprints,
        );
        const pendingTopologyRevision =
          get().pendingTopologyRevision === processingTopologyRevision
            ? null
            : get().pendingTopologyRevision;
        const remainingFollowUpReasons = get().pendingFollowUpReasons.filter(
          (reason) => !processingFollowUpReasons.includes(reason),
        );
        const pendingFollowUpReasons = mergeFollowUpReasons(
          remainingFollowUpReasons,
          committed.followUpReasons,
        );
        controller = null;
        if (result.characterFailures.length > 0) {
          set({
            status: "failed",
            error: characterFailureMessage(result.characterFailures),
            pendingFingerprints,
            pendingTopologyRevision,
            pendingFollowUpReasons,
          });
          return;
        }

        if (
          pendingFollowUpReasons.length > 0 ||
          Object.keys(pendingFingerprints).length > 0 ||
          pendingTopologyRevision !== null
        ) {
          set({
            pendingFingerprints,
            pendingTopologyRevision,
            pendingFollowUpReasons,
          });
          void execute(root);
          return;
        }

        set({
          status: "idle",
          progress: EMPTY_PROGRESS,
          error: null,
          pendingFingerprints,
          pendingTopologyRevision,
          pendingFollowUpReasons,
        });
      } catch (error) {
        if (generation !== currentGeneration) return;
        controller = null;
        if (currentController.signal.aborted) {
          set({ status: "idle", progress: EMPTY_PROGRESS, error: null });
          return;
        }
        set({ status: "failed", error: dependencies.describeError(error) });
      }
    };

    const cancel = (): void => {
      generation += 1;
      controller?.abort();
      controller = null;
      projectRoot = null;
      set({
        status: "idle",
        progress: EMPTY_PROGRESS,
        error: null,
        pendingFingerprints: {},
        pendingTopologyRevision: null,
        pendingFollowUpReasons: [],
        latestSavedFingerprints: {},
      });
    };

    return {
      status: "idle",
      progress: EMPTY_PROGRESS,
      error: null,
      pendingFingerprints: {},
      pendingTopologyRevision: null,
      pendingFollowUpReasons: [],
      latestSavedFingerprints: {},
      enqueueSavedChapter: (root, chapterId, fingerprint) => {
        if (projectRoot !== null && projectRoot !== root) {
          cancel();
        }
        projectRoot = root;
        set((state) => ({
          pendingFingerprints: {
            ...state.pendingFingerprints,
            [chapterId]: fingerprint,
          },
          latestSavedFingerprints: {
            ...state.latestSavedFingerprints,
            [chapterId]: fingerprint,
          },
        }));
        if (controller === null) {
          void execute(root);
        }
      },
      enqueueChapterTopology: (root) => {
        if (projectRoot !== null && projectRoot !== root) {
          cancel();
        }
        projectRoot = root;
        nextTopologyRevision += 1;
        set({ pendingTopologyRevision: nextTopologyRevision });
        if (controller === null) {
          void execute(root);
        }
      },
      retry: () => {
        if (controller === null && projectRoot !== null) {
          void execute(projectRoot);
        }
      },
      cancel,
    };
  };
}

const storyRefreshStoreDependencies: StoryRefreshStoreDependencies = {
  capture: () => {
    const projectState = useProjectStore.getState();
    if (projectState.project === null) {
      throw new Error("Cannot refresh story knowledge without an open project");
    }
    const settings = useSettingsStore.getState();
    return {
      project: structuredClone(projectState.project),
      meta: structuredClone(projectState.meta),
      provider: settings.aiProvider,
      modelId: settings.aiModel,
    };
  },
  buildStoryRefresh: defaultBuildStoryRefresh,
  refreshDependencies: defaultStoryRefreshDependencies,
  commitStoryRefresh: (result, latestSavedFingerprints) =>
    useProjectStore
      .getState()
      .commitStoryRefresh(result, latestSavedFingerprints),
  describeError: describeAiError,
};

export const useStoryRefreshStore = create<StoryRefreshState>(
  createStoryRefreshState(storyRefreshStoreDependencies),
);
