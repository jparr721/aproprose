// premise-card.tsx -- the pinned one-line logline at the top of the Outline.

import { useProjectStore } from "@/stores/project-store";
import { TypographyEyebrow } from "@/components/ui/typography";
import { InlineEdit } from "@/components/app/outline/inline-edit";

export function PremiseCard() {
  const premise = useProjectStore((s) => s.meta.outline.premise);
  const setPremise = useProjectStore((s) => s.setPremise);

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <TypographyEyebrow className="mb-1.5 block text-muted-foreground">
        Premise
      </TypographyEyebrow>
      <InlineEdit
        value={premise}
        onCommit={setPremise}
        placeholder="One sentence: who wants what, and what stands in the way."
        multiline={false}
        className="font-heading text-sm italic leading-snug text-foreground/85"
      />
    </div>
  );
}
