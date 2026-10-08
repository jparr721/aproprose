import type { ReactNode } from "react";
import { TypographyEyebrow, TypographyMutedSpan } from "@/components/ui/typography";

export function Field({
  label,
  hint,
  action,
  children,
}: {
  label: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <TypographyEyebrow>{label}</TypographyEyebrow>
        <div className="flex shrink-0 items-center gap-2">
          {hint ? (
            <TypographyMutedSpan className="text-xs tabular-nums">{hint}</TypographyMutedSpan>
          ) : null}
          {action}
        </div>
      </div>
      {children}
    </div>
  );
}
