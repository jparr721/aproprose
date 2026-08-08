// migration/index.ts — versioned migration runner.
//
// Persisted ProjectMeta blobs carry a `version` field. The runner validates
// the raw blob with a Zod schema (schema.ts) that defaults every malformed
// field safely, then chains pending migrations in order from (version ?? 0)
// up to CURRENT_VERSION. Input is unknown — the schema is the type gate.

import { metaBlobSchema, type MetaBlob } from "@/lib/migration/schema";
import { emptyProjectKnowledge } from "@/lib/story-knowledge/model";
import type { ProjectMeta } from "@/lib/types";
import { migrateV1 } from "@/lib/migration/v1/migrate";
import { migrateV2 } from "@/lib/migration/v2/migrate";
import { migrateV3 } from "@/lib/migration/v3/migrate";
import { migrateV4 } from "@/lib/migration/v4/migrate";
import { migrateV5 } from "@/lib/migration/v5/migrate";

/** Bump whenever a migration is added. */
export const CURRENT_VERSION = 5;

type Migration = (meta: MetaBlob) => MetaBlob | ProjectMeta;

const migrations: Record<number, Migration> = {
  1: migrateV1,
  2: migrateV2,
  3: migrateV3,
  4: migrateV4,
  5: migrateV5,
};

export const EMPTY_META: ProjectMeta = {
  version: CURRENT_VERSION,
  characters: [],
  lore: [],
  statuses: {},
  outline: { premise: "", overview: "" },
  chapters: {},
  knowledge: emptyProjectKnowledge(),
};

export function runMigrations(raw: unknown): ProjectMeta {
  if (raw == null) return EMPTY_META;
  const result = metaBlobSchema.safeParse(raw);
  if (!result.success) return EMPTY_META;
  let meta: MetaBlob | ProjectMeta = result.data;
  const version = meta.version;
  for (let v = version + 1; v <= CURRENT_VERSION; v++) {
    const fn = migrations[v];
    if (!fn) continue;
    meta = fn(meta as MetaBlob);
  }
  return meta as ProjectMeta;
}
