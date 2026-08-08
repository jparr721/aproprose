import { describe, expect, it } from "vitest";
import { emptyCharacterProfile } from "@/lib/story-knowledge/model";
import {
  applyCharacterKnowledgePatch,
  candidateEvidenceFingerprint,
  dedupeCharacterObservations,
  eligibleUnknownCharacterGroups,
} from "@/lib/story-knowledge/merge";
import type {
  CharacterObservation,
  CharacterProfile,
  EvidenceLocator,
  UnknownCharacterObservation,
} from "@/lib/types";

function evidence(
  chapterId: string,
  sourceId: string,
  fingerprint: string,
): EvidenceLocator {
  return {
    chapterId,
    sourceId,
    order: 0,
    fingerprint,
    previewText: "A short evidence preview.",
  };
}

function unknownObservation(
  id: string,
  name: string,
  details: Partial<CharacterProfile>,
  sourceId: string,
): UnknownCharacterObservation {
  return {
    id,
    name,
    role: "Traveler",
    details,
    evidence: [evidence("ch1", sourceId, `fp-${sourceId}`)],
  };
}

describe("character observation deduplication", () => {
  it("keeps the first deterministic ID for identical and semantic duplicates", () => {
    const first: CharacterObservation = {
      id: "obs-first",
      characterId: " Mara ",
      field: "appearance",
      detail: " Gray eyes ",
      evidence: [evidence("ch1", "b2", "fp-2"), evidence("ch1", "b1", "fp-1")],
    };
    const observations = [
      first,
      { ...first, detail: "Different detail" },
      {
        ...first,
        id: "obs-semantic-duplicate",
        characterId: "mara",
        detail: "gray eyes",
        evidence: [...first.evidence].reverse(),
      },
      {
        ...first,
        id: "obs-distinct",
        detail: "Wears a silver ring",
      },
    ];

    const result = dedupeCharacterObservations(observations);

    expect(result.map((observation) => observation.id)).toEqual([
      "obs-first",
      "obs-distinct",
    ]);
    expect(result).not.toBe(observations);
    expect(result[0]).not.toBe(first);
    expect(result[0].evidence).not.toBe(first.evidence);
  });
});

describe("character knowledge patches", () => {
  it("appends new observations once and preserves existing prose", () => {
    const profile = {
      ...emptyCharacterProfile(),
      mannerisms: "Mara taps the table before answering.",
    };
    const patch = {
      additions: [
        {
          field: "mannerisms" as const,
          text: "She squares objects with the table edge.",
          observationIds: ["obs-1"],
        },
      ],
      corrections: [],
    };

    const first = applyCharacterKnowledgePatch(profile, patch, []);
    const second = applyCharacterKnowledgePatch(
      first.profile,
      patch,
      first.appliedObservationIds,
    );

    expect(first.profile.mannerisms).toBe(
      "Mara taps the table before answering.\n\nShe squares objects with the table edge.",
    );
    expect(second.profile).toEqual(first.profile);
    expect(first.profile).not.toBe(profile);
    expect(second.profile).not.toBe(first.profile);
    expect(second.appliedObservationIds).not.toBe(first.appliedObservationIds);
  });

  it("applies a correction only when its exact source text remains live", () => {
    const profile = {
      ...emptyCharacterProfile(),
      appearance: "Mara has blue eyes.",
    };
    const patch = {
      additions: [],
      corrections: [
        {
          field: "appearance" as const,
          replaceExact: "blue eyes",
          replacement: "gray eyes",
          observationIds: ["obs-2"],
        },
      ],
    };
    expect(applyCharacterKnowledgePatch(profile, patch, []).profile.appearance).toBe(
      "Mara has gray eyes.",
    );
    expect(
      applyCharacterKnowledgePatch(
        { ...profile, appearance: "The author rewrote this field." },
        patch,
        [],
      ),
    ).toMatchObject({
      profile: { appearance: "The author rewrote this field." },
      appliedObservationIds: ["obs-2"],
    });
  });

  it("ignores blank operations and any operation with applied evidence", () => {
    const profile = {
      ...emptyCharacterProfile(),
      history: "Original history.",
    };
    const result = applyCharacterKnowledgePatch(
      profile,
      {
        additions: [
          { field: "history", text: "   ", observationIds: ["blank-add"] },
          {
            field: "history",
            text: "Duplicate history.",
            observationIds: ["old", "new"],
          },
        ],
        corrections: [
          {
            field: "history",
            replaceExact: "Original history.",
            replacement: "   ",
            observationIds: ["blank-correction"],
          },
        ],
      },
      ["old"],
    );

    expect(result).toEqual({
      profile,
      appliedObservationIds: ["old"],
    });
    expect(result.profile).not.toBe(profile);
  });
});

describe("unknown character grouping", () => {
  it("requires two blocks or two supported profile fields", () => {
    const groups = eligibleUnknownCharacterGroups(
      [
        unknownObservation("u1", "Inez", { appearance: "Silver hair" }, "b1"),
        unknownObservation("u2", "Inez", { mannerisms: "Counts doors" }, "b1"),
        unknownObservation("u3", "Tomas", { history: "A baker" }, "b2"),
      ],
      [],
    );
    expect(groups.map((group) => group.name)).toEqual(["Inez"]);
  });

  it("normalizes names, merges details, and counts locators across chapters", () => {
    const first = unknownObservation(
      "u1",
      "  INEZ ",
      { appearance: " Silver hair " },
      "shared-block",
    );
    const second = {
      ...unknownObservation(
        "u2",
        "inez",
        { appearance: "Blue coat" },
        "shared-block",
      ),
      role: "Guide",
      evidence: [evidence("ch2", "shared-block", "fp-2")],
    };

    const [group] = eligibleUnknownCharacterGroups([first, second], []);

    expect(group).toMatchObject({
      name: "INEZ",
      normalizedName: "inez",
      role: "Traveler",
      details: { appearance: "Silver hair\n\nBlue coat" },
    });
    expect(group.evidence).toHaveLength(2);
  });

  it("removes blank names and dismissed evidence fingerprints", () => {
    const observations = [
      unknownObservation("blank-1", "   ", { appearance: "A hood" }, "b1"),
      unknownObservation("blank-2", "   ", { history: "Unknown" }, "b2"),
      unknownObservation("u1", "Inez", { appearance: "Silver hair" }, "b1"),
      unknownObservation("u2", "inez", { mannerisms: "Counts doors" }, "b1"),
    ];
    const [eligible] = eligibleUnknownCharacterGroups(observations, []);

    expect(
      eligibleUnknownCharacterGroups(observations, [eligible.evidenceFingerprint]),
    ).toEqual([]);
  });
});

describe("candidate evidence fingerprints", () => {
  it("is stable for normalized names and reordered evidence", () => {
    const firstEvidence = evidence("ch1", "b1", "fp-1");
    const secondEvidence = evidence("ch2", "b2", "fp-2");

    expect(
      candidateEvidenceFingerprint(" Inez ", [firstEvidence, secondEvidence]),
    ).toBe(
      candidateEvidenceFingerprint("inez", [secondEvidence, firstEvidence]),
    );
    expect(candidateEvidenceFingerprint("Inez", [firstEvidence])).not.toBe(
      candidateEvidenceFingerprint("Inez", [secondEvidence]),
    );
  });
});
