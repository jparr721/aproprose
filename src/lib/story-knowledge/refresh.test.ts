import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import { textFingerprint } from "@/lib/ai/agent-context";
import { parseChapter } from "@/lib/latex";
import { CURRENT_VERSION } from "@/lib/migration";
import { storyChapterFingerprint } from "@/lib/story-knowledge/chunking";
import { candidateEvidenceFingerprint } from "@/lib/story-knowledge/merge";
import {
  emptyCharacterProfile,
  emptyProjectKnowledge,
} from "@/lib/story-knowledge/model";
import {
  buildStoryRefresh,
  type StoryRefreshCapture,
  type StoryRefreshDependencies,
} from "@/lib/story-knowledge/refresh";
import type {
  Character,
  CharacterObservation,
  ChapterKnowledge,
  EvidenceLocator,
  ProjectInfo,
  ProjectKnowledge,
  ProjectMeta,
  UnknownCharacterObservation,
} from "@/lib/types";

const knowledgeModel = new MockLanguageModelV3();

const projectFixture: ProjectInfo = {
  root: "/book",
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
      label: "1",
      title: "One",
      file: "one.tex",
      wordCount: 3,
    },
    {
      id: "ch2",
      label: "2",
      title: "Two",
      file: "two.tex",
      wordCount: 3,
    },
  ],
};

function characterFixture(id: string, name: string): Character {
  return {
    id,
    name,
    color: "#a65f46",
    role: "Lead",
    profile: emptyCharacterProfile(),
  };
}

function chapterKnowledgeFixture(sourceFingerprint: string): ChapterKnowledge {
  return {
    sourceFingerprint,
    summary: "",
    premiseSignals: [],
    conflictSignals: [],
    stakeSignals: [],
    arcSignals: [],
    endingSignals: [],
    characterObservations: [],
    unknownCharacterObservations: [],
  };
}

function evidenceFixture(chapterId: string, sourceId: string): EvidenceLocator {
  return {
    chapterId,
    sourceId,
    order: 0,
    fingerprint: `fp-${sourceId}`,
    occurrence: 0,
    previewText: "Evidence",
  };
}

function observationFixture(
  id: string,
  characterId: string,
  chapterId: string,
): CharacterObservation {
  return {
    id,
    characterId,
    field: "appearance",
    detail: `${characterId} has gray eyes.`,
    evidence: [evidenceFixture(chapterId, id)],
  };
}

function unknownObservationFixture(): UnknownCharacterObservation {
  return {
    id: "unknown-1",
    name: "Niko",
    role: "Traveler",
    details: {
      appearance: "Niko wears a red coat.",
      mannerisms: "Niko counts every doorway.",
    },
    evidence: [evidenceFixture("ch1", "unknown-source")],
  };
}

function refreshMetaFixture(knowledge: ProjectKnowledge): ProjectMeta {
  return {
    version: CURRENT_VERSION,
    characters: [
      characterFixture("c1", "Mara"),
      characterFixture("c2", "Jon"),
      characterFixture("c3", "Kai"),
    ],
    lore: [],
    statuses: {},
    outline: { premise: "Current premise", overview: "Current overview" },
    chapters: {
      ch1: {
        act: "setup",
        plotPoint: null,
        premise: "Chapter premise",
        goal: "Chapter goal",
        conflict: "Chapter conflict",
        turn: "Chapter turn",
        characterIds: [],
        cards: [],
      },
      ch2: {
        act: "confrontation",
        plotPoint: null,
        premise: "",
        goal: "",
        conflict: "",
        turn: "",
        characterIds: [],
        cards: [],
      },
    },
    knowledge,
  };
}

function refreshCaptureFixture(input: {
  knowledge: ProjectKnowledge;
  project?: ProjectInfo;
  meta?: ProjectMeta;
}): StoryRefreshCapture {
  return {
    project: input.project ?? projectFixture,
    meta: input.meta ?? refreshMetaFixture(input.knowledge),
    provider: "openai",
    modelId: "test-model",
  };
}

function refreshDependenciesFixture(input: {
  sources: Record<string, string>;
}): StoryRefreshDependencies {
  return {
    readTextFile: vi.fn<StoryRefreshDependencies["readTextFile"]>(
      async (_root, path) => {
        const source = input.sources[path];
        if (source === undefined) {
          throw new Error(`Missing source: ${path}`);
        }
        return source;
      },
    ),
    parseChapter,
    getModel: vi.fn<StoryRefreshDependencies["getModel"]>(async () =>
      knowledgeModel,
    ),
    analyzeStoryChunk: vi.fn<StoryRefreshDependencies["analyzeStoryChunk"]>(
      async () => ({
        summaryFragment: "",
        premiseSignals: [],
        conflictSignals: [],
        stakeSignals: [],
        arcSignals: [],
        endingSignals: [],
        characterObservations: [],
        unknownCharacterObservations: [],
      }),
    ),
    reduceChapterKnowledge: vi.fn<
      StoryRefreshDependencies["reduceChapterKnowledge"]
    >(async (chapterInput) =>
      chapterKnowledgeFixture(chapterInput.sourceFingerprint),
    ),
    reduceStoryFields: vi.fn<StoryRefreshDependencies["reduceStoryFields"]>(
      async (storyInput) => ({ ...storyInput.current }),
    ),
    reduceCharacterPatch: vi.fn<
      StoryRefreshDependencies["reduceCharacterPatch"]
    >(async () => ({ additions: [], corrections: [] })),
    reduceCharacterCandidates: vi.fn<
      StoryRefreshDependencies["reduceCharacterCandidates"]
    >(async () => []),
  };
}

function indexedRefreshFixture(): {
  capture: StoryRefreshCapture;
  dependencies: StoryRefreshDependencies;
  sources: Record<string, string>;
} {
  const sources = {
    "one.tex": "One prose block.\n",
    "two.tex": "Two prose block.\n",
  };
  const dependencies = refreshDependenciesFixture({ sources });
  const knowledge = emptyProjectKnowledge();
  knowledge.chapters = {
    ch1: chapterKnowledgeFixture(
      storyChapterFingerprint(parseChapter(sources["one.tex"])),
    ),
    ch2: chapterKnowledgeFixture(
      storyChapterFingerprint(parseChapter(sources["two.tex"])),
    ),
  };
  knowledge.chapterTopologyFingerprint = topologyFingerprintFixture(
    projectFixture,
  );
  return {
    capture: refreshCaptureFixture({ knowledge }),
    dependencies,
    sources,
  };
}

function topologyFingerprintFixture(project: ProjectInfo): string {
  return textFingerprint(
    JSON.stringify(
      project.chapters.map((chapter) => [chapter.id, chapter.title]),
    ),
  );
}

describe("story refresh orchestration", () => {
  it("indexes every chapter with missing knowledge on the first run", async () => {
    const dependencies = refreshDependenciesFixture({
      sources: {
        "one.tex": "One prose block.\n",
        "two.tex": "Two prose block.\n",
      },
    });

    const result = await buildStoryRefresh(
      refreshCaptureFixture({ knowledge: emptyProjectKnowledge() }),
      dependencies,
      new AbortController().signal,
      vi.fn(),
    );

    expect(dependencies.analyzeStoryChunk).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.knowledge.chapters)).toEqual(["ch1", "ch2"]);
  });

  it("analyzes only chapters whose semantic fingerprint changed", async () => {
    const fixture = indexedRefreshFixture();
    fixture.sources["two.tex"] = "Two changed prose block.\n";

    await buildStoryRefresh(
      fixture.capture,
      fixture.dependencies,
      new AbortController().signal,
      vi.fn(),
    );

    expect(fixture.dependencies.analyzeStoryChunk).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.analyzeStoryChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        chunk: expect.objectContaining({ chapterId: "ch2" }),
      }),
      expect.any(Object),
    );
  });

  it("prunes deleted chapters from staged knowledge", async () => {
    const fixture = indexedRefreshFixture();
    const project = {
      ...fixture.capture.project,
      chapters: [fixture.capture.project.chapters[0]],
    };

    const result = await buildStoryRefresh(
      { ...fixture.capture, project },
      fixture.dependencies,
      new AbortController().signal,
      vi.fn(),
    );

    expect(Object.keys(result.knowledge.chapters)).toEqual(["ch1"]);
    expect(fixture.dependencies.analyzeStoryChunk).not.toHaveBeenCalled();
    expect(fixture.dependencies.reduceStoryFields).toHaveBeenCalledTimes(1);
  });

  it("reconciles reordered chapters without reanalyzing their prose", async () => {
    const fixture = indexedRefreshFixture();
    Object.assign(fixture.capture.meta.knowledge, {
      chapterTopologyFingerprint: topologyFingerprintFixture(
        fixture.capture.project,
      ),
    });
    const reorderedProject = {
      ...fixture.capture.project,
      chapters: [...fixture.capture.project.chapters].reverse(),
    };

    await buildStoryRefresh(
      { ...fixture.capture, project: reorderedProject },
      fixture.dependencies,
      new AbortController().signal,
      vi.fn(),
    );

    expect(fixture.dependencies.analyzeStoryChunk).not.toHaveBeenCalled();
    expect(fixture.dependencies.reduceChapterKnowledge).not.toHaveBeenCalled();
    expect(fixture.dependencies.reduceStoryFields).toHaveBeenCalledWith(
      expect.objectContaining({
        chapters: [
          expect.objectContaining({ chapterId: "ch2" }),
          expect.objectContaining({ chapterId: "ch1" }),
        ],
      }),
      expect.any(Object),
    );
  });

  it("reconciles chapter title changes without reanalyzing prose", async () => {
    const fixture = indexedRefreshFixture();
    Object.assign(fixture.capture.meta.knowledge, {
      chapterTopologyFingerprint: topologyFingerprintFixture(
        fixture.capture.project,
      ),
    });
    const renamedProject = {
      ...fixture.capture.project,
      chapters: fixture.capture.project.chapters.map((chapter) =>
        chapter.id === "ch2" ? { ...chapter, title: "Renamed Two" } : chapter,
      ),
    };

    await buildStoryRefresh(
      { ...fixture.capture, project: renamedProject },
      fixture.dependencies,
      new AbortController().signal,
      vi.fn(),
    );

    expect(fixture.dependencies.analyzeStoryChunk).not.toHaveBeenCalled();
    expect(fixture.dependencies.reduceStoryFields).toHaveBeenCalledTimes(1);
  });

  it("skips map and chapter reduction for unchanged chapters", async () => {
    const fixture = indexedRefreshFixture();

    const result = await buildStoryRefresh(
      fixture.capture,
      fixture.dependencies,
      new AbortController().signal,
      vi.fn(),
    );

    expect(fixture.dependencies.analyzeStoryChunk).not.toHaveBeenCalled();
    expect(fixture.dependencies.reduceChapterKnowledge).not.toHaveBeenCalled();
    expect(fixture.dependencies.reduceStoryFields).not.toHaveBeenCalled();
    expect(fixture.dependencies.reduceCharacterCandidates).not.toHaveBeenCalled();
    expect(result.story).toEqual(fixture.capture.meta.outline);
  });

  it("sends the full roster and only relevant full profiles to chunk mapping", async () => {
    const sources = {
      "one.tex":
        "% @speaker: c3\n``Kai speaks.''\n\nMara waits beside Lea.\n",
      "two.tex": "Two prose block.\n",
    };
    const dependencies = refreshDependenciesFixture({ sources });
    const meta = refreshMetaFixture(emptyProjectKnowledge());
    meta.characters = [
      characterFixture("c1", "Mara"),
      characterFixture("c2", "Jon"),
      characterFixture("c3", "Kai"),
      characterFixture("c4", "Lea"),
      characterFixture("c5", "Ari"),
    ];
    meta.chapters.ch1.characterIds = ["c1"];
    meta.chapters.ch1.cards = [
      {
        id: "card-1",
        title: "Jon arrives",
        intention: "Introduce Jon",
        characterIds: ["c2"],
        loreIds: [],
        continuityFlags: [],
      },
    ];

    await buildStoryRefresh(
      refreshCaptureFixture({ knowledge: meta.knowledge, meta }),
      dependencies,
      new AbortController().signal,
      vi.fn(),
    );

    expect(dependencies.analyzeStoryChunk).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        roster: [
          { id: "c1", name: "Mara", role: "Lead" },
          { id: "c2", name: "Jon", role: "Lead" },
          { id: "c3", name: "Kai", role: "Lead" },
          { id: "c4", name: "Lea", role: "Lead" },
          { id: "c5", name: "Ari", role: "Lead" },
        ],
        relevantProfiles: [
          meta.characters[0],
          meta.characters[1],
          meta.characters[2],
          meta.characters[3],
        ],
      }),
      expect.any(Object),
    );
  });

  it("reduces only newly observed or still-unapplied known characters", async () => {
    const fixture = indexedRefreshFixture();
    fixture.sources["one.tex"] = "One changed prose block.\n";
    const ch2 = fixture.capture.meta.knowledge.chapters.ch2;
    ch2.characterObservations = [
      observationFixture("obs-2", "c2", "ch2"),
      observationFixture("obs-3", "c3", "ch2"),
    ];
    fixture.capture.meta.knowledge.appliedCharacterObservationIds.c3 = ["obs-3"];
    vi.mocked(fixture.dependencies.reduceChapterKnowledge).mockResolvedValueOnce({
      ...chapterKnowledgeFixture("changed-fingerprint"),
      characterObservations: [observationFixture("obs-1", "c1", "ch1")],
    });

    await buildStoryRefresh(
      fixture.capture,
      fixture.dependencies,
      new AbortController().signal,
      vi.fn(),
    );

    expect(
      vi
        .mocked(fixture.dependencies.reduceCharacterPatch)
        .mock.calls.map(([input]) => input.character.id),
    ).toEqual(["c1", "c2"]);
  });

  it("uses current dismissed fingerprints when grouping candidates", async () => {
    const fixture = indexedRefreshFixture();
    fixture.sources["one.tex"] = "One changed prose block.\n";
    const unknown = unknownObservationFixture();
    const dismissedFingerprint = candidateEvidenceFingerprint(
      unknown.name,
      unknown.evidence,
    );
    fixture.capture.meta.knowledge.dismissedCandidateFingerprints = [
      dismissedFingerprint,
    ];
    vi.mocked(fixture.dependencies.reduceChapterKnowledge).mockResolvedValueOnce({
      ...chapterKnowledgeFixture("changed-fingerprint"),
      unknownCharacterObservations: [unknown],
    });

    const result = await buildStoryRefresh(
      fixture.capture,
      fixture.dependencies,
      new AbortController().signal,
      vi.fn(),
    );

    expect(fixture.dependencies.reduceCharacterCandidates).toHaveBeenCalledWith(
      { groups: [] },
      expect.any(Object),
    );
    expect(result.knowledge.characterCandidates).toEqual([]);
  });

  it("does not regenerate an accepted candidate after an unrelated chapter edit", async () => {
    const fixture = indexedRefreshFixture();
    const unknown = unknownObservationFixture();
    fixture.capture.meta.knowledge.chapters.ch1.unknownCharacterObservations = [
      unknown,
    ];
    Object.assign(fixture.capture.meta.knowledge, {
      acceptedCandidateFingerprints: [
        candidateEvidenceFingerprint(unknown.name, unknown.evidence),
      ],
    });
    fixture.sources["two.tex"] = "Two unrelated changed prose block.\n";

    const result = await buildStoryRefresh(
      fixture.capture,
      fixture.dependencies,
      new AbortController().signal,
      vi.fn(),
    );

    expect(fixture.dependencies.reduceCharacterCandidates).toHaveBeenCalledWith(
      { groups: [] },
      expect.any(Object),
    );
    expect(result.knowledge.characterCandidates).toEqual([]);
  });

  it("captures candidate input state in deterministic order", async () => {
    const fixture = indexedRefreshFixture();
    fixture.capture.meta.knowledge.characterCandidates = [
      {
        id: "candidate-b",
        evidenceFingerprint: "evidence-b",
        name: "B",
        role: "Guide",
        profile: emptyCharacterProfile(),
        evidence: [],
      },
      {
        id: "candidate-a",
        evidenceFingerprint: "evidence-a",
        name: "A",
        role: "Scout",
        profile: emptyCharacterProfile(),
        evidence: [],
      },
    ];
    fixture.capture.meta.knowledge.dismissedCandidateFingerprints = [
      "dismissed-b",
      "dismissed-a",
    ];

    const result = await buildStoryRefresh(
      fixture.capture,
      fixture.dependencies,
      new AbortController().signal,
      vi.fn(),
    );

    expect(result).toMatchObject({
      candidateInputFingerprint: textFingerprint(
        JSON.stringify([
          [
            ["candidate-a", "evidence-a"],
            ["candidate-b", "evidence-b"],
          ],
          [],
          ["dismissed-a", "dismissed-b"],
        ]),
      ),
    });
  });

  it("keeps the captured chapter record untouched when a later chunk fails", async () => {
    const fixture = indexedRefreshFixture();
    fixture.sources["one.tex"] = `${"A".repeat(7_000)}\n\n${"B".repeat(7_000)}\n`;
    const capturedKnowledge = structuredClone(fixture.capture.meta.knowledge);
    vi.mocked(fixture.dependencies.analyzeStoryChunk)
      .mockResolvedValueOnce({
        summaryFragment: "first",
        premiseSignals: [],
        conflictSignals: [],
        stakeSignals: [],
        arcSignals: [],
        endingSignals: [],
        characterObservations: [],
        unknownCharacterObservations: [],
      })
      .mockRejectedValueOnce(new Error("second chunk failed"));

    await expect(
      buildStoryRefresh(
        fixture.capture,
        fixture.dependencies,
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toThrow("second chunk failed");

    expect(fixture.dependencies.reduceChapterKnowledge).not.toHaveBeenCalled();
    expect(fixture.capture.meta.knowledge).toEqual(capturedKnowledge);
  });

  it("returns successful character updates beside isolated failures", async () => {
    const fixture = indexedRefreshFixture();
    fixture.sources["one.tex"] = "One changed prose block.\n";
    vi.mocked(fixture.dependencies.reduceChapterKnowledge).mockResolvedValueOnce({
      ...chapterKnowledgeFixture("changed-fingerprint"),
      characterObservations: [
        observationFixture("obs-1", "c1", "ch1"),
        observationFixture("obs-2", "c2", "ch1"),
      ],
    });
    vi.mocked(fixture.dependencies.reduceCharacterPatch).mockImplementation(
      async (input) => {
        if (input.character.id === "c2") {
          throw new Error("Jon reduction failed");
        }
        return {
          additions: [
            {
              field: "appearance",
              text: "Mara has gray eyes.",
              observationIds: ["obs-1"],
            },
          ],
          corrections: [],
        };
      },
    );

    const result = await buildStoryRefresh(
      fixture.capture,
      fixture.dependencies,
      new AbortController().signal,
      vi.fn(),
    );

    expect(result.characterUpdates).toHaveLength(1);
    expect(result.characterUpdates[0]).toMatchObject({ characterId: "c1" });
    expect(result.characterFailures).toEqual([
      { characterId: "c2", message: "Jon reduction failed" },
    ]);
  });

  it("reports completed chapters over the total selected chapters", async () => {
    const dependencies = refreshDependenciesFixture({
      sources: {
        "one.tex": "One prose block.\n",
        "two.tex": "Two prose block.\n",
      },
    });
    const onProgress = vi.fn();

    await buildStoryRefresh(
      refreshCaptureFixture({ knowledge: emptyProjectKnowledge() }),
      dependencies,
      new AbortController().signal,
      onProgress,
    );

    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { completedChapters: 1, totalChapters: 2 },
      { completedChapters: 2, totalChapters: 2 },
    ]);
  });
});
