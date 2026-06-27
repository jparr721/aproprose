// premise-card.tsx -- the pinned one-line logline at the top of the Outline.

import { useProjectStore } from "@/stores/project-store";
import { Card, CardContent } from "@/components/ui/card";
import { TypographyEyebrow } from "@/components/ui/typography";
import { InlineEdit } from "@/components/app/outline/inline-edit";

export function PremiseCard() {
  const premise = useProjectStore((s) => s.meta.outline.premise);
  const setPremise = useProjectStore((s) => s.setPremise);

  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1.5">
        <TypographyEyebrow>Premise</TypographyEyebrow>
        <InlineEdit
          value={premise}
          onCommit={setPremise}
          placeholder="One sentence: who wants what, and what stands in the way."
          multiline={false}
          className="text-sm leading-snug"
        />
      </CardContent>
    </Card>
  );
}
