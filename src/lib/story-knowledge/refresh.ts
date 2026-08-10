import type { LanguageModel } from "ai";

import {
  candidateInputFingerprint,
  chapterTopologyFingerprint,
  characterProfileFingerprint,
  storyFieldsFingerprint,
} from "@/lib/ai/agent-context";
import { getModel } from "@/lib/ai/model";
import { parseChapter } from "@/lib/latex";
import { getChapterOutline } from "@/lib/outline/model";
import {
  chunkStoryChapter,
  STORY_REFRESH_CHUNK_MAX_CHARACTERS,
  storyChapterFingerprint,
  type StoryKnowledgeChunk,
} from "@/lib/story-knowledge/chunking";
import {
  dedupeCharacterObservations,
  eligibleUnknownCharacterGroups,
} from "@/lib/story-knowledge/merge";
import {
  analyzeStoryChunk,
  reduceChapterKnowledge,
  reduceCharacterCandidates,
  reduceCharacterPatch,
  reduceStoryFields,
  type StoryChunkAnalysis,
} from "@/lib/story-knowledge/operations";
import { readTextFile } from "@/lib/tauri";
import type {
  AiProvider,
  Block,
  Character,
  CharacterCandidate,
  CharacterKnowledgePatch,
  ChapterKnowledge,
  ChapterRef,
  Outline,
  ProjectInfo,
  ProjectKnowledge,
  ProjectMeta,
} from "@/lib/types";

export interface StoryRefreshCapture {
  project: ProjectInfo;
  meta: ProjectMeta;
  provider: AiProvider;
  modelId: string;
  reconcileCandidates: boolean;
}

export type StoryRefreshFollowUpReason =
  | "candidate-input-stale"
  | "chapter-content-stale"
  | "chapter-topology-stale"
  | "character-profile-stale"
  | "story-fields-stale";

export interface StoryRefreshCharacterUpdate {
  characterId: string;
  inputFingerprint: string;
  patch: CharacterKnowledgePatch;
}

export interface StoryRefreshResult {
  projectRoot: string;
  chapterTopologyFingerprint: string;
  analyzedChapterFingerprints: Record<string, string>;
  knowledge: ProjectKnowledge;
  storyInputFingerprint: string;
  candidateInputFingerprint: string;
  story: Outline;
  characterUpdates: StoryRefreshCharacterUpdate[];
  characterFailures: Array<{
    characterId: string;
    message: string;
  }>;
}

export interface StoryRefreshProgress {
  completedChapters: number;
  totalChapters: number;
}

export type StoryRefreshProgressHandler = (
  progress: StoryRefreshProgress,
) => void;

export interface StoryRefreshDependencies {
  readTextFile: (root: string, path: string) => Promise<string>;
  parseChapter: (source: string) => Block[];
  getModel: (provider: AiProvider, modelId: string) => Promise<LanguageModel>;
  analyzeStoryChunk: typeof analyzeStoryChunk;
  reduceChapterKnowledge: typeof reduceChapterKnowledge;
  reduceStoryFields: typeof reduceStoryFields;
  reduceCharacterPatch: typeof reduceCharacterPatch;
  reduceCharacterCandidates: typeof reduceCharacterCandidates;
}

export const STORY_REFRESH_CHARACTER_CONCURRENCY = 3;

interface ParsedStoryChapter {
  chapter: ChapterRef;
  blocks: Block[];
  sourceFingerprint: string;
}

export const storyRefreshDependencies: StoryRefreshDependencies = {
  readTextFile,
  parseChapter,
  getModel,
  analyzeStoryChunk,
  reduceChapterKnowledge,
  reduceStoryFields,
  reduceCharacterPatch,
  reduceCharacterCandidates,
};

function cloneChapterKnowledge(knowledge: ChapterKnowledge): ChapterKnowledge {
  return structuredClone(knowledge);
}

function cloneCandidate(candidate: CharacterCandidate): CharacterCandidate {
  return structuredClone(candidate);
}

function cloneProjectKnowledge(knowledge: ProjectKnowledge): ProjectKnowledge {
  return {
    chapterTopologyFingerprint: knowledge.chapterTopologyFingerprint,
    chapters: Object.fromEntries(
      Object.entries(knowledge.chapters).map(([chapterId, chapter]) => [
        chapterId,
        cloneChapterKnowledge(chapter),
      ]),
    ),
    characterCandidates: knowledge.characterCandidates.map(cloneCandidate),
    acceptedCandidateFingerprints: [
      ...knowledge.acceptedCandidateFingerprints,
    ],
    dismissedCandidateFingerprints: [
      ...knowledge.dismissedCandidateFingerprints,
    ],
    appliedCharacterObservationIds: Object.fromEntries(
      Object.entries(knowledge.appliedCharacterObservationIds).map(
        ([characterId, observationIds]) => [characterId, [...observationIds]],
      ),
    ),
  };
}

function isNameCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}_]/u.test(value);
}

function hasExactNameMention(text: string, name: string): boolean {
  if (name.length === 0) return false;
  let fromIndex = 0;
  while (fromIndex <= text.length - name.length) {
    const index = text.indexOf(name, fromIndex);
    if (index === -1) return false;
    const before = index === 0 ? undefined : text[index - 1];
    const afterIndex = index + name.length;
    const after = afterIndex === text.length ? undefined : text[afterIndex];
    if (!isNameCharacter(before) && !isNameCharacter(after)) return true;
    fromIndex = index + 1;
  }
  return false;
}

function relevantProfiles(
  chunk: StoryKnowledgeChunk,
  chapterCharacterIds: string[],
  cardCharacterIds: string[],
  characters: Character[],
): Character[] {
  const relevantIds = new Set([
    ...chapterCharacterIds,
    ...cardCharacterIds,
    ...chunk.blocks.flatMap((block) =>
      block.speakerId === null ? [] : [block.speakerId],
    ),
  ]);
  const chunkText = chunk.blocks.map((block) => block.text).join("\n");
  for (const character of characters) {
    if (hasExactNameMention(chunkText, character.name)) {
      relevantIds.add(character.id);
    }
  }
  return characters.filter((character) => relevantIds.has(character.id));
}

function retainedChapterKnowledge(
  project: ProjectInfo,
  current: ProjectKnowledge,
): Record<string, ChapterKnowledge> {
  return Object.fromEntries(
    project.chapters.flatMap((chapter) => {
      const knowledge = current.chapters[chapter.id];
      return knowledge === undefined
        ? []
        : [[chapter.id, cloneChapterKnowledge(knowledge)]];
    }),
  );
}

function affectedCharacters(
  capture: StoryRefreshCapture,
  knowledge: ProjectKnowledge,
  selectedChapterIds: Set<string>,
): Character[] {
  const affectedIds = new Set<string>();
  for (const chapter of capture.project.chapters) {
    const chapterKnowledge = knowledge.chapters[chapter.id];
    if (chapterKnowledge === undefined) continue;
    for (const observation of chapterKnowledge.characterObservations) {
      const appliedIds = new Set(
        knowledge.appliedCharacterObservationIds[observation.characterId] ?? [],
      );
      if (
        selectedChapterIds.has(chapter.id) ||
        !appliedIds.has(observation.id)
      ) {
        affectedIds.add(observation.characterId);
      }
    }
  }
  return capture.meta.characters.filter((character) =>
    affectedIds.has(character.id),
  );
}

function rejectionMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export async function buildStoryRefresh(
  capture: StoryRefreshCapture,
  dependencies: StoryRefreshDependencies,
  signal: AbortSignal,
  onProgress: StoryRefreshProgressHandler,
): Promise<StoryRefreshResult> {
  signal.throwIfAborted();
  const capturedCandidateInputFingerprint = candidateInputFingerprint(
    capture.meta.knowledge,
  );
  const capturedChapterTopologyFingerprint = chapterTopologyFingerprint(
    capture.project.chapters,
  );
  const parsedChapters: ParsedStoryChapter[] = [];
  for (const chapter of capture.project.chapters) {
    signal.throwIfAborted();
    const source = await dependencies.readTextFile(
      capture.project.root,
      chapter.file,
    );
    signal.throwIfAborted();
    const blocks = dependencies.parseChapter(source);
    parsedChapters.push({
      chapter,
      blocks,
      sourceFingerprint: storyChapterFingerprint(blocks),
    });
  }

  const knowledge = cloneProjectKnowledge(capture.meta.knowledge);
  const retainedChapters = retainedChapterKnowledge(
    capture.project,
    capture.meta.knowledge,
  );
  const deletedChapterCount =
    Object.keys(capture.meta.knowledge.chapters).length -
    Object.keys(retainedChapters).length;
  knowledge.chapters = retainedChapters;
  const topologyChanged =
    knowledge.chapterTopologyFingerprint !== capturedChapterTopologyFingerprint;
  knowledge.chapterTopologyFingerprint = capturedChapterTopologyFingerprint;
  const selectedChapters = parsedChapters.filter(
    ({ chapter, sourceFingerprint }) =>
      knowledge.chapters[chapter.id]?.sourceFingerprint !== sourceFingerprint,
  );
  const selectedChapterIds = new Set(
    selectedChapters.map(({ chapter }) => chapter.id),
  );
  onProgress({
    completedChapters: 0,
    totalChapters: selectedChapters.length,
  });
  const analyzedChapterFingerprints: Record<string, string> = {};
  let modelPromise: Promise<LanguageModel> | null = null;
  const resolveModel = async (): Promise<LanguageModel> => {
    signal.throwIfAborted();
    modelPromise ??= dependencies.getModel(capture.provider, capture.modelId);
    const model = await modelPromise;
    signal.throwIfAborted();
    return model;
  };
  const roster = capture.meta.characters.map(({ id, name, role }) => ({
    id,
    name,
    role,
  }));

  let completedChapters = 0;
  for (const parsed of selectedChapters) {
    const chapterOutline = getChapterOutline(
      capture.meta.chapters,
      parsed.chapter.id,
    );
    const cardCharacterIds = chapterOutline.cards.flatMap(
      (card) => card.characterIds,
    );
    const chunks = chunkStoryChapter(
      parsed.chapter.id,
      parsed.chapter.title,
      parsed.blocks,
      STORY_REFRESH_CHUNK_MAX_CHARACTERS,
    );
    const analyses: StoryChunkAnalysis[] = [];
    for (const chunk of chunks) {
      signal.throwIfAborted();
      analyses.push(
        await dependencies.analyzeStoryChunk(
          {
            chunk,
            outline: capture.meta.outline,
            chapterOutline,
            roster,
            relevantProfiles: relevantProfiles(
              chunk,
              chapterOutline.characterIds,
              cardCharacterIds,
              capture.meta.characters,
            ),
          },
          { model: await resolveModel(), signal },
        ),
      );
      signal.throwIfAborted();
    }
    const chapterKnowledge: ChapterKnowledge =
      chunks.length === 0
        ? {
            sourceFingerprint: parsed.sourceFingerprint,
            summary: "",
            premiseSignals: [],
            conflictSignals: [],
            stakeSignals: [],
            arcSignals: [],
            endingSignals: [],
            characterObservations: [],
            unknownCharacterObservations: [],
          }
        : await dependencies.reduceChapterKnowledge(
            {
              sourceFingerprint: parsed.sourceFingerprint,
              analyses,
            },
            { model: await resolveModel(), signal },
          );
    signal.throwIfAborted();
    knowledge.chapters[parsed.chapter.id] = cloneChapterKnowledge(chapterKnowledge);
    analyzedChapterFingerprints[parsed.chapter.id] = parsed.sourceFingerprint;
    completedChapters += 1;
    onProgress({
      completedChapters,
      totalChapters: selectedChapters.length,
    });
  }

  const chapterKnowledgeChanged =
    selectedChapters.length > 0 || deletedChapterCount > 0 || topologyChanged;
  const storyInputFingerprint = storyFieldsFingerprint(capture.meta.outline);
  let story = { ...capture.meta.outline };
  if (chapterKnowledgeChanged) {
    const reducedStory = await dependencies.reduceStoryFields(
      {
        current: capture.meta.outline,
        chapters: capture.project.chapters.map((chapter) => ({
          chapterId: chapter.id,
          title: chapter.title,
          knowledge: knowledge.chapters[chapter.id],
        })),
      },
      { model: await resolveModel(), signal },
    );
    signal.throwIfAborted();
    story = { ...reducedStory };
  }

  const characters = affectedCharacters(
    capture,
    knowledge,
    selectedChapterIds,
  );
  const reduceCharacter = async (
    character: Character,
  ): Promise<StoryRefreshCharacterUpdate> => {
    const inputFingerprint = characterProfileFingerprint(character.profile);
    const observations = dedupeCharacterObservations(
      capture.project.chapters.flatMap(
        (chapter) =>
          knowledge.chapters[chapter.id]?.characterObservations.filter(
            (observation) => observation.characterId === character.id,
          ) ?? [],
      ),
    );
    const patch = await dependencies.reduceCharacterPatch(
      {
        character,
        observations,
        appliedObservationIds:
          knowledge.appliedCharacterObservationIds[character.id] ?? [],
      },
      { model: await resolveModel(), signal },
    );
    return {
      characterId: character.id,
      inputFingerprint,
      patch,
    };
  };
  const settledCharacterJobs: Array<
    PromiseSettledResult<StoryRefreshCharacterUpdate>
  > = new Array(characters.length);
  let nextCharacterIndex = 0;
  const workers = Array.from(
    {
      length: Math.min(
        STORY_REFRESH_CHARACTER_CONCURRENCY,
        characters.length,
      ),
    },
    async () => {
      while (nextCharacterIndex < characters.length) {
        signal.throwIfAborted();
        const characterIndex = nextCharacterIndex;
        nextCharacterIndex += 1;
        try {
          const value = await reduceCharacter(characters[characterIndex]);
          signal.throwIfAborted();
          settledCharacterJobs[characterIndex] = {
            status: "fulfilled",
            value,
          };
        } catch (reason) {
          signal.throwIfAborted();
          settledCharacterJobs[characterIndex] = {
            status: "rejected",
            reason,
          };
        }
      }
    },
  );
  await Promise.all(workers);
  signal.throwIfAborted();
  const characterUpdates: StoryRefreshCharacterUpdate[] = [];
  const characterFailures: StoryRefreshResult["characterFailures"] = [];
  for (const [index, settled] of settledCharacterJobs.entries()) {
    if (settled.status === "fulfilled") {
      characterUpdates.push(settled.value);
    } else {
      characterFailures.push({
        characterId: characters[index].id,
        message: rejectionMessage(settled.reason),
      });
    }
  }

  if (chapterKnowledgeChanged || capture.reconcileCandidates) {
    const groups = eligibleUnknownCharacterGroups(
      capture.project.chapters.flatMap(
        (chapter) =>
          knowledge.chapters[chapter.id]?.unknownCharacterObservations ?? [],
      ),
      [
        ...knowledge.acceptedCandidateFingerprints,
        ...knowledge.dismissedCandidateFingerprints,
      ],
    );
    const reductions =
      groups.length === 0
        ? []
        : await dependencies.reduceCharacterCandidates(
            { groups },
            { model: await resolveModel(), signal },
          );
    signal.throwIfAborted();
    const groupByFingerprint = new Map(
      groups.map((group) => [group.evidenceFingerprint, group]),
    );
    knowledge.characterCandidates = reductions.map((reduction) => {
      const group = groupByFingerprint.get(reduction.groupFingerprint);
      if (group === undefined) {
        throw new Error(
          `Candidate reduction returned unknown group: ${reduction.groupFingerprint}`,
        );
      }
      return {
        id: `candidate-${reduction.groupFingerprint}`,
        evidenceFingerprint: reduction.groupFingerprint,
        name: reduction.name,
        role: reduction.role,
        profile: { ...reduction.profile },
        evidence: group.evidence.map((locator) => ({ ...locator })),
      };
    });
  }

  return {
    projectRoot: capture.project.root,
    chapterTopologyFingerprint: capturedChapterTopologyFingerprint,
    analyzedChapterFingerprints,
    knowledge,
    storyInputFingerprint,
    candidateInputFingerprint: capturedCandidateInputFingerprint,
    story,
    characterUpdates,
    characterFailures,
  };
}
