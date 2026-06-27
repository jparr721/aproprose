// chapter-list.tsx — the Chapters sidebar group: select, add, rename, reorder,
// delete. The app owns chapters.tex; every mutation calls a store action that
// regenerates it on the Rust side and swaps in the fresh ProjectInfo.

import { useState } from "react";
import {
  IconChevronRight,
  IconChevronUp,
  IconChevronDown,
  IconDots,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { ChapterRef } from "@/lib/types";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";

function AddChapterDialog() {
  const addChapter = useProjectStore((s) => s.addChapter);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const submit = () => {
    if (!title.trim()) return;
    void addChapter(title.trim());
    setTitle("");
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <SidebarGroupAction title="Add chapter">
          <IconPlus />
        </SidebarGroupAction>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add chapter</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-chapter-title">Title</Label>
          <Input
            id="add-chapter-title"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Chapter title"
          />
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!title.trim()}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameChapterDialog({
  chapter,
  open,
  onOpenChange,
}: {
  chapter: ChapterRef;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const renameChapter = useProjectStore((s) => s.renameChapter);
  const [title, setTitle] = useState(chapter.title);
  const submit = () => {
    if (!title.trim()) return;
    void renameChapter(chapter.id, title.trim());
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename chapter</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rename-chapter-title">Title</Label>
          <Input
            id="rename-chapter-title"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!title.trim()}>
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChapterRow({ chapter, index }: { chapter: ChapterRef; index: number }) {
  const activeId = useProjectStore((s) => s.activeChapterId);
  const selectChapter = useProjectStore((s) => s.selectChapter);
  const moveChapter = useProjectStore((s) => s.moveChapter);
  const deleteChapter = useProjectStore((s) => s.deleteChapter);
  const count = useProjectStore((s) => s.project?.chapters.length ?? 0);
  const guard = useViewStore((s) => s.requestGuarded);
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const on = chapter.id === activeId;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={on}
        onClick={() => guard(() => void selectChapter(chapter.id))}
        className="pr-14"
      >
        <span>{chapter.title}</span>
      </SidebarMenuButton>
      <SidebarMenuBadge className="right-8">{index + 1}</SidebarMenuBadge>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction title="Chapter actions" showOnHover>
            <IconDots />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <IconPencil /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={index === 0}
            onSelect={() => void moveChapter(chapter.id, -1)}
          >
            <IconChevronUp /> Move up
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={index === count - 1}
            onSelect={() => void moveChapter(chapter.id, 1)}
          >
            <IconChevronDown /> Move down
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmingDelete(true)}>
            <IconTrash /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {renaming ? (
        <RenameChapterDialog chapter={chapter} open={renaming} onOpenChange={setRenaming} />
      ) : null}

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{chapter.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the chapter file from disk. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void deleteChapter(chapter.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarMenuItem>
  );
}

export function ChapterList() {
  const chapters = useProjectStore((s) => s.project?.chapters ?? []);
  return (
    <Collapsible defaultOpen className="group/collapsible">
      <SidebarGroup>
        <SidebarGroupLabel asChild className="gap-1">
          <CollapsibleTrigger>
            <IconChevronRight className="transition-transform group-data-[state=open]/collapsible:rotate-90" />
            Chapters
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <AddChapterDialog />
        <CollapsibleContent>
          <SidebarGroupContent>
            {chapters.length === 0 ? (
              <p className="px-2 py-1 text-xs text-faint">No chapters yet — add one.</p>
            ) : (
              <SidebarMenu>
                {chapters.map((c, idx) => (
                  <ChapterRow key={c.id} chapter={c} index={idx} />
                ))}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
