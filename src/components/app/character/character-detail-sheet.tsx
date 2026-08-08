import { IconUser } from "@tabler/icons-react";
import { CharacterColorPicker } from "@/components/app/character-color-picker";
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
import type { CharacterProfileField } from "@/lib/types";
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
  const close = useCharacterSheetStore((state) => state.close);
  const characters = useProjectStore((state) => state.meta.characters);
  const updateCharacter = useProjectStore((state) => state.updateCharacter);

  const entry = characterId
    ? characters.find((character) => character.id === characterId)
    : null;
  if (!entry) {
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
          <SheetTitle className="flex items-center gap-2 font-sans text-sm">
            <IconUser className="size-4 text-muted-foreground" />
            Edit {entry.name}
          </SheetTitle>
          <SheetDescription className="text-xs">
            Character profile details.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="character-name">Name</Label>
              <Input
                id="character-name"
                value={entry.name}
                onChange={(event) =>
                  updateCharacter(entry.id, { name: event.currentTarget.value })
                }
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="character-role">Role</Label>
              <Input
                id="character-role"
                value={entry.role}
                onChange={(event) =>
                  updateCharacter(entry.id, { role: event.currentTarget.value })
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
      </SheetContent>
    </Sheet>
  );
}
