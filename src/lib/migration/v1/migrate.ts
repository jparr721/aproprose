// migration/v1/migrate.ts — one-shot fold of legacy (act/beat) meta into the
// chapter model.
//
// Pure. Reads a validated MetaBlob (from schema.ts) and returns a valid,
// new-shape ProjectMeta. Lossy by design: structural beats that linked to no
// chapter have no chapter home and are dropped (accepted product decision).
//
// Both migrateLegacyMeta (the act/beat fold) and the new-shape pass-through
// branch are preserved. The pass-through is critical: migrateLegacyMeta is
// destructive on new-shape data, building chapters only from legacyBeats/acts.
// Feeding it a chapter-centric project returns chapters: {}, erasing all of
// the user's chapters.

import { emptyChapterOutline } from "@/lib/outline/model";
import { uid } from "@/lib/id";
import type { MetaBlob } from "@/lib/migration/schema";
import type {
  Card,
  ChapterOutline,
  ProjectMeta,
} from "@/lib/types";

/** True when the blob is already chapter-centric (has `chapters` present,
 *  no `acts`/`chapterBeats`). Structural check only — ignores version field
 *  by design, since a buggy prior migration could stamp version without
 *  transforming shape. */
export function isNewShapeMeta(m: MetaBlob): boolean {
  const hasActs = m.outline && "acts" in m.outline && m.outline.acts !== undefined;
  const hasChapterBeats = "chapterBeats" in m;
  return m.chapters !== undefined && !hasActs && !hasChapterBeats;
}

export function migrateLegacyMeta(m: MetaBlob): ProjectMeta {
  const chapters: Record<string, ChapterOutline> = {};
  const ensure = (id: string): ChapterOutline =>
    (chapters[id] ??= { ...emptyChapterOutline(), characterIds: [], cards: [] });

  for (const [id, cb] of Object.entries(m.chapterBeats ?? {})) {
    const ch = ensure(id);
    ch.goal = cb.goal ?? "";
    ch.conflict = cb.conflict ?? "";
    ch.turn = cb.turn ?? "";
  }

  for (const act of m.outline?.acts ?? []) {
    for (const beat of act.beats ?? []) {
      for (const chapterId of beat.chapterIds) {
        const ch = ensure(chapterId);
        if (act.kind) ch.act = act.kind;
        if (ch.plotPoint === null && beat.type) ch.plotPoint = beat.type;
        const card: Card = {
          id: uid("card"),
          title: beat.title,
          intention: beat.intention,
          characterIds: beat.characterIds,
          loreIds: beat.loreIds,
          continuityFlags: beat.continuityFlags,
        };
        ch.cards.push(card);
      }
    }
  }

  return {
    version: 1,
    characters: m.characters,
    lore: m.lore,
    statuses: m.statuses,
    outline: { premise: m.outline?.premise ?? "" },
    chapters,
  };
}

export function migrateV1(meta: MetaBlob): ProjectMeta {
  if (isNewShapeMeta(meta)) {
    const chapters = meta.chapters ?? {};
    return {
      version: 1,
      characters: meta.characters,
      lore: meta.lore,
      statuses: meta.statuses,
      outline: { premise: meta.outline?.premise ?? "" },
      chapters: Object.fromEntries(
        Object.entries(chapters).map(([id, ch]) => [id, { ...ch, characterIds: ch.characterIds ?? [] }]),
      ),
    };
  }
  return migrateLegacyMeta(meta);
}