// lore/model.ts — pure lore operations.
//
// No I/O, no store access. Every function takes a list of lore entries and
// returns NEW data, never mutating inputs. The store wires these to persistence.

import type { LoreEntry } from "@/lib/types";

/** Update a single lore entry by id. Returns a new array. */
export function updateLore(
  lore: LoreEntry[],
  id: string,
  patch: Partial<Pick<LoreEntry, "title" | "description" | "characterIds" | "tags">>,
): LoreEntry[] {
  return lore.map((l) => (l.id === id ? { ...l, ...patch } : l));
}

/** Remove a lore entry by id. Returns a new array. */
export function removeLore(lore: LoreEntry[], id: string): LoreEntry[] {
  return lore.filter((l) => l.id !== id);
}