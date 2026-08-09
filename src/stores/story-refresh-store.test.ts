import { createStore } from "zustand/vanilla";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  compileProject: vi.fn(),
  openProject: vi.fn(),
  createProject: vi.fn(),
  writeSkeleton: vi.fn(),
  deleteChapterCmd: vi.fn(),
  migrateToManaged: vi.fn(),
  pickProjectDir: vi.fn(),
  readAppData: vi.fn().mockResolvedValue(null),
  readPdf: vi.fn().mockResolvedValue(null),
  readProjectMeta: vi.fn().mockResolvedValue(null),
  readTextFile: vi.fn(),
  writeAppData: vi.fn().mockResolvedValue(undefined),
  writeProjectMeta: vi.fn().mockResolvedValue(undefined),
  writeTextFile: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

import {
  candidateInputFingerprint,
  chapterTopologyFingerprint,
  characterProfileFingerprint,
  storyFieldsFingerprint,
} from "@/lib/ai/agent-context";
import {
  emptyCharacterProfile,
  emptyProjectKnowledge,
} from "@/lib/story-knowledge/model";
import {
  buildStoryRefresh,
  storyRefreshDependencies,
  type StoryRefreshCapture,
  type StoryRefreshResult,
} from "@/lib/story-knowledge/refresh";
import type { Character, ProjectInfo, ProjectMeta } from "@/lib/types";
import { useProjectStore } from "@/stores/project-store";
import {
  createStoryRefreshState,
  type StoryRefreshStoreDependencies,
} from "@/stores/story-refresh-store";

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
  }
}

const projectFixture = (root: string): ProjectInfo => ({
  root,
  name: "Book",
  mainFile: "main.tex",
  title: "Book",
  author: "Author",
  metadata: {
    title: "Book",
    subtitle: "",
    author: "Author",
    publisher: "",
    isbn: "",
  },
  chapters: [
    {
      id: "ch1",
      label: "I",
      title: "Chapter One",
      file: "chapter-one.tex",
      wordCount: 0,
    },
  ],
});

const characterFixture = (id: string, name: string): Character => ({
  id,
  name,
  role: "Detective",
  color: "#aabbcc",
  profile: emptyCharacterProfile(),
});

const metaFixture = (): ProjectMeta => ({
  version: 5,
  characters: [characterFixture("c1", "Mara"), characterFixture("c2", "Inez")],
  lore: [],
  statuses: {},
  outline: { premise: "", overview: "" },
  chapters: {},
  knowledge: emptyProjectKnowledge(),
});

function refreshResultFixture(input: {
  characterId: string | null;
  inputFingerprint: string | null;
}): StoryRefreshResult {
  return {
    projectRoot: "/book",
    chapterTopologyFingerprint: chapterTopologyFingerprint(
      projectFixture("/book").chapters,
    ),
    analyzedChapterFingerprints: { ch1: "fp-1" },
    knowledge: emptyProjectKnowledge(),
    storyInputFingerprint: storyFieldsFingerprint({ premise: "", overview: "" }),
    candidateInputFingerprint: candidateInputFingerprint(
      emptyProjectKnowledge(),
    ),
    story: { premise: "", overview: "" },
    characterUpdates:
      input.characterId === null || input.inputFingerprint === null
        ? []
        : [
            {
              characterId: input.characterId,
              inputFingerprint: input.inputFingerprint,
              patch: { additions: [], corrections: [] },
            },
          ],
    characterFailures: [],
  };
}

function captureFixture(modelId: string | null): ReturnType<StoryRefreshStoreDependencies["capture"]> {
  const state = useProjectStore.getState();
  if (state.project === null) throw new Error("Project is not open");
  return {
    project: structuredClone(state.project),
    meta: structuredClone(state.meta),
    provider: "openai",
    modelId,
  };
}

function refreshStoreDependencies(
  build: typeof buildStoryRefresh,
  modelId: string | null,
): StoryRefreshStoreDependencies {
  return {
    capture: () => captureFixture(modelId),
    buildStoryRefresh: build,
    refreshDependencies: storyRefreshDependencies,
    commitStoryRefresh: (result, latestSavedFingerprints) =>
      useProjectStore
        .getState()
        .commitStoryRefresh(result, latestSavedFingerprints),
    describeError: (error) =>
      error instanceof Error ? error.message : String(error),
  };
}

beforeEach(() => {
  useProjectStore.setState({
    project: projectFixture("/book"),
    meta: metaFixture(),
  } as never);
});

describe("story refresh runtime queue", () => {
  it("coalesces saves to the newest fingerprint during an active run", async () => {
    const first = deferred<StoryRefreshResult>();
    const build = vi
      .fn<typeof buildStoryRefresh>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(
        {
          ...refreshResultFixture({ characterId: null, inputFingerprint: null }),
          analyzedChapterFingerprints: { ch1: "fp-3" },
        },
      );
    const store = createStore(
      createStoryRefreshState(refreshStoreDependencies(build, "gpt-test")),
    );

    store.getState().enqueueSavedChapter("/book", "ch1", "fp-1");
    store.getState().enqueueSavedChapter("/book", "ch1", "fp-2");
    store.getState().enqueueSavedChapter("/book", "ch1", "fp-3");
    first.resolve(
      refreshResultFixture({ characterId: null, inputFingerprint: null }),
    );
    await vi.waitFor(() => {
      expect(store.getState().pendingFingerprints).toEqual({});
    });

    expect(build).toHaveBeenCalledTimes(2);
  });

  it("cancels an active run without reporting a failure", async () => {
    const first = deferred<StoryRefreshResult>();
    const build = vi.fn<typeof buildStoryRefresh>().mockReturnValue(first.promise);
    const store = createStore(
      createStoryRefreshState(refreshStoreDependencies(build, "gpt-test")),
    );

    store.getState().enqueueSavedChapter("/book", "ch1", "fp-1");
    const signal = build.mock.calls[0][2];
    store.getState().cancel();
    first.resolve(
      refreshResultFixture({ characterId: null, inputFingerprint: null }),
    );
    await flushPromises();

    expect(signal.aborted).toBe(true);
    expect(store.getState()).toMatchObject({
      status: "idle",
      error: null,
      pendingFingerprints: {},
      latestSavedFingerprints: {},
    });
  });

  it("preserves an actionable error and pending work after a failed run", async () => {
    const build = vi
      .fn<typeof buildStoryRefresh>()
      .mockRejectedValue(new Error("Provider quota exceeded"));
    const store = createStore(
      createStoryRefreshState(refreshStoreDependencies(build, "gpt-test")),
    );

    store.getState().enqueueSavedChapter("/book", "ch1", "fp-1");
    await flushPromises();

    expect(store.getState()).toMatchObject({
      status: "failed",
      error: "Provider quota exceeded",
      pendingFingerprints: { ch1: "fp-1" },
    });
  });

  it("commits a valid character patch beside an isolated character failure", async () => {
    const knowledge = {
      ...emptyProjectKnowledge(),
      chapters: {
        ch1: {
          sourceFingerprint: "fp-1",
          summary: "Mara arrives.",
          premiseSignals: [],
          conflictSignals: [],
          stakeSignals: [],
          arcSignals: [],
          endingSignals: [],
          characterObservations: [
            {
              id: "obs-1",
              characterId: "c1",
              field: "voice" as const,
              detail: "Mara speaks precisely.",
              evidence: [],
            },
          ],
          unknownCharacterObservations: [],
        },
      },
    };
    const result: StoryRefreshResult = {
      ...refreshResultFixture({ characterId: null, inputFingerprint: null }),
      knowledge,
      characterUpdates: [
        {
          characterId: "c1",
          inputFingerprint: characterProfileFingerprint(emptyCharacterProfile()),
          patch: {
            additions: [
              {
                field: "voice",
                text: "Measured and precise.",
                observationIds: ["obs-1"],
              },
            ],
            corrections: [],
          },
        },
      ],
      characterFailures: [{ characterId: "c2", message: "Timed out" }],
    };
    const build = vi.fn<typeof buildStoryRefresh>().mockResolvedValue(result);
    const store = createStore(
      createStoryRefreshState(refreshStoreDependencies(build, "gpt-test")),
    );

    store.getState().enqueueSavedChapter("/book", "ch1", "fp-1");
    await flushPromises();

    expect(useProjectStore.getState().meta.characters[0].profile.voice).toBe(
      "Measured and precise.",
    );
    expect(store.getState()).toMatchObject({
      status: "failed",
      error: "c2: Timed out",
    });
  });

  it("retries the still-unapplied character observations", async () => {
    const failed = refreshResultFixture({ characterId: null, inputFingerprint: null });
    failed.characterFailures = [{ characterId: "c1", message: "Timed out" }];
    failed.knowledge = {
      ...emptyProjectKnowledge(),
      chapters: {
        ch1: {
          sourceFingerprint: "fp-1",
          summary: "Mara arrives.",
          premiseSignals: [],
          conflictSignals: [],
          stakeSignals: [],
          arcSignals: [],
          endingSignals: [],
          characterObservations: [
            {
              id: "obs-1",
              characterId: "c1",
              field: "voice",
              detail: "Mara speaks precisely.",
              evidence: [],
            },
          ],
          unknownCharacterObservations: [],
        },
      },
    };
    const recovered: StoryRefreshResult = {
      ...failed,
      analyzedChapterFingerprints: {},
      characterUpdates: [
        {
          characterId: "c1",
          inputFingerprint: characterProfileFingerprint(emptyCharacterProfile()),
          patch: {
            additions: [
              {
                field: "voice",
                text: "Measured and precise.",
                observationIds: ["obs-1"],
              },
            ],
            corrections: [],
          },
        },
      ],
      characterFailures: [],
    };
    const build = vi
      .fn<typeof buildStoryRefresh>()
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(recovered);
    const store = createStore(
      createStoryRefreshState(refreshStoreDependencies(build, "gpt-test")),
    );

    store.getState().enqueueSavedChapter("/book", "ch1", "fp-1");
    await flushPromises();
    store.getState().retry();
    await flushPromises();

    expect(build.mock.calls[1][0].meta.knowledge.appliedCharacterObservationIds).toEqual(
      {},
    );
    expect(useProjectStore.getState().meta.characters[0].profile.voice).toBe(
      "Measured and precise.",
    );
    expect(store.getState().status).toBe("idle");
  });

  it("rejects a missing model selection before building", async () => {
    const build = vi.fn<typeof buildStoryRefresh>();
    const store = createStore(
      createStoryRefreshState(refreshStoreDependencies(build, null)),
    );

    store.getState().enqueueSavedChapter("/book", "ch1", "fp-1");
    await flushPromises();

    expect(build).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({
      status: "failed",
      error: "Choose an AI model in Settings before refreshing story knowledge.",
    });
  });

  it("returns immediately without awaiting the refresh promise", () => {
    const first = deferred<StoryRefreshResult>();
    const build = vi.fn<typeof buildStoryRefresh>().mockReturnValue(first.promise);
    const store = createStore(
      createStoryRefreshState(refreshStoreDependencies(build, "gpt-test")),
    );

    const returned = store
      .getState()
      .enqueueSavedChapter("/book", "ch1", "fp-1");

    expect(returned).toBeUndefined();
    expect(store.getState().status).toBe("refreshing");
  });

  it("reselects changed chapters after a stale story commit", async () => {
    const first = deferred<StoryRefreshResult>();
    useProjectStore.setState((state) => ({
      meta: {
        ...state.meta,
        knowledge: {
          ...state.meta.knowledge,
          chapters: {
            ch1: {
              sourceFingerprint: "old-fp",
              summary: "Old summary.",
              premiseSignals: [],
              conflictSignals: [],
              stakeSignals: [],
              arcSignals: [],
              endingSignals: [],
              characterObservations: [],
              unknownCharacterObservations: [],
            },
          },
        },
      },
    }));
    const firstResult: StoryRefreshResult = {
      ...refreshResultFixture({ characterId: null, inputFingerprint: null }),
      knowledge: {
        ...emptyProjectKnowledge(),
        chapters: {
          ch1: {
            ...useProjectStore.getState().meta.knowledge.chapters.ch1,
            sourceFingerprint: "fp-1",
            summary: "New summary.",
          },
        },
      },
      story: { premise: "Reduced premise.", overview: "" },
    };
    const build = vi
      .fn<typeof buildStoryRefresh>()
      .mockReturnValueOnce(first.promise)
      .mockImplementationOnce(async (capture: StoryRefreshCapture) => ({
        ...firstResult,
        storyInputFingerprint: storyFieldsFingerprint(capture.meta.outline),
        story: { premise: "Author premise refined.", overview: "" },
      }));
    const store = createStore(
      createStoryRefreshState(refreshStoreDependencies(build, "gpt-test")),
    );

    store.getState().enqueueSavedChapter("/book", "ch1", "fp-1");
    useProjectStore.getState().setPremise("Author premise.");
    first.resolve(firstResult);
    await flushPromises();

    expect(build).toHaveBeenCalledTimes(2);
    expect(
      build.mock.calls[1][0].meta.knowledge.chapters.ch1.sourceFingerprint,
    ).toBe("old-fp");
    expect(
      useProjectStore.getState().meta.knowledge.chapters.ch1.sourceFingerprint,
    ).toBe("fp-1");
    expect(useProjectStore.getState().meta.outline.premise).toBe(
      "Author premise refined.",
    );
  });

  it("requests candidate-only reconciliation after a decision races new evidence", async () => {
    const candidate = {
      id: "candidate-inez",
      evidenceFingerprint: "candidate-inez-fingerprint",
      name: "Inez",
      role: "Guide",
      profile: emptyCharacterProfile(),
      evidence: [],
    };
    useProjectStore.setState((state) => ({
      meta: {
        ...state.meta,
        knowledge: {
          ...state.meta.knowledge,
          characterCandidates: [candidate],
        },
      },
    }));
    const first = deferred<StoryRefreshResult>();
    const firstResult: StoryRefreshResult = {
      ...refreshResultFixture({ characterId: null, inputFingerprint: null }),
      candidateInputFingerprint: candidateInputFingerprint(
        useProjectStore.getState().meta.knowledge,
      ),
      knowledge: {
        ...emptyProjectKnowledge(),
        chapterTopologyFingerprint: chapterTopologyFingerprint(
          projectFixture("/book").chapters,
        ),
        chapters: {
          ch1: {
            sourceFingerprint: "fp-1",
            summary: "Inez arrives.",
            premiseSignals: [],
            conflictSignals: [],
            stakeSignals: [],
            arcSignals: [],
            endingSignals: [],
            characterObservations: [],
            unknownCharacterObservations: [
              {
                id: "unknown-new",
                name: "Niko",
                role: "Traveler",
                details: {
                  appearance: "Niko wears a red coat.",
                  mannerisms: "Niko counts every doorway.",
                },
                evidence: [
                  {
                    chapterId: "ch1",
                    sourceId: "niko-source",
                    order: 0,
                    fingerprint: "niko-source-fingerprint",
                    occurrence: 0,
                    previewText: "Niko counts every doorway.",
                  },
                ],
              },
            ],
          },
        },
      },
    };
    const build = vi
      .fn<typeof buildStoryRefresh>()
      .mockReturnValueOnce(first.promise)
      .mockImplementationOnce(async (capture: StoryRefreshCapture) => ({
        ...refreshResultFixture({ characterId: null, inputFingerprint: null }),
        analyzedChapterFingerprints: {},
        knowledge: structuredClone(capture.meta.knowledge),
        storyInputFingerprint: storyFieldsFingerprint(capture.meta.outline),
        candidateInputFingerprint: candidateInputFingerprint(
          capture.meta.knowledge,
        ),
        story: { ...capture.meta.outline },
      }));
    const store = createStore(
      createStoryRefreshState(refreshStoreDependencies(build, "gpt-test")),
    );

    store.getState().enqueueSavedChapter("/book", "ch1", "fp-1");
    await useProjectStore
      .getState()
      .acceptCharacterCandidate(candidate.id);
    first.resolve(firstResult);
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(2));

    expect(
      (
        build.mock.calls[1][0] as StoryRefreshCapture & {
          reconcileCandidates?: boolean;
        }
      ).reconcileCandidates,
    ).toBe(true);
  });
});
