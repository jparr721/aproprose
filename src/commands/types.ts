// commands/types.ts - the command-palette command model.
//
// A command is plain data. Because every app action is backed by a global zustand
// store, a command's `run` just calls `useSomeStore.getState().action()` - no React
// context is needed. The two exceptions (the sidebar toggle, which lives in React
// context) arrive through `CommandContext`, which the palette injects at call time.
//
// A command is exactly one of: a leaf (`run`) or a page-opener (`page`). Dynamic
// lists (chapters, recent projects) are produced by provider functions in the group
// modules and assembled in `registry.ts`.

import type { Icon } from "@tabler/icons-react";
import type { KeybindingId } from "@/lib/keybindings";

export type CommandGroup =
  | "Navigation"
  | "View"
  | "Document"
  | "AI"
  | "Settings"
  | "Window";

/** Sub-pages the palette can drill into (cmdk "pages"). */
export type PageId = "chapters" | "projects";

/** Non-store handles the palette injects at render time (React context, etc.). */
export interface CommandContext {
  toggleSidebar: () => void;
}

export interface Command {
  /** Stable id; also the MRU key, e.g. "view.toggle-pdf". */
  id: string;
  group: CommandGroup;
  title: string;
  /** Extra fuzzy-search aliases, e.g. ["dark mode"] for the dark theme. */
  keywords?: string[];
  icon?: Icon;
  /** Renders a <KeybindingHint>; the keybinding registry stays the source of glyphs. */
  keybindingId?: KeybindingId;
  /** Page-opener: selecting pushes this sub-page instead of running. */
  page?: PageId;
  /** Leaf: invoked on select, after the palette closes. */
  run?: (ctx: CommandContext) => void | Promise<void>;
  /** Omit -> always available. Returns false -> excluded from the list. */
  enabled?: () => boolean;
}
