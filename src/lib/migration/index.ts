// migration/index.ts — versioned migration runner.
//
// Persisted ProjectMeta blobs carry a `version` field. The runner validates
// the raw blob with a Zod schema (schema.ts) that defaults every malformed
// field safely, then chains pending migrations in order from (version ?? 0)
// up to CURRENT_VERSION. Input is unknown — the schema is the type gate.

import { metaBlobSchema, type MetaBlob } from "@/lib/migration/schema";
import type { ProjectMeta } from "@/lib/types";
import { migrateV1 } from "@/lib/migration/v1/migrate";
import { migrateV2 } from "@/lib/migration/v2/migrate";

/** Bump whenever a migration is added. */
export const CURRENT_VERSION = 2;

type Migration = (meta: MetaBlob) => ProjectMeta;

const migrations: Record<number, Migration> = {
  1: migrateV1,
  2: migrateV2,
};

export const EMPTY_META: ProjectMeta = {
  version: CURRENT_VERSION,
  characters: [],
  lore: [],
  statuses: {},
  outline: { premise: "" },
  chapters: {},
};

export function runMigrations(raw: unknown): ProjectMeta {
  if (raw == null) return EMPTY_META;
  const result = metaBlobSchema.safeParse(raw);
  if (!result.success) return EMPTY_META;
  let meta: ProjectMeta = result.data as unknown as ProjectMeta;
  const version = meta.version;
  for (let v = version + 1; v <= CURRENT_VERSION; v++) {
    const fn = migrations[v];
    if (!fn) continue;
    meta = fn(meta as unknown as MetaBlob);
  }
  return meta;
}