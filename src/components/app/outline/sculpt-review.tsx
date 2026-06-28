// sculpt-review.tsx -- full-board overlay that lets the author review, keep, or
// skip each AI-proposed change before committing any writes to the outline.
//
// Returns null when no proposal is pending (self-gating). When a proposal is
// present, covers the board with a scrollable list of ChangeCards, each with a
// ButtonGroup Keep/Skip toggle. Accepting routes only the kept changes through
// store.applySculpt (one meta write). Rejecting closes with zero writes.

import { IconPlus, IconArrowsUpDown, IconPencil, IconTrash } from "@tabler/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  TypographyEyebrow,
  TypographyMuted,
  TypographyP,
} from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import type { SculptChange, SculptChangeKind } from "@/lib/types";
import { useProjectStore } from "@/stores/project-store";
import { useOutlineBoardStore } from "@/stores/outline-board-store";

// Maps each change kind to a display label, a left-border color class (from app
// tokens - no literal colors), and a tabler icon. Card does not consume --tint,
// so we use a border-l accent class built from the app token vars.
const KIND_META: Record<
  SculptChangeKind,
  { label: string; accentClass: string; Icon: typeof IconPlus }
> = {
  rewrite: { label: "Rewrite", accentClass: "border-l-4 border-l-[var(--ai-edge)]", Icon: IconPencil },
  add: { label: "Add", accentClass: "border-l-4 border-l-[var(--lore-edge)]", Icon: IconPlus },
  move: { label: "Move", accentClass: "border-l-4 border-l-[var(--scratch-edge)]", Icon: IconArrowsUpDown },
  remove: { label: "Remove", accentClass: "border-l-4 border-l-destructive", Icon: IconTrash },
};

function ChangeCard({
  change,
  decision,
  onDecision,
}: {
  change: SculptChange;
  decision: "keep" | "skip";
  onDecision: (d: "keep" | "skip") => void;
}) {
  const meta = KIND_META[change.kind];
  const Icon = meta.Icon;
  return (
    <Card className={cn(meta.accentClass, decision === "skip" && "opacity-50")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4" />
          <Badge variant="outline">{meta.label}</Badge>
          {change.title ? <span>{change.title}</span> : null}
        </CardTitle>
        <CardAction>
          <ButtonGroup>
            <Button
              size="sm"
              variant={decision === "keep" ? "default" : "outline"}
              onClick={() => onDecision("keep")}
            >
              Keep
            </Button>
            <Button
              size="sm"
              variant={decision === "skip" ? "default" : "outline"}
              onClick={() => onDecision("skip")}
            >
              Skip
            </Button>
          </ButtonGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {change.intention ? (
          <TypographyP className="text-sm">{change.intention}</TypographyP>
        ) : null}
        <TypographyMuted className="text-xs">{change.reason}</TypographyMuted>
      </CardContent>
    </Card>
  );
}

export function SculptReview() {
  const proposal = useOutlineBoardStore((s) => s.proposal);
  const decisions = useOutlineBoardStore((s) => s.decisions);
  const setDecision = useOutlineBoardStore((s) => s.setDecision);
  const rejectAll = useOutlineBoardStore((s) => s.rejectAll);
  const clearProposal = useOutlineBoardStore((s) => s.clearProposal);
  const sculptingChapterId = useOutlineBoardStore((s) => s.sculptingChapterId);
  const applySculpt = useProjectStore((s) => s.applySculpt);
  const chapterTitle = useProjectStore(
    (s) => s.project?.chapters.find((c) => c.id === sculptingChapterId)?.title ?? "",
  );

  if (!proposal) return null;

  // An absent decision index means "keep" - only explicit "skip" entries exclude a change.
  const decisionFor = (i: number): "keep" | "skip" => decisions[i] ?? "keep";
  const keptIndices = proposal.changes
    .map((_, i) => i)
    .filter((i) => decisionFor(i) === "keep");

  const handleAccept = () => {
    applySculpt(proposal.chapterId, proposal, keptIndices);
    clearProposal();
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background/95 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <TypographyEyebrow>Reshape {chapterTitle}</TypographyEyebrow>
          <TypographyMuted className="text-sm">{proposal.summary}</TypographyMuted>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" onClick={handleAccept}>
            Accept {keptIndices.length} of {proposal.changes.length}
          </Button>
          <Button size="sm" variant="outline" onClick={rejectAll}>
            Reject all
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 p-4">
          {proposal.changes.length === 0 ? (
            <TypographyMuted>This chapter is already tight - no changes proposed.</TypographyMuted>
          ) : (
            proposal.changes.map((change, i) => (
              <ChangeCard
                key={i}
                change={change}
                decision={decisionFor(i)}
                onDecision={(d) => setDecision(i, d)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
