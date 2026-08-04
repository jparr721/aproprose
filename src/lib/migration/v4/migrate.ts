import type { MetaBlob } from "@/lib/migration/schema";
import type { ProjectMeta } from "@/lib/types";

export function migrateV4(meta: MetaBlob): ProjectMeta {
  return {
    ...meta,
    version: 4,
    outline: {
      premise: meta.outline.premise,
      overview: meta.outline.overview,
    },
    chapters: meta.chapters ?? {},
  };
}
