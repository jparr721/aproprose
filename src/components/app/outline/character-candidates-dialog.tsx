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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  TypographyEyebrow,
  TypographyMuted,
} from "@/components/ui/typography";
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

export function CharacterCandidatesDialog() {
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
    setPendingCandidates(candidates);
    setPendingActionId(actionId);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingActionId(null);
      setPendingCandidates([]);
    }
  };

  const visibleCandidates =
    pendingActionId === null ? candidates : pendingCandidates;

  if (visibleCandidates.length === 0) return null;

  const candidateLabel =
    visibleCandidates.length === 1 ? "character" : "characters";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Review {visibleCandidates.length} {candidateLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Review new characters</DialogTitle>
          <DialogDescription>
            Add generated characters to the cast or dismiss suggestions that do not belong.
          </DialogDescription>
        </DialogHeader>
        {actionError === null ? null : (
          <TypographyMuted role="alert" className="text-destructive">
            {actionError}
          </TypographyMuted>
        )}
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
          {visibleCandidates.map((candidate) => {
            const dismissActionId = `dismiss-${candidate.id}`;
            const acceptActionId = `accept-${candidate.id}`;
            const populatedFields = PROFILE_FIELDS.filter(
              ({ field }) => candidate.profile[field].trim().length > 0,
            );
            return (
              <Card key={candidate.id} size="sm">
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
                <CardFooter className="justify-end gap-2">
                  <Button
                    variant="outline"
                    disabled={pendingActionId !== null}
                    onClick={() =>
                      void runCandidateAction(dismissActionId, () =>
                        dismissCharacterCandidate(candidate.id),
                      )
                    }
                  >
                    {pendingActionId === dismissActionId ? <Spinner /> : null}
                    Dismiss {candidate.name}
                  </Button>
                  <Button
                    disabled={pendingActionId !== null}
                    onClick={() =>
                      void runCandidateAction(acceptActionId, () =>
                        acceptCharacterCandidate(candidate.id),
                      )
                    }
                  >
                    {pendingActionId === acceptActionId ? <Spinner /> : null}
                    Add {candidate.name}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
