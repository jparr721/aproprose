import {
  IconCheck,
  IconMapPin,
  IconX,
} from "@tabler/icons-react";
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
import type {
  OutlinePendingChange,
  OutlinePendingProposal,
  SourceLocator,
} from "@/lib/ai/agent-types";
import { diffWords } from "@/lib/diff/word-diff";

export interface OutlineReviewProps {
  proposal: OutlinePendingProposal;
  staleChangeIds: Set<string>;
  onAccept: (changeId: string) => void;
  onReject: (changeId: string) => void;
  onNavigate: (changeId: string) => void;
}

function targetLocator(change: OutlinePendingChange): SourceLocator | null {
  const precondition = change.precondition;
  return precondition.kind === "outline-order" ? null : precondition.target;
}

function changeTitle(change: OutlinePendingChange): string {
  const target = targetLocator(change);
  if (change.change.kind === "add") return "New outline card";
  if (target === null) {
    throw new Error("An outline proposal target is required.");
  }
  return target.label;
}

function frozenCardText(locator: SourceLocator): {
  title: string;
  intention: string;
} {
  const separator = locator.exactText.indexOf("\n");
  return separator < 0
    ? { title: locator.exactText, intention: "" }
    : {
        title: locator.exactText.slice(0, separator),
        intention: locator.exactText.slice(separator + 1),
      };
}

function DiffPreview(props: { before: string; after: string }) {
  const { before, after } = props;
  return (
    <TypographyP className="whitespace-pre-wrap">
      {diffWords(before, after).map((segment, index) => {
        if (segment.type === "add") {
          return (
            <ins
              className="bg-success/10 text-success-foreground no-underline"
              key={`${segment.type}-${index}`}
            >
              {segment.text}
            </ins>
          );
        }
        if (segment.type === "del") {
          return (
            <del
              className="bg-destructive/10 text-destructive"
              key={`${segment.type}-${index}`}
            >
              {segment.text}
            </del>
          );
        }
        return <span key={`${segment.type}-${index}`}>{segment.text}</span>;
      })}
    </TypographyP>
  );
}

function OutlinePreview(props: { change: OutlinePendingChange }) {
  const { change } = props;
  const proposalChange = change.change;
  const target = targetLocator(change);
  if (proposalChange.kind === "rewrite") {
    if (target === null) {
      throw new Error("An outline rewrite target is required.");
    }
    const frozen = frozenCardText(target);
    const nextTitle = proposalChange.title ?? frozen.title;
    const nextIntention = proposalChange.intention ?? frozen.intention;
    return (
      <DiffPreview
        after={`${nextTitle}\n${nextIntention}`}
        before={target.exactText}
      />
    );
  }
  if (proposalChange.kind === "add") {
    return (
      <div className="flex flex-col gap-2">
        {proposalChange.title === null ? null : (
          <TypographyP>{proposalChange.title}</TypographyP>
        )}
        {proposalChange.intention === null ? null : (
          <TypographyMuted>{proposalChange.intention}</TypographyMuted>
        )}
        <TypographyMuted>
          {proposalChange.toIndex === null
            ? "Add at end"
            : `Add at position ${proposalChange.toIndex + 1}`}
        </TypographyMuted>
      </div>
    );
  }
  if (target === null) {
    throw new Error("An outline proposal target is required.");
  }
  if (proposalChange.kind === "remove") {
    const frozen = frozenCardText(target);
    return (
      <div className="flex flex-col gap-1">
        <TypographyP>{frozen.title}</TypographyP>
        <TypographyMuted>{frozen.intention}</TypographyMuted>
      </div>
    );
  }
  if (proposalChange.toIndex === null) {
    throw new Error("An outline move destination is required.");
  }
  const frozen = frozenCardText(target);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <TypographyP>{frozen.title}</TypographyP>
        <TypographyMuted>{frozen.intention}</TypographyMuted>
      </div>
      <TypographyMuted>
        Move to position {proposalChange.toIndex + 1}
      </TypographyMuted>
    </div>
  );
}

function OutlineChangeCard(props: {
  change: OutlinePendingChange;
  stale: boolean;
  onAccept: (changeId: string) => void;
  onReject: (changeId: string) => void;
  onNavigate: (changeId: string) => void;
}) {
  const { change, stale, onAccept, onReject, onNavigate } = props;
  return (
    <Card data-agent-change-id={change.id} size="sm">
      <CardHeader>
        <div className="flex flex-col gap-1">
          <TypographyEyebrow>{change.change.kind}</TypographyEyebrow>
          <CardTitle>{changeTitle(change)}</CardTitle>
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
        <OutlinePreview change={change} />
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
  return (
    <div className="flex flex-col gap-3">
      {proposal.changes.map((change) => (
        <OutlineChangeCard
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
