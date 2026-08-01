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
  cardSnapshotText,
  resolveLiveCardLocator,
} from "@/lib/ai/agent-context";
import type {
  OutlinePendingChange,
  OutlinePendingProposal,
  SourceLocator,
} from "@/lib/ai/agent-types";
import { getChapterOutline } from "@/lib/outline/model";
import type { Card as OutlineCard } from "@/lib/types";
import { useProjectStore } from "@/stores/project-store";

export interface OutlineReviewProps {
  proposal: OutlinePendingProposal;
  staleChangeIds: Set<string>;
  onAccept: (changeId: string) => void;
  onReject: (changeId: string) => void;
  onNavigate: (changeId: string) => void;
}

interface CardDisplay {
  sourceId: string;
  title: string;
  intention: string;
  mutableText: string;
}

type ResolveCardDisplay = (locator: SourceLocator) => CardDisplay;

function requiredTargetLocator(change: OutlinePendingChange): SourceLocator {
  const precondition = change.precondition;
  if (precondition.kind === "outline-order") {
    throw new Error("An outline proposal target is required.");
  }
  return precondition.target;
}

function changeTitle(
  change: OutlinePendingChange,
  resolveDisplay: ResolveCardDisplay,
): string {
  if (change.change.kind === "add") return "New outline card";
  return resolveDisplay(requiredTargetLocator(change)).title;
}

function frozenCardDisplay(locator: SourceLocator): CardDisplay {
  const separator = locator.previewText.indexOf("\n");
  const title =
    separator < 0 ? locator.previewText : locator.previewText.slice(0, separator);
  const intention =
    separator < 0 ? "" : locator.previewText.slice(separator + 1);
  return {
    sourceId: locator.sourceId,
    title,
    intention,
    mutableText: locator.exactText,
  };
}

function displayLiveCard(card: OutlineCard): CardDisplay {
  return {
    sourceId: card.id,
    title: card.title,
    intention: card.intention,
    mutableText: cardSnapshotText(card),
  };
}

function liveCardDisplay(
  locator: SourceLocator,
  cards: OutlineCard[],
): CardDisplay {
  const card = resolveLiveCardLocator(locator, cards);
  if (card === null) {
    throw new Error(`Live outline source could not be resolved: ${locator.sourceId}`);
  }
  return displayLiveCard(card);
}

function OutlinePreview(props: {
  cards: OutlineCard[] | null;
  change: OutlinePendingChange;
  resolveDisplay: ResolveCardDisplay;
}) {
  const { cards, change, resolveDisplay } = props;
  const proposalChange = change.change;
  if (proposalChange.kind === "rewrite") {
    const source = resolveDisplay(requiredTargetLocator(change));
    const nextTitle = proposalChange.title ?? source.title;
    const nextIntention = proposalChange.intention ?? source.intention;
    return (
      <AgentDiffPreview
        after={`${nextTitle}\n${nextIntention}`}
        before={source.mutableText}
      />
    );
  }
  if (proposalChange.kind === "add") {
    if (change.precondition.kind !== "outline-order") {
      throw new Error("An outline add proposal requires an order precondition.");
    }
    const destination =
      cards === null || cards.length === 0
        ? null
        : displayLiveCard(cards[cards.length - 1]);
    return (
      <div className="flex flex-col gap-2">
        {proposalChange.title === null ? null : (
          <TypographyP>{proposalChange.title}</TypographyP>
        )}
        {proposalChange.intention === null ? null : (
          <TypographyMuted>{proposalChange.intention}</TypographyMuted>
        )}
        <div className="flex flex-col gap-1">
          <TypographyEyebrow>Destination</TypographyEyebrow>
          <TypographyMuted>
            {cards === null
              ? "End of outline"
              : destination === null
                ? "Start of outline"
                : `After ${destination.title}`}
          </TypographyMuted>
          {destination === null ? null : (
            <TypographyMuted>{destination.intention}</TypographyMuted>
          )}
        </div>
      </div>
    );
  }
  const source = resolveDisplay(requiredTargetLocator(change));
  if (proposalChange.kind === "remove") {
    return (
      <div className="flex flex-col gap-1">
        <TypographyP>{source.title}</TypographyP>
        <TypographyMuted>{source.intention}</TypographyMuted>
      </div>
    );
  }
  if (proposalChange.toIndex === null) {
    throw new Error("An outline move destination is required.");
  }
  if (change.precondition.kind !== "outline-move") {
    throw new Error("An outline move proposal requires a move precondition.");
  }
  const destination = (() => {
    if (cards === null) return null;
    const remaining = cards.filter((card) => card.id !== source.sourceId);
    const toIndex = Math.max(
      0,
      Math.min(proposalChange.toIndex, remaining.length),
    );
    const card = remaining[toIndex];
    return card === undefined ? null : displayLiveCard(card);
  })();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <TypographyEyebrow>Source</TypographyEyebrow>
        <TypographyP>{source.title}</TypographyP>
        <TypographyMuted>{source.intention}</TypographyMuted>
      </div>
      <div className="flex flex-col gap-1">
        <TypographyEyebrow>Destination</TypographyEyebrow>
        <TypographyMuted>
          {cards === null
            ? `Position ${proposalChange.toIndex + 1}`
            : destination === null
              ? "End of outline"
              : `Before ${destination.title}`}
        </TypographyMuted>
        {destination === null ? null : (
          <TypographyMuted>{destination.intention}</TypographyMuted>
        )}
      </div>
    </div>
  );
}

function OutlineChangeCard(props: {
  cards: OutlineCard[] | null;
  change: OutlinePendingChange;
  stale: boolean;
  onAccept: (changeId: string) => void;
  onReject: (changeId: string) => void;
  onNavigate: (changeId: string) => void;
}) {
  const { cards, change, stale, onAccept, onReject, onNavigate } = props;
  if (!stale && cards === null) {
    throw new Error("Live outline chapter could not be resolved.");
  }
  const resolveDisplay: ResolveCardDisplay = stale
    ? frozenCardDisplay
    : (locator) => {
        if (cards === null) {
          throw new Error("Live outline chapter could not be resolved.");
        }
        return liveCardDisplay(locator, cards);
      };
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
        <OutlinePreview
          cards={stale ? null : cards}
          change={change}
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
            disabled={stale}
            onClick={() => onAccept(change.id)}
            size="sm"
          >
            <IconCheck data-icon="inline-start" />
            Accept
          </Button>
          <Button
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

export function OutlineReview({
  proposal,
  staleChangeIds,
  onAccept,
  onReject,
  onNavigate,
}: OutlineReviewProps) {
  const cards = useProjectStore((state) => {
    if (
      state.project === null ||
      state.project.root !== proposal.projectRoot ||
      !state.project.chapters.some(
        (chapter) => chapter.id === proposal.chapterId,
      )
    ) {
      return null;
    }
    return getChapterOutline(state.meta.chapters, proposal.chapterId).cards;
  });
  return (
    <div className="flex flex-col gap-3">
      {proposal.changes.map((change) => (
        <OutlineChangeCard
          cards={cards}
          change={change}
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
