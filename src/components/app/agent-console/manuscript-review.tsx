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
  ManuscriptPendingChange,
  ManuscriptPendingProposal,
  SourceLocator,
} from "@/lib/ai/agent-types";
import { diffWords } from "@/lib/diff/word-diff";

export interface ManuscriptReviewProps {
  proposal: ManuscriptPendingProposal;
  staleChangeIds: Set<string>;
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

function targetLocator(change: ManuscriptPendingChange): SourceLocator | null {
  const precondition = change.precondition;
  if (precondition.kind === "target" || precondition.kind === "move") {
    return precondition.target;
  }
  return precondition.anchor ?? precondition.expectedNext;
}

function changeTitle(change: ManuscriptPendingChange): string {
  const locator = targetLocator(change);
  if (change.change.kind === "insert") {
    if (change.precondition.kind !== "insert") {
      throw new Error("An insert proposal requires an insert precondition.");
    }
    if (change.precondition.anchor !== null) {
      return `After ${change.precondition.anchor.label}`;
    }
    if (change.precondition.expectedNext !== null) {
      return `Before ${change.precondition.expectedNext.label}`;
    }
    return "End of chapter";
  }
  if (locator === null) {
    throw new Error("A manuscript proposal target is required.");
  }
  return locator.label;
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

function ManuscriptPreview(props: { change: ManuscriptPendingChange }) {
  const { change } = props;
  const proposalChange = change.change;
  if (proposalChange.kind === "rewrite") {
    const locator = targetLocator(change);
    if (locator === null) {
      throw new Error("A rewrite proposal target is required.");
    }
    return (
      <DiffPreview
        after={requiredText(proposalChange.newText, "rewrite text")}
        before={locator.exactText}
      />
    );
  }
  if (proposalChange.kind === "insert") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <TypographyEyebrow>Location</TypographyEyebrow>
          <TypographyMuted>{changeTitle(change)}</TypographyMuted>
        </div>
        <div className="flex flex-col gap-1">
          <TypographyEyebrow>Proposed prose</TypographyEyebrow>
          <TypographyP className="whitespace-pre-wrap">
            {requiredText(proposalChange.newText, "insert text")}
          </TypographyP>
        </div>
      </div>
    );
  }
  const locator = targetLocator(change);
  if (locator === null) {
    throw new Error("A manuscript proposal target is required.");
  }
  if (proposalChange.kind === "remove") {
    return (
      <TypographyP className="whitespace-pre-wrap">
        {locator.exactText}
      </TypographyP>
    );
  }
  if (proposalChange.toIndex === null) {
    throw new Error("A move proposal destination is required.");
  }
  return (
    <div className="flex flex-col gap-2">
      <TypographyP className="whitespace-pre-wrap">
        {locator.exactText}
      </TypographyP>
      <TypographyMuted>
        Move to position {proposalChange.toIndex + 1}
      </TypographyMuted>
    </div>
  );
}

function ManuscriptChangeCard(props: {
  change: ManuscriptPendingChange;
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
        <ManuscriptPreview change={change} />
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

export function ManuscriptReview({
  proposal,
  staleChangeIds,
  onAccept,
  onReject,
  onNavigate,
}: ManuscriptReviewProps) {
  return (
    <div className="flex flex-col gap-3">
      {proposal.changes.map((change) => (
        <ManuscriptChangeCard
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
