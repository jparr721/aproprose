// migration/v2/migrate.ts — v2 migration: version stamp only.
//
// The Zod boundary schema (schema.ts) already backfills description,
// characterIds, and tags on every lore entry via .catch() defaults,
// so v2 is a pure version stamp.

import type { MetaBlob } from "@/lib/migration/schema";
import type { ProjectMeta } from "@/lib/types";

export function migrateV2(meta: MetaBlob): ProjectMeta {
  return { ...meta, version: 2, chapters: meta.chapters ?? {} };
}