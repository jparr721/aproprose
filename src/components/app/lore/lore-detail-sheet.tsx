// lore-detail-sheet.tsx — right-side slide-over editor for a single lore entry.
//
// Reuses the shadcn Sheet primitive. Contents: title Input, description Textarea,
// character assign, tag multi-select, delete button.

import { useState } from "react";
import { IconBook, IconPlus, IconTag, IconTrash, IconX } from "@tabler/icons-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CharacterAssign } from "@/components/app/outline/character-assign";
import { TypographyEyebrow } from "@/components/ui/typography";
import { useLoreSheetStore } from "@/stores/lore-sheet-store";
import { useProjectStore } from "@/stores/project-store";
import { useSettingsStore } from "@/stores/settings-store";

export function LoreDetailSheet() {
  const loreId = useLoreSheetStore((s) => s.loreId);
  const close = useLoreSheetStore((s) => s.close);
  const meta = useProjectStore((s) => s.meta);
  const updateLore = useProjectStore((s) => s.updateLore);
  const removeLore = useProjectStore((s) => s.removeLore);
  const loreTags = useSettingsStore((s) => s.loreTags);
  const setLoreTags = useSettingsStore((s) => s.setLoreTags);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newTag, setNewTag] = useState("");

  const entry = loreId ? meta.lore.find((l) => l.id === loreId) : null;
  if (!entry) return null;

  const selectedTags = new Set(entry.tags);

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed || selectedTags.has(trimmed)) return;
    updateLore(entry.id, { tags: [...entry.tags, trimmed] });
    if (!loreTags.includes(trimmed)) {
      setLoreTags([...loreTags, trimmed]);
    }
    setNewTag("");
  };

  const removeTag = (tag: string) => {
    updateLore(entry.id, { tags: entry.tags.filter((t) => t !== tag) });
  };

  const handleDelete = () => {
    removeLore(entry.id);
    close();
  };

  return (
    <>
      <Sheet open={Boolean(loreId)} onOpenChange={(open) => { if (!open) close(); }}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="gap-1 border-b border-border px-4 py-3.5">
            <SheetTitle className="flex items-center gap-2 font-sans text-sm">
              <IconBook className="size-4 text-lore-ink" />
              Edit lore
            </SheetTitle>
            <SheetDescription className="text-xs">
              Worldbuilding entry details.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-col gap-1.5">
                <TypographyEyebrow>Title</TypographyEyebrow>
                <Input
                  value={entry.title}
                  onChange={(e) => updateLore(entry.id, { title: e.target.value })}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <TypographyEyebrow>Description</TypographyEyebrow>
                <Textarea
                  value={entry.description}
                  onChange={(e) => updateLore(entry.id, { description: e.target.value })}
                  placeholder="What this worldbuilding element is, why it matters..."
                  rows={4}
                  className="resize-y"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <TypographyEyebrow>Characters</TypographyEyebrow>
                <CharacterAssign
                  assignedIds={entry.characterIds}
                  onAdd={(id) => updateLore(entry.id, { characterIds: [...entry.characterIds, id] })}
                  onRemove={(id) => updateLore(entry.id, { characterIds: entry.characterIds.filter((c) => c !== id) })}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <TypographyEyebrow>Tags</TypographyEyebrow>
                <div className="flex flex-wrap items-center gap-1.5">
                  {entry.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1">
                      <IconTag className="size-2.5" />
                      {tag}
                      <Button
                        variant="ghost"
                        onClick={() => removeTag(tag)}
                        className="-mr-1 size-4 p-0 hover:bg-transparent"
                      >
                        <IconX className="size-2" />
                      </Button>
                    </Badge>
                  ))}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost">
                        <IconPlus className="size-4" /> Tag
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-56 p-2">
                      <div className="flex flex-col gap-1.5">
                        {loreTags.length > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            {loreTags.map((tag) => (
                              <Button
                                key={tag}
                                variant={selectedTags.has(tag) ? "default" : "ghost"}
                                className="justify-start"
                                onClick={() => {
                                  if (selectedTags.has(tag)) {
                                    removeTag(tag);
                                  } else {
                                    addTag(tag);
                                  }
                                }}
                              >
                                <IconTag className="size-3" />
                                {tag}
                              </Button>
                            ))}
                          </div>
                        ) : null}
                        <div className="flex gap-1">
                          <Input
                            value={newTag}
                            onChange={(e) => setNewTag(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") addTag(newTag); }}
                            placeholder="Add tag"
                            className="h-7 text-xs"
                          />
                          <Button
                            variant="outline"
                            className="h-7 shrink-0 px-2 text-xs"
                            onClick={() => addTag(newTag)}
                            disabled={!newTag.trim()}
                          >
                            Add
                          </Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-border px-4 py-3">
            <Button variant="destructive" onClick={() => setDeleteOpen(true)} className="w-full">
              <IconTrash /> Delete lore entry
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete lore entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the entry and its links from all cards. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}