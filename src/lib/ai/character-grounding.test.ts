import { describe, expect, it } from "vitest";
import { buildCharacterGrounding } from "@/lib/ai/character-grounding";
import { emptyCharacterProfile } from "@/lib/story-knowledge/model";
import type {
  ChapterKnowledge,
  Character,
  CharacterObservation,
} from "@/lib/types";

function characterFixture(id: string, name: string): Character {
  return {
    id,
    name,
    color: "#123456",
    role: "Courier",
    profile: emptyCharacterProfile(),
  };
}

function observationFixture(characterId: string): CharacterObservation {
  return {
    id: `observation-${characterId}`,
    characterId,
    field: "mannerisms",
    detail: "Counts every door.",
    evidence: [
      {
        chapterId: "ch1",
        sourceId: "block-1",
        order: 0,
        fingerprint: "fingerprint-1",
        previewText: "Mara counted the doors twice.",
      },
    ],
  };
}

function chapterKnowledgeFixture(
  characterObservations: CharacterObservation[],
): ChapterKnowledge {
  return {
    sourceFingerprint: "chapter-fingerprint",
    summary: "A courier runs.",
    premiseSignals: [],
    conflictSignals: [],
    stakeSignals: [],
    arcSignals: [],
    endingSignals: [],
    characterObservations,
    unknownCharacterObservations: [
      {
        id: "unknown-1",
        name: "Stranger",
        role: "Watcher",
        details: { appearance: "Silver coat." },
        evidence: [],
      },
    ],
  };
}

describe("buildCharacterGrounding", () => {
  it("grounds Describe on the selected profile and only related chapter knowledge", () => {
    const grounding = buildCharacterGrounding({
      character: characterFixture("c1", "Mara"),
      outline: {
        premise: "A courier steals a secret.",
        overview: "Mara runs.",
      },
      chapters: [
        {
          chapterId: "ch1",
          title: "The Theft",
          knowledge: chapterKnowledgeFixture([observationFixture("c1")]),
        },
        {
          chapterId: "ch2",
          title: "The Watcher",
          knowledge: chapterKnowledgeFixture([observationFixture("c2")]),
        },
      ],
    });

    expect(grounding).toContain("CHARACTER DESCRIBE GROUNDING");
    expect(grounding).toContain("Mara");
    expect(grounding).toContain("A courier steals a secret.");
    expect(grounding).toContain("Mara runs.");
    expect(grounding).toContain("ch1");
    expect(grounding).toContain("Mara counted the doors twice.");
    expect(grounding).not.toContain("ch2");
    expect(grounding).not.toContain("Stranger");
    expect(grounding).not.toContain("#123456");
  });
});
