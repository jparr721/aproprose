import {
  cardFingerprint,
  findingFingerprint,
  flattenMessageFindings,
  resolveSnapshotBlock,
} from "@/lib/ai/agent-context";
import type {
  ContextSnapshot,
  ManuscriptPendingChange,
  OutlinePendingChange,
  SourceLocator,
} from "@/lib/ai/agent-types";
import type { Block, Card } from "@/lib/types";
import { useAgentConsoleStore } from "@/stores/agent-console-store";
import { useOutlineBoardStore } from "@/stores/outline-board-store";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";

type BlockResolver = (blocks: Block[]) => Block | null;

function scheduleScroll(attribute: string, id: string): void {
  requestAnimationFrame(() => {
    const selector = `[${attribute}="${CSS.escape(id)}"]`;
    document.querySelector(selector)?.scrollIntoView({ block: "center" });
  });
}

function selectBlock(block: Block): boolean {
  useProjectStore.getState().select(block.id);
  scheduleScroll("data-block-id", block.id);
  return true;
}

async function selectChapterBlock(
  chapterId: string,
  resolve: BlockResolver,
): Promise<boolean> {
  await useProjectStore.getState().selectChapter(chapterId);
  const state = useProjectStore.getState();
  if (state.activeChapterId !== chapterId) return false;
  const block = resolve(state.blocks);
  return block === null ? false : selectBlock(block);
}

async function navigateToBlock(
  chapterId: string,
  resolve: BlockResolver,
): Promise<boolean> {
  const projectState = useProjectStore.getState();
  if (
    projectState.project === null ||
    !projectState.project.chapters.some((chapter) => chapter.id === chapterId)
  ) {
    return false;
  }
  if (projectState.activeChapterId === chapterId) {
    const block = resolve(projectState.blocks);
    return block === null ? false : selectBlock(block);
  }

  let navigation: Promise<boolean> | null = null;
  useViewStore.getState().requestGuarded(() => {
    navigation = selectChapterBlock(chapterId, resolve);
  });
  return navigation === null ? true : await navigation;
}

function resolveBlockLocator(
  locator: SourceLocator,
  blocks: Block[],
): Block | null {
  return resolveSnapshotBlock(
    {
      id: "proposal-navigation",
      kind: "block",
      chapterId: "proposal-navigation",
      sourceId: locator.sourceId,
      order: locator.order,
      sourceType: locator.sourceType,
      label: locator.label,
      exactText: locator.exactText,
      sourceFingerprint: locator.fingerprint,
    },
    blocks,
  );
}

function manuscriptLocator(
  change: ManuscriptPendingChange,
): SourceLocator | null {
  const precondition = change.precondition;
  if (precondition.kind === "target" || precondition.kind === "move") {
    return precondition.target;
  }
  return precondition.anchor ?? precondition.expectedNext;
}

function resolveCardLocator(locator: SourceLocator, cards: Card[]): Card | null {
  const exact = cards.find((card) => card.id === locator.sourceId);
  if (exact !== undefined) return exact;
  const atOrder = cards[locator.order];
  return atOrder !== undefined &&
    cardFingerprint(atOrder) === locator.fingerprint
    ? atOrder
    : null;
}

function outlineLocator(change: OutlinePendingChange): SourceLocator | null {
  const precondition = change.precondition;
  return precondition.kind === "outline-order" ? null : precondition.target;
}

function navigateToOutlineCard(
  chapterId: string,
  locator: SourceLocator | null,
): boolean {
  const projectState = useProjectStore.getState();
  if (
    projectState.project === null ||
    !projectState.project.chapters.some((chapter) => chapter.id === chapterId)
  ) {
    return false;
  }
  const chapter = projectState.meta.chapters[chapterId];
  if (chapter === undefined) return false;
  const card = locator === null ? null : resolveCardLocator(locator, chapter.cards);
  if (locator !== null && card === null) return false;

  useViewStore.getState().openOutline();
  const board = useOutlineBoardStore.getState();
  board.closeChapter();
  board.highlightCard(card?.id ?? null);
  if (card !== null) scheduleScroll("data-outline-card-id", card.id);
  return true;
}

function findingBlockIds(snapshot: ContextSnapshot): string[] | null {
  for (const message of useAgentConsoleStore.getState().messages) {
    const found = flattenMessageFindings(message).find(
      (item) => item.id === snapshot.sourceId,
    );
    if (found === undefined || found.chapterId !== snapshot.chapterId) continue;
    if (findingFingerprint(found.finding) !== snapshot.sourceFingerprint) {
      return null;
    }
    return found.finding.blockIds;
  }
  return null;
}

export async function navigateToContextSnapshot(
  snapshot: ContextSnapshot,
): Promise<boolean> {
  if (snapshot.kind === "block") {
    return navigateToBlock(snapshot.chapterId, (blocks) =>
      resolveSnapshotBlock(snapshot, blocks),
    );
  }
  if (snapshot.kind === "outline-card") {
    return navigateToOutlineCard(snapshot.chapterId, {
      sourceId: snapshot.sourceId,
      order: snapshot.order,
      fingerprint: snapshot.sourceFingerprint,
      sourceType: snapshot.sourceType,
      label: snapshot.label,
      exactText: snapshot.exactText,
    });
  }
  const blockIds = findingBlockIds(snapshot);
  if (blockIds === null || blockIds.length === 0) return false;
  return navigateToBlock(snapshot.chapterId, (blocks) => {
    for (const blockId of blockIds) {
      const block = blocks.find((item) => item.id === blockId);
      if (block !== undefined) return block;
    }
    return null;
  });
}

export async function navigateToProposalChange(
  chapterId: string,
  change: ManuscriptPendingChange | OutlinePendingChange,
): Promise<boolean> {
  if (isManuscriptChange(change)) {
    const locator = manuscriptLocator(change);
    if (locator === null) return false;
    return navigateToBlock(chapterId, (blocks) =>
      resolveBlockLocator(locator, blocks),
    );
  }
  return navigateToOutlineCard(
    chapterId,
    outlineLocator(change),
  );
}

function isManuscriptChange(
  change: ManuscriptPendingChange | OutlinePendingChange,
): change is ManuscriptPendingChange {
  return "afterId" in change.change;
}
