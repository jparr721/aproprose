// app-sidebar.tsx — the left navigation as a shadcn Sidebar: chapters (with
// status), characters, lore. Collapses offcanvas (⌘B). Replaces the old Rail.

import { useState } from "react";
import {
  IconChevronDown,
  IconChevronRight,
  IconDeviceFloppy,
  IconFolderOpen,
  IconPlus,
  IconSettings,
  IconX,
} from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ColorDot } from "@/components/app/color-dot";
import { SettingsSheet } from "@/components/app/settings-sheet";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import { cn } from "@/lib/utils";

const CHARACTER_COLORS = [
  "oklch(0.55 0.12 30)",
  "oklch(0.5 0.08 235)",
  "oklch(0.55 0.1 145)",
  "oklch(0.58 0.12 300)",
  "oklch(0.6 0.12 60)",
  "oklch(0.5 0.06 100)",
];

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
        <SidebarGroupAction title="Add character">
          <IconPlus />
        </SidebarGroupAction>
      </DialogTrigger>
      <DialogContent className="font-sans sm:max-w-sm">
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
        <SidebarGroupAction title="Add lore">
          <IconPlus />
        </SidebarGroupAction>
      </DialogTrigger>
      <DialogContent className="font-sans sm:max-w-sm">
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

export function AppSidebar() {
  const project = useProjectStore((s) => s.project);
  const meta = useProjectStore((s) => s.meta);
  const activeId = useProjectStore((s) => s.activeChapterId);
  const selectChapter = useProjectStore((s) => s.selectChapter);
  const chapterDirty = useProjectStore((s) => s.chapterDirty);
  const saving = useProjectStore((s) => s.saving);
  const recents = useProjectStore((s) => s.recents);
  const openDialog = useProjectStore((s) => s.openProjectDialog);
  const loadAt = useProjectStore((s) => s.loadProjectAt);
  const closeProject = useProjectStore((s) => s.closeProject);
  const saveChapter = useProjectStore((s) => s.saveChapter);
  const guard = useViewStore((s) => s.requestGuarded);

  if (!project) return null;

  return (
    <Sidebar collapsible="offcanvas" className="font-sans">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* The project name is the project switcher — clicking it opens the
                File menu (open / save / recent / close). */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton className="h-auto min-h-10 items-center gap-2 py-2 whitespace-normal">
                  <span className="min-w-0 flex-1 break-words font-heading text-sm text-foreground">
                    {project.name}
                  </span>
                  <IconChevronDown className="size-3 shrink-0 text-faint" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60 font-sans">
                <DropdownMenuItem onSelect={() => guard(() => void openDialog())}>
                  <IconFolderOpen /> Open project…
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!chapterDirty || saving}
                  onSelect={() => void saveChapter()}
                >
                  <IconDeviceFloppy /> Save chapter
                </DropdownMenuItem>
                {recents.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-faint">Recent</DropdownMenuLabel>
                    {recents.slice(0, 6).map((r) => (
                      <DropdownMenuItem
                        key={r.root}
                        disabled={r.root === project.root}
                        onSelect={() => guard(() => void loadAt(r.root))}
                      >
                        <span className="truncate">{r.name}</span>
                      </DropdownMenuItem>
                    ))}
                  </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => guard(closeProject)}>
                  <IconX /> Close project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <Collapsible defaultOpen className="group/collapsible">
          <SidebarGroup>
            <SidebarGroupLabel asChild className="gap-1">
              <CollapsibleTrigger>
                <IconChevronRight className="transition-transform group-data-[state=open]/collapsible:rotate-90" />
                Chapters
              </CollapsibleTrigger>
            </SidebarGroupLabel>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {project.chapters.map((c, idx) => {
                    const on = c.id === activeId;
                    return (
                      <SidebarMenuItem key={c.id}>
                        <SidebarMenuButton
                          isActive={on}
                          onClick={() => guard(() => void selectChapter(c.id))}
                          className="pr-8"
                        >
                          <span>{c.title}</span>
                        </SidebarMenuButton>
                        <SidebarMenuBadge>{idx + 1}</SidebarMenuBadge>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>

        <Collapsible defaultOpen className="group/collapsible">
          <SidebarGroup>
            <SidebarGroupLabel asChild className="gap-1">
              <CollapsibleTrigger>
                <IconChevronRight className="transition-transform group-data-[state=open]/collapsible:rotate-90" />
                Characters
              </CollapsibleTrigger>
            </SidebarGroupLabel>
            <AddCharacterDialog />
            <CollapsibleContent>
              <SidebarGroupContent>
                {meta.characters.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-faint">None yet — add your cast.</p>
                ) : (
                  <SidebarMenu>
                    {meta.characters.map((c) => (
                      <SidebarMenuItem key={c.id}>
                        <SidebarMenuButton className="h-auto min-h-8 items-start gap-2 py-1.5 text-muted-foreground whitespace-normal [&>span:last-child]:!whitespace-normal">
                          <ColorDot color={c.color} className="mt-0.5 shrink-0" />
                          <span className="break-words">{c.name}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                )}
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>

        <Collapsible defaultOpen className="group/collapsible">
          <SidebarGroup>
            <SidebarGroupLabel asChild className="gap-1">
              <CollapsibleTrigger>
                <IconChevronRight className="transition-transform group-data-[state=open]/collapsible:rotate-90" />
                Lore
              </CollapsibleTrigger>
            </SidebarGroupLabel>
            <AddLoreDialog />
            <CollapsibleContent>
              <SidebarGroupContent>
                {meta.lore.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-faint">No notes yet.</p>
                ) : (
                  <SidebarMenu>
                    {meta.lore.map((l) => (
                      <SidebarMenuItem key={l.id}>
                        <SidebarMenuButton className="h-auto min-h-8 items-start gap-2 py-1.5 text-muted-foreground whitespace-normal [&>span:last-child]:!whitespace-normal">
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-lore-ink" />
                          <span className="break-words">{l.title}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                )}
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SettingsSheet
              trigger={
                <SidebarMenuButton>
                  <IconSettings />
                  <span>Settings</span>
                </SidebarMenuButton>
              }
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
