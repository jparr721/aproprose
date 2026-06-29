// app-sidebar.tsx — the left navigation as a shadcn Sidebar: chapters (with
// status), characters, lore. Collapses offcanvas (⌘B). Replaces the old Rail.

import { useState } from "react";
import {
  IconAdjustments,
  IconChevronDown,
  IconChevronRight,
  IconDeviceFloppy,
  IconFolderOpen,
  IconLayoutList,
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
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ColorDot } from "@/components/app/color-dot";
import { AddCharacterDialog } from "@/components/app/add-character-dialog";
import { ChapterList } from "@/components/app/chapter-list";
import { ProjectSettingsDialog } from "@/components/app/project-settings-dialog";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import { useSettingsDialogStore } from "@/stores/settings-dialog-store";
import { useKeybinding } from "@/hooks/use-keybinding";
import { KEYBINDING_IDS } from "@/lib/keybindings";
import { useLoreSheetStore } from "@/stores/lore-sheet-store";
import { IS_MAC } from "@/lib/platform";
import { LoreDetailSheet } from "@/components/app/lore/lore-detail-sheet";
import { cn } from "@/lib/utils";

function AddLoreDialog() {
  const addLore = useProjectStore((s) => s.addLore);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const openLoreSheet = useLoreSheetStore.getState().open;
  const submit = () => {
    if (!title.trim()) return;
    const entryId = addLore(title.trim());
    setTitle("");
    setOpen(false);
    openLoreSheet(entryId);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <SidebarGroupAction title="Add lore">
          <IconPlus />
        </SidebarGroupAction>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add lore note</DialogTitle>
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
  const recents = useProjectStore((s) => s.recents);
  const openDialog = useProjectStore((s) => s.openProjectDialog);
  const loadAt = useProjectStore((s) => s.loadProjectAt);
  const closeProject = useProjectStore((s) => s.closeProject);
  const compileNow = useProjectStore((s) => s.compileNow);
  const compiling = useProjectStore((s) => s.compile.status === "compiling");
  const guard = useViewStore((s) => s.requestGuarded);
  const toggleOutline = useViewStore((s) => s.toggleOutline);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openLoreSheet = useLoreSheetStore((s) => s.open);

  // The Outline toggle is guarded (a dirty chapter stages the unsaved-edits
  // dialog first). Bind the chord co-located with the action, mirroring the
  // top bar's TOGGLE_PDF. The button below calls the same guarded toggle.
  useKeybinding(KEYBINDING_IDS.TOGGLE_OUTLINE, () => guard(toggleOutline));

  if (!project) return null;

  return (
    <Sidebar collapsible="offcanvas">
      {/* On macOS the native traffic lights are pinned to the window's top-left
          (x16/y16). When the sidebar is open that corner is the header, so we
          reserve a top-bar-height band (pt-11 = h-11) to drop the project name
          clear of the lights instead of nudging the name itself. */}
      <SidebarHeader className={cn(IS_MAC && "pt-11")}>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* The project name is the project switcher — clicking it opens the
                File menu (open / save / recent / close). */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton className="h-auto min-h-10 items-center gap-2 py-2 whitespace-normal">
                  <span className="min-w-0 flex-1 break-words font-serif text-sm text-foreground">
                    {project.name}
                  </span>
                  <IconChevronDown className="size-3 shrink-0 text-faint" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                <DropdownMenuItem onSelect={() => guard(() => void openDialog())}>
                  <IconFolderOpen /> Open project
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={compiling}
                  onSelect={() => void compileNow()}
                >
                  <IconDeviceFloppy /> Save &amp; build PDF
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                  <IconAdjustments /> Project settings
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
        <ChapterList />

        <Collapsible defaultOpen className="group/collapsible">
          <SidebarGroup>
            <SidebarGroupLabel asChild className="gap-1">
              <CollapsibleTrigger>
                <IconChevronRight className="transition-transform group-data-[state=open]/collapsible:rotate-90" />
                Characters
              </CollapsibleTrigger>
            </SidebarGroupLabel>
            <AddCharacterDialog
              trigger={
                <SidebarGroupAction title="Add character">
                  <IconPlus />
                </SidebarGroupAction>
              }
            />
            <CollapsibleContent>
              <SidebarGroupContent>
                {meta.characters.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-faint">None yet — add your cast.</p>
                ) : (
                  <SidebarMenu>
                    {meta.characters.map((c) => (
                      <SidebarMenuItem key={c.id}>
                        <SidebarMenuButton className="h-auto min-h-8 items-start gap-2 py-1.5 text-muted-foreground whitespace-normal [&>span:last-child]:!whitespace-normal">
                          <span className="flex h-4 shrink-0 items-center">
                            <ColorDot color={c.color} />
                          </span>
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
                        <SidebarMenuButton
                          className="h-auto min-h-8 items-start gap-2 py-1.5 text-muted-foreground whitespace-normal [&>span:last-child]:!whitespace-normal"
                          onClick={() => openLoreSheet(l.id)}
                        >
                          <span className="flex h-4 shrink-0 items-center">
                            <span className="size-1.5 rounded-full bg-lore-ink" />
                          </span>
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
            <SidebarMenuButton onClick={() => guard(toggleOutline)}>
              <IconLayoutList />
              <span>Outline</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => useSettingsDialogStore.getState().setOpen(true)}
            >
              <IconSettings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <ProjectSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <LoreDetailSheet />
    </Sidebar>
  );
}
