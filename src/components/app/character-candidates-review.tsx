import { useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  TypographyEyebrow,
  TypographyH2,
  TypographyMuted,
} from "@/components/ui/typography";
import { notifyAppError } from "@/lib/notifications";
import type { CharacterCandidate, CharacterProfileField } from "@/lib/types";
import { useProjectStore } from "@/stores/project-store";

const PROFILE_FIELDS: ReadonlyArray<{
  field: CharacterProfileField;
  label: string;
}> = [
  { field: "appearance", label: "Appearance" },
  { field: "mannerisms", label: "Mannerisms" },
  { field: "motivations", label: "Motivations" },
  { field: "relationships", label: "Relationships" },
  { field: "history", label: "History" },
  { field: "voice", label: "Voice" },
];

export function CharacterCandidatesReview({ disabled }: { disabled: boolean }) {
  const [pendingActionId, setPendingActionId] = useState<string | null>(
    null,
  );
  const [pendingCandidates, setPendingCandidates] = useState<
    ReadonlyArray<CharacterCandidate>
  >([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const candidates = useProjectStore(
    (state) => state.meta.knowledge.characterCandidates,
  );
  const acceptCharacterCandidate = useProjectStore(
    (state) => state.acceptCharacterCandidate,
  );
  const dismissCharacterCandidate = useProjectStore(
    (state) => state.dismissCharacterCandidate,
  );

  const runCandidateAction = async (
    actionId: string,
    action: () => Promise<unknown>,
  ): Promise<void> => {
    if (pendingActionId !== null || disabled) return;
    setPendingCandidates(candidates);
    setPendingActionId(actionId);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      notifyAppError("candidate-decision", "Characters", useProjectStore.getState().project?.root ?? null, error);
      setActionError("Character review could not be saved. See Settings > Notifications.");
    } finally {
      setPendingActionId(null);
      setPendingCandidates([]);
    }
  };

  const visibleCandidates =
    pendingActionId === null ? candidates : pendingCandidates;

  if (visibleCandidates.length === 0) return <TypographyMuted>No pending characters</TypographyMuted>;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-character-review>
      <div className="flex flex-col gap-2">
        <TypographyH2 className="text-sm font-medium leading-5">Review new characters</TypographyH2>
        <TypographyMuted>
          Add generated characters to the cast or dismiss suggestions that do not belong.
        </TypographyMuted>
      </div>
      {actionError === null ? null : (
        <TypographyMuted role="alert" className="text-destructive">
          {actionError}
        </TypographyMuted>
      )}
      <div className="flex min-w-0 flex-col gap-3">
        {visibleCandidates.map((candidate) => {
          const dismissActionId = `dismiss-${candidate.id}`;
          const acceptActionId = `accept-${candidate.id}`;
          const populatedFields = PROFILE_FIELDS.filter(
            ({ field }) => candidate.profile[field].trim().length > 0,
          );
          return (
            <Card key={candidate.id} size="sm" className="min-w-0 shrink-0 break-words [overflow-wrap:anywhere]" data-character-candidate={candidate.id}>
              <CardHeader>
                <CardTitle>{candidate.name}</CardTitle>
                <CardDescription>{candidate.role}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {populatedFields.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <TypographyEyebrow>Generated details</TypographyEyebrow>
                    {populatedFields.map(({ field, label }) => (
                      <div key={field} className="flex flex-col gap-1">
                        <TypographyEyebrow>{label}</TypographyEyebrow>
                        <TypographyMuted>{candidate.profile[field]}</TypographyMuted>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="flex flex-col gap-2">
                  <TypographyEyebrow>Evidence</TypographyEyebrow>
                  {candidate.evidence.map((evidence) => (
                    <TypographyMuted key={evidence.fingerprint}>
                      {evidence.previewText}
                    </TypographyMuted>
                  ))}
                </div>
              </CardContent>
              <CardFooter className="flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  aria-label={`Dismiss ${candidate.name}`}
                  disabled={disabled || pendingActionId !== null}
                  onClick={() =>
                    void runCandidateAction(dismissActionId, () =>
                      dismissCharacterCandidate(candidate.id),
                    )
                  }
                >
                  {pendingActionId === dismissActionId ? <Spinner /> : null}
                  Dismiss
                </Button>
                <Button
                  aria-label={`Add ${candidate.name}`}
                  disabled={disabled || pendingActionId !== null}
                  onClick={() =>
                    void runCandidateAction(acceptActionId, () =>
                      acceptCharacterCandidate(candidate.id),
                    )
                  }
                >
                  {pendingActionId === acceptActionId ? <Spinner /> : null}
                  Add
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
