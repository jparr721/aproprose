// commands/registry.ts - assembles the static command catalog and the dynamic
// page providers into the surface the palette renders.

import type { Command, PageId } from "./types";
import { chapterPage, navigationCommands, projectPage } from "./navigation";
import { viewCommands } from "./view";
import { documentCommands } from "./document";
import { aiCommands } from "./ai";
import { settingsCommands } from "./settings";
import { windowCommands } from "./window";

/** Every static (non-dynamic) command, in catalog order. */
export const STATIC_COMMANDS: Command[] = [
  ...navigationCommands,
  ...viewCommands,
  ...documentCommands,
  ...aiCommands,
  ...settingsCommands,
  ...windowCommands,
];

const PAGE_PROVIDERS: Record<PageId, () => Command[]> = {
  chapters: chapterPage,
  projects: projectPage,
};

/** Root commands available right now (enabled() filtered against current state). */
export function buildRootCommands(): Command[] {
  return STATIC_COMMANDS.filter((c) => c.enabled?.() ?? true);
}

/** The commands for a drilled-in sub-page, built fresh from store state. */
export function buildPage(page: PageId): Command[] {
  return PAGE_PROVIDERS[page]();
}

/** Look up a static command by id - used to resolve MRU entries. Dynamic nav
 *  targets (chapters, projects) are intentionally not resolvable. */
export function resolveStaticCommand(id: string): Command | undefined {
  return STATIC_COMMANDS.find((c) => c.id === id);
}
