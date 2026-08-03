import {
  ArrowDown as IconArrowDown,
  ArrowUp as IconArrowUp,
  Check as IconCheck,
  X as IconX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  TypographyEyebrow,
  TypographyMuted,
} from "@/components/ui/typography";

export interface ManuscriptReviewHeaderProps {
  summary: string;
  remaining: number;
  previousDisabled: boolean;
  nextDisabled: boolean;
  acceptAllDisabled: boolean;
  decisionsDisabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClose: () => void;
}

export function ManuscriptReviewHeader({
  summary,
  remaining,
  previousDisabled,
  nextDisabled,
  acceptAllDisabled,
  decisionsDisabled,
  onPrevious,
  onNext,
  onAcceptAll,
  onRejectAll,
  onClose,
}: ManuscriptReviewHeaderProps) {
  return (
    <Card className="sticky top-0 z-10 mb-5" size="sm">
      <CardHeader className="grid-cols-[minmax(0,1fr)_auto] items-center">
        <div className="min-w-0">
          <TypographyEyebrow>Manuscript review</TypographyEyebrow>
          <CardTitle className="truncate">{summary}</CardTitle>
        </div>
        <div className="flex items-center gap-1">
          <Button
            aria-label="Previous change"
            disabled={previousDisabled}
            onClick={onPrevious}
            size="icon-sm"
            variant="ghost"
          >
            <IconArrowUp />
          </Button>
          <Button
            aria-label="Next change"
            disabled={nextDisabled}
            onClick={onNext}
            size="icon-sm"
            variant="ghost"
          >
            <IconArrowDown />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <TypographyMuted className="mr-auto">
          {remaining} {remaining === 1 ? "change" : "changes"}
        </TypographyMuted>
        <Button
          disabled={acceptAllDisabled}
          onClick={onAcceptAll}
          size="sm"
        >
          <IconCheck data-icon="inline-start" />
          Accept All
        </Button>
        <Button
          disabled={decisionsDisabled}
          onClick={onRejectAll}
          size="sm"
          variant="outline"
        >
          <IconX data-icon="inline-start" />
          Reject All
        </Button>
        <Button onClick={onClose} size="sm" variant="ghost">
          <IconX data-icon="inline-start" />
          Close Review
        </Button>
      </CardContent>
    </Card>
  );
}
