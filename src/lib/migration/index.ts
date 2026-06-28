// migration/index.ts — versioned migration runner.
//
// Persisted ProjectMeta blobs carry a `version` field; when it's absent the
// runner treats it as 0 and applies every migration in order up to
// CURRENT_VERSION. Each migration is a pure function keyed by its target
// version number. The boundary accepts Record<string, unknown> | null so we
// can feed legacy blobs without shape assumptions.

import type { ProjectMeta } from "@/lib/types";
import { migrateV1 } from "@/lib/migration/v1/migrate";
import { migrateV2 } from "@/lib/migration/v2/migrate";

/** Bump whenever a migration is added. */
export const CURRENT_VERSION = 2;

type Migration = (meta: ProjectMeta) => ProjectMeta;

const migrations: Record<number, Migration> = {
  1: migrateV1,
  2: migrateV2,
};

const EMPTY_META: ProjectMeta = {
  version: CURRENT_VERSION,
  characters: [],
  lore: [],
  statuses: {},
  outline: { premise: "" },
  chapters: {},
};

export function runMigrations(raw: Record<string, unknown> | null): ProjectMeta {
  if (!raw) return EMPTY_META;
  const version = (raw.version as number | undefined) ?? 0;
  let meta = raw as unknown as ProjectMeta;
  for (let v = version + 1; v <= CURRENT_VERSION; v++) {
    const fn = migrations[v];
    if (!fn) continue;
    meta = fn(meta);
  }
  return meta;
}