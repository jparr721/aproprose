import {
  IconCheck,
  IconMapPin,
  IconX,
} from "@tabler/icons-react";
import { AgentDiffPreview } from "@/components/app/agent-console/diff-preview";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  TypographyEyebrow,
  TypographyMuted,
  TypographyP,
} from "@/components/ui/typography";
import {
  blockSnapshotText,
  resolveLiveBlockLocator,
} from "@/lib/ai/agent-context";
import type {
  ManuscriptPendingChange,
  ManuscriptPendingProposal,
  SourceLocator,
} from "@/lib/ai/agent-types";
import type { Block } from "@/lib/types";
import { useProjectStore } from "@/stores/project-store";

export interface ManuscriptReviewProps {
  proposal: ManuscriptPendingProposal;
  staleChangeIds: Set<string>;
  disabled: boolean;
  onAccept: (changeId: string) => void;
  onReject: (changeId: string) => void;
  onNavigate: (changeId: string) => void;
}

function requiredText(value: string | null, field: string): string {
  if (value === null) {
    throw new Error(`Manuscript proposal ${field} is required.`);
  }
  return value;
}

interface BlockDisplay {
  sourceId: string;
  label: string;
  previewText: string;
  mutableText: string;
}

type ResolveBlockDisplay = (locator: SourceLocator) => BlockDisplay;

function requiredTargetLocator(
  change: ManuscriptPendingChange,
): SourceLocator {
  const precondition = change.precondition;
  if (precondition.kind === "target" || precondition.kind === "move") {
    return precondition.target;
  }
  throw new Error("A manuscript proposal target is required.");
}

function frozenBlockDisplay(locator: SourceLocator): BlockDisplay {
  return {
    sourceId: locator.sourceId,
    label: locator.label,
    previewText: locator.previewText,
    mutableText: locator.exactText,
  };
}

function liveBlockDisplay(
  locator: SourceLocator,
  blocks: Block[],
): BlockDisplay {
  const block = resolveLiveBlockLocator(locator, blocks);
  if (block === null) {
    throw new Error(`Live manuscript source could not be resolved: ${locator.sourceId}`);
  }
  return displayLiveBlock(block, blocks);
}

function displayLiveBlock(block: Block, blocks: Block[]): BlockDisplay {
  const order = blocks.findIndex((item) => item.id === block.id);
  if (order < 0) {
    throw new Error(`Live manuscript source is outside the chapter: ${block.id}`);
  }
  const typeLabel =
    block.type.charAt(0).toUpperCase() + block.type.slice(1);
  return {
    sourceId: block.id,
    label: `${typeLabel} block ${order + 1}`,
    previewText: blockSnapshotText(block),
    mutableText: block.text,
  };
}

function insertLocation(
  change: ManuscriptPendingChange,
  resolveDisplay: ResolveBlockDisplay,
): BlockDisplay | null {
  if (change.precondition.kind !== "insert") {
    throw new Error("An insert proposal requires an insert precondition.");
  }
  if (change.precondition.anchor !== null) {
    const anchor = resolveDisplay(change.precondition.anchor);
    return { ...anchor, label: `After ${anchor.label}` };
  }
  if (change.precondition.expectedNext !== null) {
    const next = resolveDisplay(change.precondition.expectedNext);
    return { ...next, label: `Before ${next.label}` };
  }
  return null;
}

function changeTitle(
  change: ManuscriptPendingChange,
  resolveDisplay: ResolveBlockDisplay,
): string {
  if (change.change.kind === "insert") {
    return insertLocation(change, resolveDisplay)?.label ?? "End of chapter";
  }
  return resolveDisplay(requiredTargetLocator(change)).label;
}

function ManuscriptPreview(props: {
  change: ManuscriptPendingChange;
  liveBlocks: Block[] | null;
  resolveDisplay: ResolveBlockDisplay;
}) {
  const { change, liveBlocks, resolveDisplay } = props;
  const proposalChange = change.change;
  if (proposalChange.kind === "rewrite") {
    const source = resolveDisplay(requiredTargetLocator(change));
    return (
      <AgentDiffPreview
        after={requiredText(proposalChange.newText, "rewrite text")}
        before={source.mutableText}
      />
    );
  }
  if (proposalChange.kind === "insert") {
    if (change.precondition.kind !== "insert") {
      throw new Error("An insert proposal requires an insert precondition.");
    }
    const location = insertLocation(change, resolveDisplay);
    const rightBoundary =
      change.precondition.anchor === null ||
      change.precondition.expectedNext === null
        ? null
        : resolveDisplay(change.precondition.expectedNext);
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <TypographyEyebrow>Location</TypographyEyebrow>
          <TypographyMuted>{location?.label ?? "End of chapter"}</TypographyMuted>
          {location === null ? null : (
            <TypographyP className="whitespace-pre-wrap">
              {location.previewText}
            </TypographyP>
          )}
        </div>
        {rightBoundary === null ? null : (
          <div className="flex flex-col gap-1">
            <TypographyEyebrow>Right boundary</TypographyEyebrow>
            <TypographyMuted>Before {rightBoundary.label}</TypographyMuted>
            <TypographyP className="whitespace-pre-wrap">
              {rightBoundary.previewText}
            </TypographyP>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <TypographyEyebrow>Proposed prose</TypographyEyebrow>
          <TypographyP className="whitespace-pre-wrap">
            {requiredText(proposalChange.newText, "insert text")}
          </TypographyP>
        </div>
      </div>
    );
  }
  const source = resolveDisplay(requiredTargetLocator(change));
  if (proposalChange.kind === "remove") {
    return (
      <TypographyP className="whitespace-pre-wrap">
        {source.previewText}
      </TypographyP>
    );
  }
  if (proposalChange.toIndex === null) {
    throw new Error("A move proposal destination is required.");
  }
  if (change.precondition.kind !== "move") {
    throw new Error("A move proposal requires a move precondition.");
  }
  const destination = (() => {
    if (liveBlocks === null) return null;
    const remaining = liveBlocks.filter((block) => block.id !== source.sourceId);
    const toIndex = Math.max(
      0,
      Math.min(proposalChange.toIndex, remaining.length),
    );
    const block = remaining[toIndex];
    if (block === undefined) return null;
    return displayLiveBlock(block, liveBlocks);
  })();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <TypographyEyebrow>Source</TypographyEyebrow>
        <TypographyP className="whitespace-pre-wrap">
          {source.previewText}
        </TypographyP>
      </div>
      <div className="flex flex-col gap-1">
        <TypographyEyebrow>Destination</TypographyEyebrow>
        <TypographyMuted>
          {liveBlocks === null
            ? `Position ${proposalChange.toIndex + 1}`
            : destination === null
              ? "End of chapter"
              : `Before ${destination.label}`}
        </TypographyMuted>
        {destination === null ? null : (
          <TypographyP className="whitespace-pre-wrap">
            {destination.previewText}
          </TypographyP>
        )}
      </div>
    </div>
  );
}

function ManuscriptChangeCard(props: {
  blocks: Block[];
  change: ManuscriptPendingChange;
  stale: boolean;
  disabled: boolean;
  onAccept: (changeId: string) => void;
  onReject: (changeId: string) => void;
  onNavigate: (changeId: string) => void;
}) {
  const {
    blocks,
    change,
    stale,
    disabled,
    onAccept,
    onReject,
    onNavigate,
  } = props;
  const resolveDisplay: ResolveBlockDisplay = stale
    ? frozenBlockDisplay
    : (locator) => liveBlockDisplay(locator, blocks);
  return (
    <Card data-agent-change-id={change.id} size="sm">
      <CardHeader>
        <div className="flex flex-col gap-1">
          <TypographyEyebrow>{change.change.kind}</TypographyEyebrow>
          <CardTitle>{changeTitle(change, resolveDisplay)}</CardTitle>
        </div>
        <CardAction>
          <Button
            aria-label="Read in context"
            onClick={() => onNavigate(change.id)}
            size="sm"
            variant="ghost"
          >
            <IconMapPin data-icon="inline-start" />
            Read in context
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ManuscriptPreview
          change={change}
          liveBlocks={stale ? null : blocks}
          resolveDisplay={resolveDisplay}
        />
        <div className="flex flex-col gap-1">
          <TypographyEyebrow>Reason</TypographyEyebrow>
          <TypographyMuted>{change.change.reason}</TypographyMuted>
        </div>
        {stale ? (
          <TypographyMuted className="text-destructive">
            Source changed - regenerate
          </TypographyMuted>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          <Button
            disabled={disabled || stale}
            onClick={() => onAccept(change.id)}
            size="sm"
          >
            <IconCheck data-icon="inline-start" />
            Accept
          </Button>
          <Button
            disabled={disabled}
            onClick={() => onReject(change.id)}
            size="sm"
            variant="outline"
          >
            <IconX data-icon="inline-start" />
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ManuscriptReview({
  proposal,
  staleChangeIds,
  disabled,
  onAccept,
  onReject,
  onNavigate,
}: ManuscriptReviewProps) {
  const blocks = useProjectStore((state) => state.blocks);
  return (
    <div className="flex flex-col gap-3">
      {proposal.changes.map((change) => (
        <ManuscriptChangeCard
          blocks={blocks}
          change={change}
          disabled={disabled}
          key={change.id}
          onAccept={onAccept}
          onNavigate={onNavigate}
          onReject={onReject}
          stale={staleChangeIds.has(change.id)}
        />
      ))}
    </div>
  );
}
