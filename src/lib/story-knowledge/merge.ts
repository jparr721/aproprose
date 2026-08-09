import { textFingerprint } from "@/lib/ai/agent-context";
import { durableEvidenceIdentity } from "@/lib/story-knowledge/chunking";
import type {
  CharacterKnowledgePatch,
  CharacterObservation,
  CharacterProfile,
  CharacterProfileField,
  EvidenceLocator,
  UnknownCharacterObservation,
} from "@/lib/types";

const CHARACTER_PROFILE_FIELDS: CharacterProfileField[] = [
  "appearance",
  "mannerisms",
  "motivations",
  "relationships",
  "history",
  "voice",
];

export interface CharacterPatchResult {
  profile: CharacterProfile;
  appliedObservationIds: string[];
}

export interface UnknownCharacterGroup {
  name: string;
  normalizedName: string;
  role: string;
  details: Partial<CharacterProfile>;
  evidence: EvidenceLocator[];
  evidenceFingerprint: string;
}

interface PendingUnknownCharacterGroup {
  name: string;
  normalizedName: string;
  role: string;
  detailValues: Partial<Record<CharacterProfileField, string[]>>;
  evidence: EvidenceLocator[];
  evidenceKeys: Set<string>;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function cloneEvidence(locator: EvidenceLocator): EvidenceLocator {
  return { ...locator };
}

function sortedEvidenceFingerprints(evidence: EvidenceLocator[]): string[] {
  return evidence.map(durableEvidenceIdentity).sort();
}

function observationSemanticKey(observation: CharacterObservation): string {
  return JSON.stringify([
    normalize(observation.characterId),
    observation.field,
    normalize(observation.detail),
    sortedEvidenceFingerprints(observation.evidence),
  ]);
}

function operationWasApplied(
  observationIds: string[],
  appliedIds: Set<string>,
): boolean {
  return observationIds.some((observationId) => appliedIds.has(observationId));
}

function withObservationIds(
  observationIds: string[],
  appliedIds: Set<string>,
): Set<string> {
  return new Set([...appliedIds, ...observationIds]);
}

function evidenceLocatorKey(locator: EvidenceLocator): string {
  return durableEvidenceIdentity(locator);
}

function mergeUnknownObservation(
  group: PendingUnknownCharacterGroup,
  observation: UnknownCharacterObservation,
): PendingUnknownCharacterGroup {
  const role =
    group.role.length === 0 && observation.role.trim().length > 0
      ? observation.role.trim()
      : group.role;
  const detailValues = { ...group.detailValues };

  for (const field of CHARACTER_PROFILE_FIELDS) {
    const detail = observation.details[field]?.trim();
    if (detail === undefined || detail.length === 0) continue;

    const values = detailValues[field] ?? [];
    if (!values.some((value) => normalize(value) === normalize(detail))) {
      detailValues[field] = [...values, detail];
    }
  }

  const evidenceKeys = new Set(group.evidenceKeys);
  const evidence = [...group.evidence];
  for (const locator of observation.evidence) {
    const locatorKey = evidenceLocatorKey(locator);
    if (evidenceKeys.has(locatorKey)) continue;
    evidenceKeys.add(locatorKey);
    evidence.push(cloneEvidence(locator));
  }

  return { ...group, role, detailValues, evidence, evidenceKeys };
}

function groupDetails(
  detailValues: Partial<Record<CharacterProfileField, string[]>>,
): Partial<CharacterProfile> {
  const details: Partial<CharacterProfile> = {};
  for (const field of CHARACTER_PROFILE_FIELDS) {
    const values = detailValues[field];
    if (values !== undefined && values.length > 0) {
      details[field] = values.join("\n\n");
    }
  }
  return details;
}

export function dedupeCharacterObservations(
  observations: CharacterObservation[],
): CharacterObservation[] {
  const ids = new Set<string>();
  const semanticKeys = new Set<string>();
  const deduplicated: CharacterObservation[] = [];

  for (const observation of observations) {
    if (ids.has(observation.id)) continue;
    ids.add(observation.id);

    const semanticKey = observationSemanticKey(observation);
    if (semanticKeys.has(semanticKey)) continue;
    semanticKeys.add(semanticKey);
    deduplicated.push({
      ...observation,
      evidence: observation.evidence.map(cloneEvidence),
    });
  }

  return deduplicated;
}

export function applyCharacterKnowledgePatch(
  profile: CharacterProfile,
  patch: CharacterKnowledgePatch,
  appliedObservationIds: string[],
): CharacterPatchResult {
  const nextProfile = { ...profile };
  let appliedIds = new Set(appliedObservationIds);

  for (const addition of patch.additions) {
    const text = addition.text.trim();
    if (
      text.length === 0 ||
      operationWasApplied(addition.observationIds, appliedIds)
    ) {
      continue;
    }

    const current = nextProfile[addition.field];
    nextProfile[addition.field] =
      current.trim().length === 0 ? text : `${current.trimEnd()}\n\n${text}`;
    appliedIds = withObservationIds(addition.observationIds, appliedIds);
  }

  for (const correction of patch.corrections) {
    const replaceExact = correction.replaceExact.trim();
    const replacement = correction.replacement.trim();
    if (
      replaceExact.length === 0 ||
      replacement.length === 0 ||
      operationWasApplied(correction.observationIds, appliedIds)
    ) {
      continue;
    }

    const current = nextProfile[correction.field];
    if (current.includes(replaceExact)) {
      nextProfile[correction.field] = current.replace(replaceExact, replacement);
    }
    appliedIds = withObservationIds(correction.observationIds, appliedIds);
  }

  return {
    profile: nextProfile,
    appliedObservationIds: [...appliedIds],
  };
}

export function candidateEvidenceFingerprint(
  name: string,
  evidence: EvidenceLocator[],
): string {
  const locatorKeys = [
    ...new Set(evidence.map((locator) => evidenceLocatorKey(locator))),
  ].sort();
  return textFingerprint(JSON.stringify([normalize(name), locatorKeys]));
}

export function eligibleUnknownCharacterGroups(
  observations: UnknownCharacterObservation[],
  dismissedFingerprints: string[],
): UnknownCharacterGroup[] {
  const pendingGroups = new Map<string, PendingUnknownCharacterGroup>();

  for (const observation of observations) {
    const normalizedName = normalize(observation.name);
    if (normalizedName.length === 0) continue;

    const existingGroup = pendingGroups.get(normalizedName);
    const group = mergeUnknownObservation(
      existingGroup ?? {
        name: observation.name.trim(),
        normalizedName,
        role: observation.role.trim(),
        detailValues: {},
        evidence: [],
        evidenceKeys: new Set<string>(),
      },
      observation,
    );
    pendingGroups.set(normalizedName, group);
  }

  const dismissed = new Set(dismissedFingerprints);
  const eligible: UnknownCharacterGroup[] = [];
  for (const group of pendingGroups.values()) {
    const details = groupDetails(group.detailValues);
    const supportedFieldCount = CHARACTER_PROFILE_FIELDS.filter(
      (field) => details[field]?.trim().length,
    ).length;
    if (group.evidence.length < 2 && supportedFieldCount < 2) continue;

    const evidenceFingerprint = candidateEvidenceFingerprint(
      group.normalizedName,
      group.evidence,
    );
    if (dismissed.has(evidenceFingerprint)) continue;

    eligible.push({
      name: group.name,
      normalizedName: group.normalizedName,
      role: group.role,
      details,
      evidence: group.evidence.map(cloneEvidence),
      evidenceFingerprint,
    });
  }

  return eligible;
}
