// rail.tsx — the left navigation: chapters (with status), characters, lore.
// Minimal by design — just enough to move around the manuscript.

import { useState } from "react";
import { IconPlus } from "@tabler/icons-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { TypographyEyebrow } from "@/components/ui/typography";
import { ColorDot } from "@/components/app/color-dot";
import { chapterStatus, useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import type { ChapterStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_DOT: Record<ChapterStatus, string> = {
  active: "bg-ok",
  draft: "bg-warn",
  outline: "bg-scratch-ink",
  planned: "bg-faint opacity-50",
};

const CHARACTER_COLORS = [
  "oklch(0.55 0.12 30)",
  "oklch(0.5 0.08 235)",
  "oklch(0.55 0.1 145)",
  "oklch(0.58 0.12 300)",
  "oklch(0.6 0.12 60)",
  "oklch(0.5 0.06 100)",
];

function SectionHeader({
  label,
  onAdd,
  addTitle,
}: {
  label: string;
  onAdd?: () => void;
  addTitle?: string;
}) {
  return (
    <div className="flex items-center justify-between px-2 pb-1 pt-4">
      <TypographyEyebrow>{label}</TypographyEyebrow>
      {onAdd ? (
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-mid"
          title={addTitle}
          onClick={onAdd}
        >
          <IconPlus />
        </Button>
      ) : null}
    </div>
  );
}

function AddCharacterDialog() {
  const addCharacter = useProjectStore((s) => s.addCharacter);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [color, setColor] = useState(CHARACTER_COLORS[0]);

  const submit = () => {
    if (!name.trim()) return;
    addCharacter({ name: name.trim(), role: role.trim(), color });
    setName("");
    setRole("");
    setColor(CHARACTER_COLORS[0]);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-xs" className="text-mid" title="Add character">
          <IconPlus />
        </Button>
      </DialogTrigger>
      <DialogContent className="font-ui sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">Add character</DialogTitle>
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
              placeholder="Det. Marlow"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="char-role">Role</Label>
            <Input
              id="char-role"
              value={role}
              onChange={(e) => setRole(e.currentTarget.value)}
              placeholder="Interrogator"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Color</Label>
            <div className="flex gap-2">
              {CHARACTER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label="color"
                  aria-pressed={c === color}
                  onClick={() => setColor(c)}
                  className={cn(
                    "size-6 rounded-full ring-offset-2 ring-offset-background transition-shadow",
                    c === color && "ring-2 ring-ring",
                  )}
                >
                  <ColorDot color={c} className="size-6" />
                </button>
              ))}
            </div>
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

function AddLoreDialog() {
  const addLore = useProjectStore((s) => s.addLore);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const submit = () => {
    if (!title.trim()) return;
    addLore(title.trim());
    setTitle("");
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-xs" className="text-mid" title="Add lore">
          <IconPlus />
        </Button>
      </DialogTrigger>
      <DialogContent className="font-ui sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">Add lore note</DialogTitle>
          <DialogDescription>A worldbuilding entry to track.</DialogDescription>
        </DialogHeader>
        <Input
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="The Tile"
        />
        <DialogFooter>
          <Button onClick={submit} disabled={!title.trim()}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Rail() {
  const project = useProjectStore((s) => s.project);
  const meta = useProjectStore((s) => s.meta);
  const activeId = useProjectStore((s) => s.activeChapterId);
  const selectChapter = useProjectStore((s) => s.selectChapter);
  const guard = useViewStore((s) => s.requestGuarded);

  if (!project) return null;

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-line-soft bg-sidebar font-ui">
      <div className="flex items-baseline gap-1.5 px-4 pb-2 pt-3.5">
        <span className="truncate font-heading text-sm text-foreground">{project.name}</span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pb-6">
          <SectionHeader label="Chapters" />
          <div className="flex flex-col gap-0.5">
            {project.chapters.map((c) => {
              const status = chapterStatus(c, meta, activeId);
              const on = c.id === activeId;
              return (
                <button
                  key={c.id}
                  onClick={() => guard(() => void selectChapter(c.id))}
                  className={cn(
                    "grid grid-cols-[24px_1fr_auto] items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
                    on ? "bg-card text-foreground" : "text-mid hover:bg-sunk",
                  )}
                >
                  <span
                    className={cn(
                      "font-serif text-[13px] italic",
                      on ? "text-accent-ink" : "text-faint",
                    )}
                  >
                    {c.label}
                  </span>
                  <span className="truncate">{c.title}</span>
                  <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between px-2 pb-1 pt-4">
            <TypographyEyebrow>Characters</TypographyEyebrow>
            <AddCharacterDialog />
          </div>
          <div className="flex flex-col gap-0.5">
            {meta.characters.length === 0 ? (
              <p className="px-2 py-1 text-xs text-faint">
                None yet — add your cast.
              </p>
            ) : (
              meta.characters.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-mid"
                >
                  <ColorDot color={c.color} />
                  <span className="truncate">{c.name}</span>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between px-2 pb-1 pt-4">
            <TypographyEyebrow>Lore</TypographyEyebrow>
            <AddLoreDialog />
          </div>
          <div className="flex flex-col gap-0.5">
            {meta.lore.length === 0 ? (
              <p className="px-2 py-1 text-xs text-faint">No notes yet.</p>
            ) : (
              meta.lore.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-mid"
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-lore-ink" />
                  <span className="truncate">{l.title}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}
