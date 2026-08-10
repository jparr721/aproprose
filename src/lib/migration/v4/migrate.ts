import type { MetaBlob } from "@/lib/migration/schema";

export function migrateV4(meta: MetaBlob): MetaBlob {
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
