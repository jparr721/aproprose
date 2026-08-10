import type {
  ChapterKnowledge,
  Character,
  Outline,
} from "@/lib/types";

export interface CharacterGroundingInput {
  character: Character;
  outline: Outline;
  chapters: Array<{
    chapterId: string;
    title: string;
    knowledge: ChapterKnowledge;
  }>;
}

export function buildCharacterGrounding(
  input: CharacterGroundingInput,
): string {
  const chapters = input.chapters.flatMap((chapter) => {
    const observations = chapter.knowledge.characterObservations
      .filter(
        (observation) => observation.characterId === input.character.id,
      )
      .map((observation) => ({
        field: observation.field,
        detail: observation.detail,
        evidence: observation.evidence.map((evidence) => ({
          sourceId: evidence.sourceId,
          previewText: evidence.previewText,
        })),
      }));
    return observations.length === 0
      ? []
      : [
          {
            chapterId: chapter.chapterId,
            title: chapter.title,
            summary: chapter.knowledge.summary,
            observations,
          },
        ];
  });
  return `CHARACTER DESCRIBE GROUNDING\n${JSON.stringify(
    {
      character: {
        id: input.character.id,
        name: input.character.name,
        role: input.character.role,
        profile: input.character.profile,
      },
      logline: input.outline.premise,
      overview: input.outline.overview,
      chapters,
    },
    null,
    2,
  )}`;
}
