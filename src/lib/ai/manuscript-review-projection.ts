import {
  materializeManuscriptChanges,
  validateManuscriptChanges,
} from "@/lib/ai/agent-proposals";
import type {
  ManuscriptPendingChange,
  ManuscriptPendingProposal,
  SourceLocator,
} from "@/lib/ai/agent-types";
import type { Block, BlockChange } from "@/lib/types";

export interface ManuscriptUnchangedRow {
  kind: "unchanged";
  key: string;
  block: Block;
}

export interface ManuscriptRewriteRow {
  kind: "rewrite";
  key: string;
  changeId: string;
  source: Block;
  beforeText: string;
  change: ManuscriptPendingChange;
}

export interface ManuscriptInsertRow {
  kind: "insert";
  key: string;
  changeId: string;
  afterId: string | null;
  change: ManuscriptPendingChange;
}

export interface ManuscriptRemoveRow {
  kind: "remove";
  key: string;
  changeId: string;
  source: Block;
  change: ManuscriptPendingChange;
}

export interface ManuscriptMoveSourceRow {
  kind: "move-source";
  key: string;
  changeId: string;
  source: Block;
  change: ManuscriptPendingChange;
}

export interface ManuscriptMoveDestinationRow {
  kind: "move-destination";
  key: string;
  changeId: string;
  source: Block;
  destinationIndex: number;
  change: ManuscriptPendingChange;
}

export interface ManuscriptStaleRow {
  kind: "stale";
  key: string;
  changeId: string;
  sourceType: string;
  frozenText: string;
  frozenOrder: number;
  change: ManuscriptPendingChange;
}

export type ManuscriptReviewRow =
  | ManuscriptUnchangedRow
  | ManuscriptRewriteRow
  | ManuscriptInsertRow
  | ManuscriptRemoveRow
  | ManuscriptMoveSourceRow
  | ManuscriptMoveDestinationRow
  | ManuscriptStaleRow;

export interface ManuscriptReviewProjection {
  rows: ManuscriptReviewRow[];
  navigationChangeIds: string[];
  staleChangeIds: Set<string>;
}

interface LiveContentNode {
  kind: "live";
  block: Block;
  originalOrder: number;
}

interface RewriteContentNode {
  kind: "rewrite";
  source: Block;
  beforeText: string;
  change: ManuscriptPendingChange;
  originalOrder: number;
}

interface InsertContentNode {
  kind: "insert";
  afterId: string | null;
  change: ManuscriptPendingChange;
}

interface MoveDestinationContentNode {
  kind: "move-destination";
  source: Block;
  destinationIndex: number;
  change: ManuscriptPendingChange;
}

type VirtualContentNode =
  | LiveContentNode
  | RewriteContentNode
  | InsertContentNode
  | MoveDestinationContentNode;

interface RemoveSourceAnnotation {
  kind: "remove";
  source: Block;
  change: ManuscriptPendingChange;
  originalOrder: number;
}

interface MoveSourceAnnotation {
  kind: "move-source";
  source: Block;
  change: ManuscriptPendingChange;
  originalOrder: number;
}

interface StaleAnnotation {
  kind: "stale";
  sourceType: string;
  frozenText: string;
  frozenOrder: number;
  change: ManuscriptPendingChange;
}

type SourceAnnotation =
  | RemoveSourceAnnotation
  | MoveSourceAnnotation
  | StaleAnnotation;

type LayoutNode = VirtualContentNode | SourceAnnotation;
type ChangedRowKind = Exclude<ManuscriptReviewRow["kind"], "unchanged">;

function assertNever(value: never): never {
  throw new Error(`Unhandled manuscript review value: ${JSON.stringify(value)}`);
}

function insertAt<T>(values: T[], index: number, value: T): T[] {
  return [...values.slice(0, index), value, ...values.slice(index)];
}

function replaceAt<T>(values: T[], index: number, value: T): T[] {
  return values.map((item, itemIndex) => (itemIndex === index ? value : item));
}

function removeAt<T>(values: T[], index: number): T[] {
  return values.filter((_, itemIndex) => itemIndex !== index);
}

function targetLocator(change: ManuscriptPendingChange): SourceLocator {
  const precondition = change.precondition;
  switch (precondition.kind) {
    case "target":
    case "move":
      return precondition.target;
    case "insert":
      throw new Error(`Manuscript change ${change.id} requires a target locator.`);
    default:
      return assertNever(precondition);
  }
}

function staleLocator(change: ManuscriptPendingChange): SourceLocator {
  const precondition = change.precondition;
  switch (precondition.kind) {
    case "target":
    case "move":
      return precondition.target;
    case "insert": {
      if (precondition.anchor !== null) return precondition.anchor;
      if (precondition.expectedNext !== null) return precondition.expectedNext;
      throw new Error(`Stale insert ${change.id} has no frozen locator.`);
    }
    default:
      return assertNever(precondition);
  }
}

function persistedBlockId(node: VirtualContentNode): string | null {
  switch (node.kind) {
    case "live":
      return node.block.id;
    case "rewrite":
    case "move-destination":
      return node.source.id;
    case "insert":
      return null;
    default:
      return assertNever(node);
  }
}

function originalOrder(node: LayoutNode): number | null {
  switch (node.kind) {
    case "live":
    case "rewrite":
    case "remove":
    case "move-source":
      return node.originalOrder;
    case "insert":
    case "move-destination":
    case "stale":
      return null;
    default:
      return assertNever(node);
  }
}

function requiredOriginalOrder(node: VirtualContentNode): number {
  switch (node.kind) {
    case "live":
    case "rewrite":
      return node.originalOrder;
    case "insert":
    case "move-destination":
      throw new Error("A proposal cannot structurally change view-only content.");
    default:
      return assertNever(node);
  }
}

function requiredBlockId(change: BlockChange): string {
  if (change.blockId === null) {
    throw new Error(`Materialized ${change.kind} change requires a block id.`);
  }
  return change.blockId;
}

function requiredMoveIndex(change: BlockChange): number {
  if (change.toIndex === null) {
    throw new Error("A materialized move change requires a destination index.");
  }
  return change.toIndex;
}

function sourceBlock(blocks: Block[], blockId: string): Block {
  const source = blocks.find((block) => block.id === blockId);
  if (source === undefined) {
    throw new Error(`Materialized manuscript source is missing: ${blockId}`);
  }
  return source;
}

function sourceContentIndex(
  content: VirtualContentNode[],
  blockId: string,
): number {
  const index = content.findIndex((node) => persistedBlockId(node) === blockId);
  if (index < 0) {
    throw new Error(`Virtual manuscript source is missing: ${blockId}`);
  }
  return index;
}

function layoutNodeIndex(layout: LayoutNode[], node: LayoutNode): number {
  const index = layout.indexOf(node);
  if (index < 0) {
    throw new Error("Virtual manuscript layout lost a content node.");
  }
  return index;
}

function changedKey(changeId: string, kind: ChangedRowKind): string {
  return `review:change:${changeId}:${kind}`;
}

function toReviewRow(node: LayoutNode): ManuscriptReviewRow {
  switch (node.kind) {
    case "live":
      return {
        kind: "unchanged",
        key: `review:block:${node.block.id}`,
        block: node.block,
      };
    case "rewrite":
      return {
        kind: "rewrite",
        key: changedKey(node.change.id, "rewrite"),
        changeId: node.change.id,
        source: node.source,
        beforeText: node.beforeText,
        change: node.change,
      };
    case "insert":
      return {
        kind: "insert",
        key: changedKey(node.change.id, "insert"),
        changeId: node.change.id,
        afterId: node.afterId,
        change: node.change,
      };
    case "remove":
      return {
        kind: "remove",
        key: changedKey(node.change.id, "remove"),
        changeId: node.change.id,
        source: node.source,
        change: node.change,
      };
    case "move-source":
      return {
        kind: "move-source",
        key: changedKey(node.change.id, "move-source"),
        changeId: node.change.id,
        source: node.source,
        change: node.change,
      };
    case "move-destination":
      return {
        kind: "move-destination",
        key: changedKey(node.change.id, "move-destination"),
        changeId: node.change.id,
        source: node.source,
        destinationIndex: node.destinationIndex,
        change: node.change,
      };
    case "stale":
      return {
        kind: "stale",
        key: changedKey(node.change.id, "stale"),
        changeId: node.change.id,
        sourceType: node.sourceType,
        frozenText: node.frozenText,
        frozenOrder: node.frozenOrder,
        change: node.change,
      };
    default:
      return assertNever(node);
  }
}

function navigationChangeId(row: ManuscriptReviewRow): string | null {
  switch (row.kind) {
    case "rewrite":
    case "insert":
    case "remove":
    case "move-destination":
    case "stale":
      return row.changeId;
    case "unchanged":
    case "move-source":
      return null;
    default:
      return assertNever(row);
  }
}

function validateNavigation(
  navigationChangeIds: string[],
  proposal: ManuscriptPendingProposal,
): void {
  const uniqueIds = new Set(navigationChangeIds);
  if (
    navigationChangeIds.length !== proposal.changes.length ||
    uniqueIds.size !== proposal.changes.length
  ) {
    throw new Error("Every manuscript proposal change must have one decision row.");
  }
}

function materializedPairs(
  proposal: ManuscriptPendingProposal,
  blocks: Block[],
  staleChangeIds: Set<string>,
): Array<{ pending: ManuscriptPendingChange; materialized: BlockChange }> {
  const pendingChanges = proposal.changes.filter(
    (change) => !staleChangeIds.has(change.id),
  );
  const materialized = materializeManuscriptChanges(
    proposal,
    pendingChanges.map((change) => change.id),
    blocks,
  );
  if (materialized.length !== pendingChanges.length) {
    throw new Error("Materialized manuscript changes lost proposal correlation.");
  }
  return pendingChanges.map((pending, index) => {
    const change = materialized[index];
    if (change === undefined) {
      throw new Error(`Materialized manuscript change is missing: ${pending.id}`);
    }
    return { pending, materialized: change };
  });
}

function appendStaleAnnotations(
  layout: LayoutNode[],
  blocks: Block[],
  proposal: ManuscriptPendingProposal,
  staleChangeIds: Set<string>,
): LayoutNode[] {
  let nextLayout = layout;
  const lastStaleByOrder = new Map<number, StaleAnnotation>();
  for (const change of proposal.changes) {
    if (!staleChangeIds.has(change.id)) continue;
    const locator = staleLocator(change);
    const annotation: StaleAnnotation = {
      kind: "stale",
      sourceType: locator.sourceType,
      frozenText: locator.exactText,
      frozenOrder: locator.order,
      change,
    };
    if (blocks.length === 0) {
      nextLayout = [...nextLayout, annotation];
      continue;
    }
    const placementOrder = Math.max(0, Math.min(locator.order, blocks.length - 1));
    const priorStale = lastStaleByOrder.get(placementOrder);
    const anchor =
      priorStale ??
      nextLayout.find((node) => originalOrder(node) === placementOrder);
    if (anchor === undefined) {
      throw new Error(`Frozen manuscript slot is missing: ${placementOrder}`);
    }
    nextLayout = insertAt(
      nextLayout,
      layoutNodeIndex(nextLayout, anchor) + 1,
      annotation,
    );
    lastStaleByOrder.set(placementOrder, annotation);
  }
  return nextLayout;
}

export function projectManuscriptReview(
  blocks: Block[],
  proposal: ManuscriptPendingProposal,
): ManuscriptReviewProjection {
  const staleChangeIds = new Set(
    validateManuscriptChanges(proposal, blocks).map((change) => change.changeId),
  );
  const initialContent: VirtualContentNode[] = blocks.map(
    (block, originalOrder) => ({
      kind: "live",
      block,
      originalOrder,
    }),
  );
  let virtualContent = initialContent;
  let layout: LayoutNode[] = [...initialContent];
  const lastInsertFor = new Map<string, InsertContentNode>();

  for (const { pending, materialized } of materializedPairs(
    proposal,
    blocks,
    staleChangeIds,
  )) {
    switch (materialized.kind) {
      case "rewrite": {
        const blockId = requiredBlockId(materialized);
        const contentIndex = sourceContentIndex(virtualContent, blockId);
        const current = virtualContent[contentIndex];
        if (current === undefined) {
          throw new Error(`Virtual rewrite source is missing: ${blockId}`);
        }
        const replacement: RewriteContentNode = {
          kind: "rewrite",
          source: sourceBlock(blocks, blockId),
          beforeText: targetLocator(pending).exactText,
          change: pending,
          originalOrder: requiredOriginalOrder(current),
        };
        virtualContent = replaceAt(virtualContent, contentIndex, replacement);
        layout = replaceAt(
          layout,
          layoutNodeIndex(layout, current),
          replacement,
        );
        break;
      }
      case "insert": {
        const node: InsertContentNode = {
          kind: "insert",
          afterId: materialized.afterId,
          change: pending,
        };
        const priorInsert =
          materialized.afterId === null
            ? undefined
            : lastInsertFor.get(materialized.afterId);
        const anchor =
          materialized.afterId === null
            ? undefined
            : priorInsert ??
              virtualContent.find(
                (item) => persistedBlockId(item) === materialized.afterId,
              );
        if (materialized.afterId === null || anchor === undefined) {
          virtualContent = [...virtualContent, node];
          layout = [...layout, node];
        } else {
          virtualContent = insertAt(
            virtualContent,
            virtualContent.indexOf(anchor) + 1,
            node,
          );
          layout = insertAt(layout, layoutNodeIndex(layout, anchor) + 1, node);
        }
        if (materialized.afterId !== null) {
          lastInsertFor.set(materialized.afterId, node);
        }
        break;
      }
      case "remove": {
        const blockId = requiredBlockId(materialized);
        const contentIndex = sourceContentIndex(virtualContent, blockId);
        const current = virtualContent[contentIndex];
        if (current === undefined) {
          throw new Error(`Virtual remove source is missing: ${blockId}`);
        }
        const annotation: RemoveSourceAnnotation = {
          kind: "remove",
          source: sourceBlock(blocks, blockId),
          change: pending,
          originalOrder: requiredOriginalOrder(current),
        };
        virtualContent = removeAt(virtualContent, contentIndex);
        layout = replaceAt(
          layout,
          layoutNodeIndex(layout, current),
          annotation,
        );
        break;
      }
      case "move": {
        const blockId = requiredBlockId(materialized);
        const contentIndex = sourceContentIndex(virtualContent, blockId);
        const current = virtualContent[contentIndex];
        if (current === undefined) {
          throw new Error(`Virtual move source is missing: ${blockId}`);
        }
        const source = sourceBlock(blocks, blockId);
        const annotation: MoveSourceAnnotation = {
          kind: "move-source",
          source,
          change: pending,
          originalOrder: requiredOriginalOrder(current),
        };
        const remaining = removeAt(virtualContent, contentIndex);
        layout = replaceAt(
          layout,
          layoutNodeIndex(layout, current),
          annotation,
        );
        const destinationIndex = Math.max(
          0,
          Math.min(requiredMoveIndex(materialized), remaining.length),
        );
        const destination: MoveDestinationContentNode = {
          kind: "move-destination",
          source,
          destinationIndex,
          change: pending,
        };
        const target = remaining[destinationIndex];
        virtualContent = insertAt(remaining, destinationIndex, destination);
        layout =
          target === undefined
            ? [...layout, destination]
            : insertAt(layout, layoutNodeIndex(layout, target), destination);
        break;
      }
      default:
        assertNever(materialized.kind);
    }
  }

  layout = appendStaleAnnotations(
    layout,
    blocks,
    proposal,
    staleChangeIds,
  );
  const rows = layout.map(toReviewRow);
  const navigationChangeIds = rows.flatMap((row) => {
    const changeId = navigationChangeId(row);
    return changeId === null ? [] : [changeId];
  });
  validateNavigation(navigationChangeIds, proposal);

  return { rows, navigationChangeIds, staleChangeIds };
}
