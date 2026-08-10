// migration/v3/migrate.ts - v3 migration: version stamp only.
//
// The Zod boundary schema (schema.ts) already backfills blockIds: [] on every
// persisted ContinuityFlag via .catch() defaults, so v3 is a pure version stamp
// (v2 precedent).

import type { MetaBlob } from "@/lib/migration/schema";

export function migrateV3(meta: MetaBlob): MetaBlob {
  return { ...meta, version: 3, chapters: meta.chapters ?? {} };
}
