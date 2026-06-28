// migration/v2/migrate.ts — backfill LoreEntry fields.
//
// Ensures every lore entry has description, characterIds, and tags (all default
// to empty). No-op on entries that already carry the fields.

import type { ProjectMeta } from "@/lib/types";

export function migrateV2(meta: ProjectMeta): ProjectMeta {
  return {
    ...meta,
    version: 2,
    lore: meta.lore.map((l) => {
      const r = l as unknown as Record<string, unknown>;
      return {
        ...l,
        description: (r.description as string) ?? "",
        characterIds: (r.characterIds as string[]) ?? [],
        tags: (r.tags as string[]) ?? [],
      };
    }),
  };
}