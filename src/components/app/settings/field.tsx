import type { ReactNode } from "react";
import { TypographyEyebrow, TypographyMutedSpan } from "@/components/ui/typography";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <TypographyEyebrow>{label}</TypographyEyebrow>
        {hint ? (
          <TypographyMutedSpan className="text-xs tabular-nums">{hint}</TypographyMutedSpan>
        ) : null}
      </div>
      {children}
    </div>
  );
}
