// command-palette.tsx - the Cmd/Ctrl+K palette.
//
// Mounted once inside the workspace's SidebarProvider (so it can reach the sidebar
// toggle, which lives in React context). It reads the command catalog from
// src/commands and renders it with the shadcn cmdk primitives. Root shows a
// "Recent" group plus the grouped catalog; page-openers drill into a flat sub-list.

import { useEffect, useState } from "react";
import { IconChevronRight } from "@tabler/icons-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useSidebar } from "@/components/ui/sidebar";
import { KeybindingHint } from "@/components/app/keybinding-hint";
import { useKeybinding } from "@/hooks/use-keybinding";
import { KEYBINDINGS, KEYBINDING_IDS } from "@/lib/keybindings";
import { useCommandPaletteStore } from "@/stores/command-palette-store";
import {
  buildPage,
  buildRootCommands,
  resolveStaticCommand,
} from "@/commands/registry";
import type {
  Command as Cmd,
  CommandContext,
  CommandGroup as Group,
} from "@/commands/types";

const GROUP_ORDER: Group[] = [
  "Navigation",
  "View",
  "Document",
  "AI",
  "Settings",
  "Window",
];

// The sidebar's ⌘B binding is owned by SidebarProvider, not our registry; we render
// the hint from a literal so we don't imply we bind it.
const SIDEBAR_HINT = { key: "b", modifiers: { ctrl: true } } as const;

const PAGE_PLACEHOLDER: Record<string, string> = {
  root: "Type a command or search",
  chapters: "Go to chapter",
  projects: "Switch project",
};

export function CommandPalette() {
  const open = useCommandPaletteStore((s) => s.open);
  const page = useCommandPaletteStore((s) => s.page);
  const recentIds = useCommandPaletteStore((s) => s.recentIds);
  const closePalette = useCommandPaletteStore((s) => s.closePalette);
  const togglePalette = useCommandPaletteStore((s) => s.togglePalette);
  const pushPage = useCommandPaletteStore((s) => s.pushPage);
  const popToRoot = useCommandPaletteStore((s) => s.popToRoot);
  const recordRun = useCommandPaletteStore((s) => s.recordRun);

  const { toggleSidebar } = useSidebar();
  const [query, setQuery] = useState("");

  useKeybinding(KEYBINDING_IDS.OPEN_COMMAND_PALETTE, togglePalette);

  // Reset the search whenever the palette opens or drills into a page.
  useEffect(() => {
    setQuery("");
  }, [open, page]);

  const ctx: CommandContext = { toggleSidebar };

  const runCommand = (cmd: Cmd) => {
    if (cmd.page) {
      pushPage(cmd.page);
      return;
    }
    closePalette();
    if (resolveStaticCommand(cmd.id)) recordRun(cmd.id);
    void cmd.run?.(ctx);
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && query === "" && page !== "root") {
      e.preventDefault();
      popToRoot();
    }
  };

  const commands = !open ? [] : page === "root" ? buildRootCommands() : buildPage(page);
  const showRecent = page === "root" && query.trim() === "" && recentIds.length > 0;
  const recentCommands = showRecent
    ? recentIds
        .map((id) => resolveStaticCommand(id))
        .filter((c): c is Cmd => Boolean(c))
    : [];

  const renderItem = (cmd: Cmd, opts?: { recent?: boolean }) => {
    const Icon = cmd.icon;
    return (
      <CommandItem
        key={opts?.recent ? `recent:${cmd.id}` : cmd.id}
        value={opts?.recent ? `recent:${cmd.title}` : cmd.title}
        keywords={cmd.keywords}
        onSelect={() => runCommand(cmd)}
      >
        {Icon ? <Icon /> : null}
        <span className="min-w-0 flex-1 truncate">{cmd.title}</span>
        {cmd.page ? (
          <IconChevronRight className="ml-auto size-3.5 opacity-40" />
        ) : cmd.keybindingId ? (
          <CommandShortcut>
            <KeybindingHint keybinding={KEYBINDINGS[cmd.keybindingId]} />
          </CommandShortcut>
        ) : cmd.id === "view.toggle-sidebar" ? (
          <CommandShortcut>
            <KeybindingHint keybinding={SIDEBAR_HINT} />
          </CommandShortcut>
        ) : null}
      </CommandItem>
    );
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => !next && closePalette()}
    >
      <Command>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          onKeyDown={onInputKeyDown}
          placeholder={PAGE_PLACEHOLDER[page]}
        />
        <CommandList>
          <CommandEmpty>No matching commands</CommandEmpty>

          {page !== "root" ? (
            <CommandGroup>{commands.map((c) => renderItem(c))}</CommandGroup>
          ) : (
            <>
              {showRecent ? (
                <>
                  <CommandGroup heading="Recent">
                    {recentCommands.map((c) => renderItem(c, { recent: true }))}
                  </CommandGroup>
                  <CommandSeparator />
                </>
              ) : null}
              {GROUP_ORDER.map((group) => {
                const items = commands.filter((c) => c.group === group);
                if (items.length === 0) return null;
                return (
                  <CommandGroup key={group} heading={group}>
                    {items.map((c) => renderItem(c))}
                  </CommandGroup>
                );
              })}
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
