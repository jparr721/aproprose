import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";

import { textFingerprint } from "@/lib/ai/agent-context";
import { withAiRetry } from "@/lib/ai/errors";
import { STORY_OVERVIEW_MAX_CHARS } from "@/lib/outline/model";
import type { StoryKnowledgeChunk } from "@/lib/story-knowledge/chunking";
import type { UnknownCharacterGroup } from "@/lib/story-knowledge/merge";
import type {
  Character,
  CharacterKnowledgePatch,
  CharacterObservation,
  CharacterProfile,
  CharacterProfileField,
  ChapterKnowledge,
  ChapterOutline,
  EvidenceLocator,
  Outline,
  UnknownCharacterObservation,
} from "@/lib/types";

const CHARACTER_PROFILE_FIELDS = [
  "appearance",
  "mannerisms",
  "motivations",
  "relationships",
  "history",
  "voice",
] as const satisfies readonly CharacterProfileField[];

const MAP_SYSTEM_CONTRACT = [
  "Analyze supplied prose only.",
  "Use exact character IDs.",
  "Speaker and outline assignments are strong identity context.",
  "Temporary reactions are not permanent traits.",
  "Unknown people remain unknown.",
  "Every observation must cite offered source IDs.",
].join(" ");

const CHAPTER_REDUCE_SYSTEM_CONTRACT = [
  "Compact story signals.",
  "Deduplicate synonymous observations.",
  "Retain source evidence by returning only offered observation IDs.",
  "Avoid chapter recap prose.",
].join(" ");

const STORY_REDUCE_SYSTEM_CONTRACT = [
  "Chapter order matters.",
  "The current author logline and overview are authoritative.",
  "Change them only for material evidence.",
  `The overview maximum is ${STORY_OVERVIEW_MAX_CHARS} characters.`,
  "Return a whole-story synthesis, not a chapter recap.",
].join(" ");

const CHARACTER_REDUCE_SYSTEM_CONTRACT = [
  "Return additions and exact corrections only.",
  "Cite known observation IDs.",
  "Preserve current field prose.",
  "Emit no blank operations.",
].join(" ");

const CANDIDATE_REDUCE_SYSTEM_CONTRACT = [
  "Use only eligible group fingerprints.",
  "Retain evidence-supported details.",
  "Do not merge distinct normalized names.",
].join(" ");

const profileFieldSchema = z.enum(CHARACTER_PROFILE_FIELDS);

const completeProfileSchema = z.object({
  appearance: z.string(),
  mannerisms: z.string(),
  motivations: z.string(),
  relationships: z.string(),
  history: z.string(),
  voice: z.string(),
});

const partialProfileSchema = z.object({
  appearance: z.string().nullable(),
  mannerisms: z.string().nullable(),
  motivations: z.string().nullable(),
  relationships: z.string().nullable(),
  history: z.string().nullable(),
  voice: z.string().nullable(),
});

const mapCharacterObservationSchema = z.object({
  characterId: z.string(),
  field: profileFieldSchema,
  detail: z.string(),
  sourceIds: z.array(z.string()),
});

const mapUnknownCharacterObservationSchema = z.object({
  name: z.string(),
  role: z.string(),
  details: partialProfileSchema,
  sourceIds: z.array(z.string()),
});

export const storyChunkAnalysisResultSchema = z.object({
  summaryFragment: z.string(),
  premiseSignals: z.array(z.string()),
  conflictSignals: z.array(z.string()),
  stakeSignals: z.array(z.string()),
  arcSignals: z.array(z.string()),
  endingSignals: z.array(z.string()),
  characterObservations: z.array(mapCharacterObservationSchema),
  unknownCharacterObservations: z.array(mapUnknownCharacterObservationSchema),
});

export const chapterKnowledgeResultSchema = z.object({
  summary: z.string(),
  premiseSignals: z.array(z.string()),
  conflictSignals: z.array(z.string()),
  stakeSignals: z.array(z.string()),
  arcSignals: z.array(z.string()),
  endingSignals: z.array(z.string()),
  characterObservationIds: z.array(z.string()),
  unknownCharacterObservationIds: z.array(z.string()),
});

export const storyFieldReductionResultSchema = z.object({
  premise: z.string(),
  overview: z.string().max(STORY_OVERVIEW_MAX_CHARS),
});

const characterAdditionSchema = z.object({
  field: profileFieldSchema,
  text: z.string(),
  observationIds: z.array(z.string()),
});

const characterCorrectionSchema = z.object({
  field: profileFieldSchema,
  replaceExact: z.string(),
  replacement: z.string(),
  observationIds: z.array(z.string()),
});

export const characterKnowledgePatchResultSchema = z.object({
  additions: z.array(characterAdditionSchema),
  corrections: z.array(characterCorrectionSchema),
});

const characterCandidateSchema = z.object({
  groupFingerprint: z.string(),
  name: z.string(),
  role: z.string(),
  profile: completeProfileSchema,
});

export const characterCandidateReductionResultSchema = z.object({
  candidates: z.array(characterCandidateSchema),
});

export interface StoryKnowledgeAiOptions {
  model: LanguageModel;
  signal: AbortSignal;
}

export interface AnalyzeStoryChunkInput {
  chunk: StoryKnowledgeChunk;
  outline: Outline;
  chapterOutline: ChapterOutline;
  roster: Array<Pick<Character, "id" | "name" | "role">>;
  relevantProfiles: Character[];
}

export interface StoryChunkAnalysis {
  summaryFragment: string;
  premiseSignals: string[];
  conflictSignals: string[];
  stakeSignals: string[];
  arcSignals: string[];
  endingSignals: string[];
  characterObservations: CharacterObservation[];
  unknownCharacterObservations: UnknownCharacterObservation[];
}

export interface StoryFieldReduction {
  premise: string;
  overview: string;
}

export interface CharacterCandidateReduction {
  groupFingerprint: string;
  name: string;
  role: string;
  profile: CharacterProfile;
}

function renderPrompt(label: string, input: unknown): string {
  return `${label}\n${JSON.stringify(input, null, 2)}`;
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function resolveEvidence(
  sourceIds: string[],
  locatorBySourceId: Map<string, EvidenceLocator>,
): EvidenceLocator[] | null {
  const uniqueSourceIds = uniqueValues(sourceIds);
  if (
    uniqueSourceIds.length === 0 ||
    uniqueSourceIds.some((sourceId) => !locatorBySourceId.has(sourceId))
  ) {
    return null;
  }
  const citedSourceIds = new Set(uniqueSourceIds);
  return [...locatorBySourceId.entries()].flatMap(([sourceId, locator]) =>
    citedSourceIds.has(sourceId) ? [{ ...locator }] : [],
  );
}

function observationId(
  characterId: string,
  field: CharacterProfileField,
  detail: string,
  evidence: EvidenceLocator[],
): string {
  return textFingerprint(
    JSON.stringify([characterId, field, detail, evidence]),
  );
}

function unknownObservationId(
  name: string,
  role: string,
  details: Partial<CharacterProfile>,
  evidence: EvidenceLocator[],
): string {
  return textFingerprint(JSON.stringify([name, role, details, evidence]));
}

function compactPartialProfile(
  profile: Partial<Record<CharacterProfileField, string | null>>,
): Partial<CharacterProfile> {
  const result: Partial<CharacterProfile> = {};
  for (const field of CHARACTER_PROFILE_FIELDS) {
    const value = profile[field];
    if (value !== undefined && value !== null && value.trim().length > 0) {
      result[field] = value.trim();
    }
  }
  return result;
}

export async function analyzeStoryChunk(
  input: AnalyzeStoryChunkInput,
  options: StoryKnowledgeAiOptions,
): Promise<StoryChunkAnalysis> {
  const renderedPrompt = renderPrompt("STORY CHUNK INPUT", input);
  const resultSchema = storyChunkAnalysisResultSchema;
  const { output } = await withAiRetry(() =>
    generateText({
      model: options.model,
      output: Output.object({ schema: resultSchema }),
      system: MAP_SYSTEM_CONTRACT,
      prompt: renderedPrompt,
      abortSignal: options.signal,
    }),
  );

  const characterIds = new Set(input.roster.map((character) => character.id));
  const locatorBySourceId = new Map(
    input.chunk.blocks.map((block) => [block.locator.sourceId, block.locator]),
  );
  const characterObservations = output.characterObservations.flatMap(
    (observation): CharacterObservation[] => {
      const detail = observation.detail.trim();
      const evidence = resolveEvidence(
        observation.sourceIds,
        locatorBySourceId,
      );
      if (
        !characterIds.has(observation.characterId) ||
        detail.length === 0 ||
        evidence === null
      ) {
        return [];
      }
      return [
        {
          id: observationId(
            observation.characterId,
            observation.field,
            detail,
            evidence,
          ),
          characterId: observation.characterId,
          field: observation.field,
          detail,
          evidence,
        },
      ];
    },
  );
  const unknownCharacterObservations = output.unknownCharacterObservations.flatMap(
    (observation): UnknownCharacterObservation[] => {
      const name = observation.name.trim();
      const role = observation.role.trim();
      const details = compactPartialProfile(observation.details);
      const evidence = resolveEvidence(
        observation.sourceIds,
        locatorBySourceId,
      );
      if (name.length === 0 || evidence === null) return [];
      return [
        {
          id: unknownObservationId(name, role, details, evidence),
          name,
          role,
          details,
          evidence,
        },
      ];
    },
  );

  return {
    summaryFragment: output.summaryFragment,
    premiseSignals: output.premiseSignals,
    conflictSignals: output.conflictSignals,
    stakeSignals: output.stakeSignals,
    arcSignals: output.arcSignals,
    endingSignals: output.endingSignals,
    characterObservations,
    unknownCharacterObservations,
  };
}

function selectOfferedObservations<T extends { id: string }>(
  observations: T[],
  selectedIds: string[],
): T[] {
  const observationById = new Map(
    observations.map((observation) => [observation.id, observation]),
  );
  return uniqueValues(selectedIds).flatMap((id) => {
    const observation = observationById.get(id);
    return observation === undefined ? [] : [observation];
  });
}

export async function reduceChapterKnowledge(
  input: {
    sourceFingerprint: string;
    analyses: StoryChunkAnalysis[];
  },
  options: StoryKnowledgeAiOptions,
): Promise<ChapterKnowledge> {
  const renderedPrompt = renderPrompt("CHAPTER ANALYSES", input.analyses);
  const resultSchema = chapterKnowledgeResultSchema;
  const { output } = await withAiRetry(() =>
    generateText({
      model: options.model,
      output: Output.object({ schema: resultSchema }),
      system: CHAPTER_REDUCE_SYSTEM_CONTRACT,
      prompt: renderedPrompt,
      abortSignal: options.signal,
    }),
  );

  const offeredCharacterObservations = input.analyses.flatMap(
    (analysis) => analysis.characterObservations,
  );
  const offeredUnknownCharacterObservations = input.analyses.flatMap(
    (analysis) => analysis.unknownCharacterObservations,
  );
  return {
    sourceFingerprint: input.sourceFingerprint,
    summary: output.summary,
    premiseSignals: output.premiseSignals,
    conflictSignals: output.conflictSignals,
    stakeSignals: output.stakeSignals,
    arcSignals: output.arcSignals,
    endingSignals: output.endingSignals,
    characterObservations: selectOfferedObservations(
      offeredCharacterObservations,
      output.characterObservationIds,
    ),
    unknownCharacterObservations: selectOfferedObservations(
      offeredUnknownCharacterObservations,
      output.unknownCharacterObservationIds,
    ),
  };
}

export async function reduceStoryFields(
  input: {
    current: Outline;
    chapters: Array<{
      chapterId: string;
      title: string;
      knowledge: ChapterKnowledge;
    }>;
  },
  options: StoryKnowledgeAiOptions,
): Promise<StoryFieldReduction> {
  const renderedPrompt = renderPrompt("ORDERED STORY KNOWLEDGE", input);
  const resultSchema = storyFieldReductionResultSchema;
  const { output } = await withAiRetry(() =>
    generateText({
      model: options.model,
      output: Output.object({ schema: resultSchema }),
      system: STORY_REDUCE_SYSTEM_CONTRACT,
      prompt: renderedPrompt,
      abortSignal: options.signal,
    }),
  );

  if (output.overview.length > STORY_OVERVIEW_MAX_CHARS) {
    throw new Error(
      `Story overview exceeds ${STORY_OVERVIEW_MAX_CHARS} characters`,
    );
  }
  if (
    input.current.premise.trim().length > 0 &&
    output.premise.trim().length === 0
  ) {
    throw new Error(
      "Story premise cannot be blank when the current premise is nonempty",
    );
  }
  if (
    input.current.overview.trim().length > 0 &&
    output.overview.trim().length === 0
  ) {
    throw new Error(
      "Story overview cannot be blank when the current overview is nonempty",
    );
  }
  return output;
}

function knownObservationIds(
  observations: CharacterObservation[],
  appliedObservationIds: string[],
): Set<string> {
  const applied = new Set(appliedObservationIds);
  return new Set(
    observations
      .map((observation) => observation.id)
      .filter((id) => !applied.has(id)),
  );
}

function sanitizeOperationObservationIds(
  observationIds: string[],
  knownIds: Set<string>,
): string[] {
  return uniqueValues(observationIds).filter((id) => knownIds.has(id));
}

export async function reduceCharacterPatch(
  input: {
    character: Character;
    observations: CharacterObservation[];
    appliedObservationIds: string[];
  },
  options: StoryKnowledgeAiOptions,
): Promise<CharacterKnowledgePatch> {
  const renderedPrompt = renderPrompt("CHARACTER KNOWLEDGE INPUT", input);
  const resultSchema = characterKnowledgePatchResultSchema;
  const { output } = await withAiRetry(() =>
    generateText({
      model: options.model,
      output: Output.object({ schema: resultSchema }),
      system: CHARACTER_REDUCE_SYSTEM_CONTRACT,
      prompt: renderedPrompt,
      abortSignal: options.signal,
    }),
  );

  const knownIds = knownObservationIds(
    input.observations,
    input.appliedObservationIds,
  );
  const additions = output.additions.flatMap((addition) => {
    const text = addition.text.trim();
    const observationIds = sanitizeOperationObservationIds(
      addition.observationIds,
      knownIds,
    );
    return text.length === 0 || observationIds.length === 0
      ? []
      : [{ ...addition, text, observationIds }];
  });
  const corrections = output.corrections.flatMap((correction) => {
    const replaceExact = correction.replaceExact.trim();
    const replacement = correction.replacement.trim();
    const observationIds = sanitizeOperationObservationIds(
      correction.observationIds,
      knownIds,
    );
    return replaceExact.length === 0 ||
      replacement.length === 0 ||
      observationIds.length === 0
      ? []
      : [{ ...correction, replaceExact, replacement, observationIds }];
  });
  return { additions, corrections };
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export async function reduceCharacterCandidates(
  input: { groups: UnknownCharacterGroup[] },
  options: StoryKnowledgeAiOptions,
): Promise<CharacterCandidateReduction[]> {
  const renderedPrompt = renderPrompt("ELIGIBLE CHARACTER GROUPS", input.groups);
  const resultSchema = characterCandidateReductionResultSchema;
  const { output } = await withAiRetry(() =>
    generateText({
      model: options.model,
      output: Output.object({ schema: resultSchema }),
      system: CANDIDATE_REDUCE_SYSTEM_CONTRACT,
      prompt: renderedPrompt,
      abortSignal: options.signal,
    }),
  );

  const groupByFingerprint = new Map(
    input.groups.map((group) => [group.evidenceFingerprint, group]),
  );
  const retainedFingerprints = new Set<string>();
  return output.candidates.flatMap((candidate) => {
    const group = groupByFingerprint.get(candidate.groupFingerprint);
    if (
      group === undefined ||
      retainedFingerprints.has(candidate.groupFingerprint) ||
      normalizedName(candidate.name) !== group.normalizedName
    ) {
      return [];
    }
    retainedFingerprints.add(candidate.groupFingerprint);
    return [
      {
        ...candidate,
        name: candidate.name.trim(),
        role: candidate.role.trim(),
      },
    ];
  });
}
