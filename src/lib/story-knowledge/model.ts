import type { CharacterProfile, ProjectKnowledge } from "@/lib/types";

export function emptyCharacterProfile(): CharacterProfile {
  return {
    appearance: "",
    mannerisms: "",
    motivations: "",
    relationships: "",
    history: "",
    voice: "",
  };
}

export function emptyProjectKnowledge(): ProjectKnowledge {
  return {
    chapterTopologyFingerprint: "",
    chapters: {},
    characterCandidates: [],
    acceptedCandidateFingerprints: [],
    dismissedCandidateFingerprints: [],
    appliedCharacterObservationIds: {},
  };
}
