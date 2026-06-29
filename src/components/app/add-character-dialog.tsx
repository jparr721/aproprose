// add-character-dialog.tsx — the shared "new cast member" form.
//
// Used from two places: the sidebar's Characters group (uncontrolled, via the
// `trigger` prop) and a dialogue block's speaker dropdown (controlled, no
// trigger, auto-assigning the fresh character as the block's speaker via `onAdded`).

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CHARACTER_COLORS,
  CharacterColorPicker,
} from "@/components/app/character-color-picker";
import { useProjectStore } from "@/stores/project-store";

export function AddCharacterDialog({
  open,
  onOpenChange,
  trigger,
  onAdded,
}: {
  /** Controlled open state. Omit to let the dialog manage its own (needs a `trigger`). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional trigger element (uncontrolled usage). */
  trigger?: React.ReactNode;
  /** Called with the new character's id after a successful add. */
  onAdded?: (id: string) => void;
}) {
  const addCharacter = useProjectStore((s) => s.addCharacter);
  const [internalOpen, setInternalOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [color, setColor] = useState(CHARACTER_COLORS[0]);

  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = (v: boolean) => {
    if (!isControlled) setInternalOpen(v);
    onOpenChange?.(v);
  };

  const submit = () => {
    if (!name.trim()) return;
    const id = addCharacter({ name: name.trim(), role: role.trim(), color });
    setName("");
    setRole("");
    setColor(CHARACTER_COLORS[0]);
    setOpen(false);
    onAdded?.(id);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add character</DialogTitle>
          <DialogDescription>
            Characters power dialogue speaker chips and the AI cast tracker.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="char-name">Name</Label>
            <Input
              id="char-name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Character name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="char-role">Role</Label>
            <Input
              id="char-role"
              value={role}
              onChange={(e) => setRole(e.currentTarget.value)}
              placeholder="Character role"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Color</Label>
            <CharacterColorPicker value={color} onChange={setColor} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!name.trim()}>
            Add character
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
