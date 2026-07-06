// daily-goal-input.tsx - the shared editor for the daily word goal: a number
// input with a "words" unit and a submit button. Reused by the sidebar goal
// widget's popover and the Settings stats tab. Onboarding prefills 500.

import { useEffect, useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

const ONBOARDING_DEFAULT = 500;

export function DailyGoalInput({
  value,
  submitLabel,
  onSubmit,
  className,
}: {
  value: number | null;
  submitLabel: string;
  onSubmit: (goal: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value ?? ONBOARDING_DEFAULT));
  useEffect(() => setDraft(String(value ?? ONBOARDING_DEFAULT)), [value]);

  const parsed = Number.parseInt(draft, 10);
  const valid = Number.isFinite(parsed) && parsed >= 1;
  const submit = () => {
    if (valid) onSubmit(parsed);
  };

  return (
    <InputGroup className={cn("h-8", className)}>
      <InputGroupInput
        type="number"
        inputMode="numeric"
        min={1}
        value={draft}
        aria-label="Daily word goal"
        onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupText>words</InputGroupText>
        <InputGroupButton variant="default" disabled={!valid} onClick={submit}>
          {submitLabel}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
