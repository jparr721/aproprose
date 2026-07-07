// structure-proposal.ts - turn a refined seed (structurePassage output + model
// speaker attributions) into a reviewable ManuscriptProposal: insert every
// refined block after the source, then remove the source. Pure; the model call
// lives in ai/operations.ts (assignSpeakers).

import type { Block, BlockChange, Character, ManuscriptProposal } from "@/lib/types";

export interface SpeakerAssignment {
  index: number;
  speaker: string | null;
}

/** Fill dialogue-block speaker ids from name assignments; narration untouched. */
export function applyAssignments(
  seed: Block[],
  assignments: SpeakerAssignment[],
  cast: Character[],
): Block[] {
  const idByName = new Map(cast.map((c) => [c.name.toLowerCase(), c.id]));
  const nameByIndex = new Map(assignments.map((a) => [a.index, a.speaker]));
  return seed.map((b, i) => {
    if (b.type !== "dialogue") return b;
    const name = nameByIndex.get(i);
    if (name == null) return b;
    const id = idByName.get(name.toLowerCase());
    return id ? { ...b, speaker: id } : b;
  });
}

/** Insert every refined block after `targetId` (reading order), then remove the
 *  source. Insert speakers are display NAMES (applyProposal resolves them to ids). */
export function buildStructureProposal(
  chapterId: string,
  targetId: string,
  refined: Block[],
  cast: Character[],
): ManuscriptProposal {
  const nameById = new Map(cast.map((c) => [c.id, c.name]));
  const inserts: BlockChange[] = refined.map((b) => ({
    kind: "insert",
    blockId: null,
    afterId: targetId,
    type: b.type === "dialogue" ? "dialogue" : "narration",
    speaker: b.speaker ? nameById.get(b.speaker) ?? null : null,
    newText: b.text,
    segments: b.tail,
    toIndex: null,
    reason: "structured from passage",
  }));
  const remove: BlockChange = {
    kind: "remove",
    blockId: targetId,
    afterId: null,
    type: null,
    speaker: null,
    newText: null,
    toIndex: null,
    reason: "replaced by structured blocks",
  };
  return { chapterId, summary: "Structure passage into blocks", changes: [...inserts, remove] };
}
