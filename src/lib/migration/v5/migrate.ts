import type { MetaBlob } from "@/lib/migration/schema";
import type { ProjectMeta } from "@/lib/types";

export function migrateV5(meta: MetaBlob): ProjectMeta {
  return {
    ...meta,
    version: 5,
    characters: meta.characters.map((character) => ({
      ...character,
      profile: character.profile,
    })),
    knowledge: meta.knowledge,
    chapters: meta.chapters ?? {},
  } as ProjectMeta;
}
