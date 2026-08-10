import type { SourceDocumentUIPart } from "ai";
import type {
  AgentUIMessage,
  ContextSnapshot,
  ContextSourceResolver,
  DraftContextRef,
  DraftContextSource,
  DraftSourceLocator,
  SourceLocator,
} from "@/lib/ai/agent-types";
import { dialogueSegments } from "@/lib/blocks/dialogue";
import type {
  Block,
  Card,
  CharacterProfile,
  ChapterRef,
  CritiqueNote,
  ContinuityFlag,
  Outline,
  ProjectMeta,
  ProjectKnowledge,
} from "@/lib/types";

export interface FlattenedMessageFinding {
  id: string;
  partIndex: number;
  chapterId: string;
  finding: CritiqueNote | ContinuityFlag;
}

export function textFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function blockFingerprint(block: Block): string {
  return textFingerprint(
    JSON.stringify([
      block.type,
      block.text,
      block.speaker ?? null,
      block.tail ?? null,
      block.title ?? null,
      block.level ?? null,
    ]),
  );
}

export function blockOrderFingerprint(blocks: Block[]): string {
  return textFingerprint(JSON.stringify(blocks.map(blockFingerprint)));
}

export function cardFingerprint(card: Card): string {
  return textFingerprint(
    JSON.stringify([
      card.id,
      card.title,
      card.intention,
      card.characterIds,
      card.loreIds,
    ]),
  );
}

export function outlineOrderFingerprint(cards: Card[]): string {
  return textFingerprint(
    JSON.stringify(cards.map((card) => [card.id, cardFingerprint(card)])),
  );
}

export function projectMetaFingerprint(meta: ProjectMeta): string {
  return textFingerprint(JSON.stringify(meta));
}

export function storyOverviewFingerprint(overview: string): string {
  return textFingerprint(JSON.stringify(overview));
}

export function characterProfileFingerprint(profile: CharacterProfile): string {
  return textFingerprint(JSON.stringify(profile));
}

export function storyFieldsFingerprint(outline: Outline): string {
  return textFingerprint(JSON.stringify([outline.premise, outline.overview]));
}

export function chapterTopologyFingerprint(chapters: ChapterRef[]): string {
  return textFingerprint(
    JSON.stringify(chapters.map((chapter) => [chapter.id, chapter.title])),
  );
}

export function candidateInputFingerprint(
  knowledge: Pick<
    ProjectKnowledge,
    | "characterCandidates"
    | "acceptedCandidateFingerprints"
    | "dismissedCandidateFingerprints"
  >,
): string {
  const candidates = knowledge.characterCandidates
    .map((candidate) => [candidate.id, candidate.evidenceFingerprint])
    .sort(([leftId, leftFingerprint], [rightId, rightFingerprint]) => {
      if (leftId !== rightId) return leftId < rightId ? -1 : 1;
      if (leftFingerprint === rightFingerprint) return 0;
      return leftFingerprint < rightFingerprint ? -1 : 1;
    });
  const dismissed = [...knowledge.dismissedCandidateFingerprints].sort(
    (left, right) => (left === right ? 0 : left < right ? -1 : 1),
  );
  const accepted = [...knowledge.acceptedCandidateFingerprints].sort(
    (left, right) => (left === right ? 0 : left < right ? -1 : 1),
  );
  return textFingerprint(JSON.stringify([candidates, accepted, dismissed]));
}

export function findingFingerprint(
  finding: CritiqueNote | ContinuityFlag,
): string {
  return textFingerprint(JSON.stringify(finding));
}

export function flattenMessageFindings(
  message: AgentUIMessage,
): FlattenedMessageFinding[] {
  const findings: FlattenedMessageFinding[] = [];
  for (const [partIndex, part] of message.parts.entries()) {
    if (part.type !== "data-findings") continue;
    for (const finding of part.data.items) {
      findings.push({
        id: `${message.id}:${findings.length}`,
        partIndex,
        chapterId: part.data.chapterId,
        finding,
      });
    }
  }
  return findings;
}

function isProseBlock(block: Block): boolean {
  return block.type === "narration" || block.type === "dialogue";
}

export function blockSnapshotText(block: Block): string {
  const body =
    block.type === "dialogue"
      ? dialogueSegments(block)
          .map((segment) => segment.text)
          .join("\n")
      : block.text;
  return block.title === undefined ? body : `${block.title}\n${body}`;
}

export function cardSnapshotText(card: Card): string {
  return `${card.title}\n${card.intention}`;
}

export function draftContextRefKey(ref: DraftContextRef): string {
  if (ref.kind === "block") {
    return `block:${ref.chapterId}:${ref.blockId}`;
  }
  if (ref.kind === "outline-card") {
    return `outline-card:${ref.chapterId}:${ref.cardId}`;
  }
  return `finding:${ref.chapterId}:${ref.findingId}`;
}

export function findBridgeSuccessor(
  blocks: Block[],
  anchorBlockId: string,
): string | null {
  const anchorIndex = blocks.findIndex((block) => block.id === anchorBlockId);
  if (anchorIndex < 0) {
    throw new Error(`Bridge anchor not found: ${anchorBlockId}`);
  }
  return (
    blocks
      .slice(anchorIndex + 1)
      .find((block) => isProseBlock(block))?.id ?? null
  );
}

function blockSnapshot(
  ref: Extract<DraftContextRef, { kind: "block" }>,
  locator: DraftSourceLocator | null,
  resolver: ContextSourceResolver,
  makeId: () => string,
): ContextSnapshot {
  const resolved = resolver.resolveBlock(ref.chapterId, ref.blockId, locator);
  if (resolved === null) {
    throw new Error(
      `Draft block context is unavailable: ${ref.chapterId}/${ref.blockId}`,
    );
  }
  const label =
    resolved.block.type === "dialogue"
      ? "Dialogue block"
      : resolved.block.type === "narration"
        ? "Narration block"
        : "Manuscript block";
  return {
    id: makeId(),
    kind: "block",
    chapterId: resolved.chapterId,
    sourceId: resolved.block.id,
    order: resolved.order,
    sourceType: resolved.block.type,
    label,
    exactText: blockSnapshotText(resolved.block),
    sourceFingerprint: blockFingerprint(resolved.block),
  };
}

function outlineSnapshot(
  ref: Extract<DraftContextRef, { kind: "outline-card" }>,
  locator: DraftSourceLocator | null,
  resolver: ContextSourceResolver,
  makeId: () => string,
): ContextSnapshot {
  const resolved = resolver.resolveOutlineCard(
    ref.chapterId,
    ref.cardId,
    locator,
  );
  if (resolved === null) {
    throw new Error(
      `Draft outline context is unavailable: ${ref.chapterId}/${ref.cardId}`,
    );
  }
  return {
    id: makeId(),
    kind: "outline-card",
    chapterId: resolved.chapterId,
    sourceId: resolved.card.id,
    order: resolved.order,
    sourceType: "outline-card",
    label: resolved.card.title,
    exactText: cardSnapshotText(resolved.card),
    sourceFingerprint: cardFingerprint(resolved.card),
  };
}

function findingSnapshot(
  ref: Extract<DraftContextRef, { kind: "finding" }>,
  locator: DraftSourceLocator | null,
  resolver: ContextSourceResolver,
  makeId: () => string,
): ContextSnapshot {
  const resolved = resolver.resolveFinding(
    ref.chapterId,
    ref.findingId,
    locator,
  );
  if (resolved === null) {
    throw new Error(
      `Draft finding context is unavailable: ${ref.chapterId}/${ref.findingId}`,
    );
  }
  const sourceType = "kind" in resolved.finding ? "critique" : "continuity";
  return {
    id: makeId(),
    kind: "finding",
    chapterId: resolved.chapterId,
    sourceId: ref.findingId,
    order: resolved.order,
    sourceType,
    label: resolved.finding.tag,
    exactText: resolved.finding.text,
    sourceFingerprint: findingFingerprint(resolved.finding),
  };
}

export function resolveDraftSnapshots(
  refs: DraftContextRef[],
  locators: Record<string, DraftSourceLocator>,
  resolver: ContextSourceResolver,
  makeId: () => string,
): ContextSnapshot[] {
  return refs.map((ref) => {
    const locator = locators[draftContextRefKey(ref)] ?? null;
    if (ref.kind === "block") {
      return blockSnapshot(ref, locator, resolver, makeId);
    }
    if (ref.kind === "outline-card") {
      return outlineSnapshot(ref, locator, resolver, makeId);
    }
    return findingSnapshot(ref, locator, resolver, makeId);
  });
}

export function contextSnapshotToSourcePart(
  snapshot: ContextSnapshot,
): SourceDocumentUIPart & { id: string } {
  return {
    id: snapshot.id,
    type: "source-document",
    sourceId: snapshot.sourceId,
    mediaType: "text/plain",
    title: snapshot.label,
    filename: `Chapter ${snapshot.chapterId}`,
  };
}

export function draftContextSourceToSourcePart(
  source: DraftContextSource,
): SourceDocumentUIPart & { id: string } {
  const id = draftContextRefKey(source.ref);
  return {
    id,
    type: "source-document",
    sourceId: source.resolved?.sourceId ?? id,
    mediaType: "text/plain",
    title: source.label,
    filename: source.available
      ? `Chapter ${source.ref.chapterId}`
      : "Unavailable",
  };
}

export function resolveSnapshotBlock(
  snapshot: ContextSnapshot,
  blocks: Block[],
): Block | null {
  const exact = blocks.find((block) => block.id === snapshot.sourceId);
  if (exact !== undefined) return exact;
  const atOrder = blocks[snapshot.order];
  return atOrder !== undefined &&
    blockFingerprint(atOrder) === snapshot.sourceFingerprint
    ? atOrder
    : null;
}

export function resolveLiveBlockLocator(
  locator: SourceLocator,
  blocks: Block[],
): Block | null {
  const exact = blocks.find((block) => block.id === locator.sourceId);
  if (exact !== undefined) return exact;
  const atOrder = blocks[locator.order];
  return atOrder !== undefined &&
    blockFingerprint(atOrder) === locator.fingerprint
    ? atOrder
    : null;
}

export function resolveLiveCardLocator(
  locator: SourceLocator,
  cards: Card[],
): Card | null {
  const exact = cards.find((card) => card.id === locator.sourceId);
  if (exact !== undefined) return exact;
  const atOrder = cards[locator.order];
  if (atOrder === undefined) return null;
  const frozenIdentityCard = { ...atOrder, id: locator.sourceId };
  return cardFingerprint(frozenIdentityCard) === locator.fingerprint
    ? atOrder
    : null;
}
