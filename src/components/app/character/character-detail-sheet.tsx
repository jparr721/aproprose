import { useEffect } from "react";
import { IconUser } from "@tabler/icons-react";
import { AgentSection } from "@/components/app/agent-console/agent-console";
import { CharacterColorPicker } from "@/components/app/character-color-picker";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { stopAgentRun } from "@/lib/ai/agent-controller";
import type { CharacterProfileField } from "@/lib/types";
import { hydrateAgentCharacterSession } from "@/stores/agent-persistence";
import { useCharacterSheetStore } from "@/stores/character-sheet-store";
import { useProjectStore } from "@/stores/project-store";

const PROFILE_FIELDS: Array<{
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

export function CharacterDetailSheet() {
  const characterId = useCharacterSheetStore((state) => state.characterId);
  const view = useCharacterSheetStore((state) => state.view);
  const close = useCharacterSheetStore((state) => state.close);
  const showDescribe = useCharacterSheetStore((state) => state.showDescribe);
  const showManual = useCharacterSheetStore((state) => state.showManual);
  const project = useProjectStore((state) => state.project);
  const characters = useProjectStore((state) => state.meta.characters);
  const updateCharacter = useProjectStore((state) => state.updateCharacter);
  const projectRoot = project?.root ?? null;

  useEffect(() => {
    if (
      characterId === null ||
      projectRoot === null ||
      view !== "describe"
    ) return;
    const sessionId = { kind: "character" as const, characterId };
    void hydrateAgentCharacterSession(projectRoot, characterId);
    return () => stopAgentRun(sessionId);
  }, [characterId, projectRoot, view]);

  const entry = characterId
    ? characters.find((character) => character.id === characterId)
    : null;
  if (!entry || project === null) {
    if (characterId) close();
    return null;
  }

  return (
    <Sheet
      open={Boolean(characterId)}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="gap-1 border-b border-border px-4 py-3.5">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <IconUser className="size-4 text-muted-foreground" />
            Edit {entry.name}
          </SheetTitle>
          <SheetDescription className="text-xs">
            Character profile details.
          </SheetDescription>
          <ButtonGroup aria-label="Character profile view">
            <Button
              onClick={showManual}
              size="sm"
              type="button"
              variant={view === "manual" ? "default" : "outline"}
            >
              Manual
            </Button>
            <Button
              onClick={showDescribe}
              size="sm"
              type="button"
              variant={view === "describe" ? "default" : "outline"}
            >
              Describe with AI
            </Button>
          </ButtonGroup>
        </SheetHeader>

        {view === "describe" ? (
          <div className="min-h-0 flex-1">
            <AgentSection
              ariaLabel="Character Describe"
              closeLabel="Close Character Describe"
              contextLabel={`${project.name} / ${entry.name}`}
              emptyDescription="Talk through appearance, mannerisms, motivations, relationships, history, voice, contradictions, or new possibilities. Useful details update the profile as you work."
              emptyTitle={`Describe ${entry.name}`}
              onClose={showManual}
              placeholder={`Describe ${entry.name} or explore new details`}
              sessionId={{ kind: "character", characterId: entry.id }}
              task={{ kind: "character-describe", characterId: entry.id }}
              title="Character Describe"
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="character-name">Name</Label>
                <Input
                  id="character-name"
                  value={entry.name}
                  onChange={(event) =>
                    updateCharacter(entry.id, {
                      name: event.currentTarget.value,
                    })
                  }
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="character-role">Role</Label>
                <Input
                  id="character-role"
                  value={entry.role}
                  onChange={(event) =>
                    updateCharacter(entry.id, {
                      role: event.currentTarget.value,
                    })
                  }
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Color</Label>
                <CharacterColorPicker
                  value={entry.color}
                  onChange={(color) => updateCharacter(entry.id, { color })}
                />
              </div>

              {PROFILE_FIELDS.map(({ field, label }) => {
                const id = `character-profile-${field}`;
                return (
                  <div key={field} className="flex flex-col gap-1.5">
                    <Label htmlFor={id}>{label}</Label>
                    <Textarea
                      id={id}
                      value={entry.profile[field]}
                      onChange={(event) =>
                        updateCharacter(entry.id, {
                          profile: {
                            ...entry.profile,
                            [field]: event.currentTarget.value,
                          },
                        })
                      }
                      rows={4}
                      className="resize-y"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
