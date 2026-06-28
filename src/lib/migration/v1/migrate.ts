// migration/v1/migrate.ts -- one-shot fold of legacy (act/beat) meta into the
// chapter model.
//
// Pure. Reads an untyped meta blob (any historical shape) and returns a valid,
// new-shape ProjectMeta. Lossy by design: structural beats that linked to no
// chapter have no chapter home and are dropped (accepted product decision).

import { emptyChapterOutline } from "@/lib/outline/model";
import { uid } from "@/lib/id";
import type {
  BeatType,
  Card,
  Character,
  ChapterOutline,
  ContinuityFlag,
  LoreEntry,
  ProjectMeta,
} from "@/lib/types";

interface LegacyBeat {
  title?: string;
  intention?: string;
  chapterIds?: string[];
  type?: BeatType;
  characterIds?: string[];
  loreIds?: string[];
  continuityFlags?: ContinuityFlag[];
}
interface LegacyAct {
  kind?: "setup" | "confrontation" | "resolution";
  beats?: LegacyBeat[];
}
interface LegacyOutline {
  premise?: string;
  acts?: LegacyAct[];
}
interface LegacyChapterBeat {
  goal?: string;
  conflict?: string;
  turn?: string;
}

/** True when the blob is already chapter-centric (has `chapters`, no `acts`/`chapterBeats`). */
export function isNewShapeMeta(m: Record<string, unknown> | null | undefined): boolean {
  if (!m) return false;
  const outline = m.outline as { acts?: unknown } | undefined;
  return Boolean(m.chapters) && !(outline && "acts" in outline) && !("chapterBeats" in m);
}

export function migrateLegacyMeta(raw: Record<string, unknown>): ProjectMeta {
  const legacyOutline = (raw.outline ?? {}) as LegacyOutline;
  const legacyBeats = (raw.chapterBeats ?? {}) as Record<string, LegacyChapterBeat>;
  const chapters: Record<string, ChapterOutline> = {};
  // Clone the empty template into a fresh, locally-owned object with its own
  // arrays: emptyChapterOutline() returns a shared stable reference, and the
  // mutations below (ch.cards.push, ch.goal = ...) must not leak into it.
  const ensure = (id: string): ChapterOutline =>
    (chapters[id] ??= { ...emptyChapterOutline(), characterIds: [], cards: [] });

  for (const [id, cb] of Object.entries(legacyBeats)) {
    const ch = ensure(id);
    ch.goal = cb.goal ?? "";
    ch.conflict = cb.conflict ?? "";
    ch.turn = cb.turn ?? "";
  }

  for (const act of legacyOutline.acts ?? []) {
    for (const beat of act.beats ?? []) {
      for (const chapterId of beat.chapterIds ?? []) {
        const ch = ensure(chapterId);
        if (act.kind) ch.act = act.kind;
        if (ch.plotPoint === null && beat.type) ch.plotPoint = beat.type;
        const card: Card = {
          id: uid("card"),
          title: beat.title ?? "",
          intention: beat.intention ?? "",
          characterIds: beat.characterIds ?? [],
          loreIds: beat.loreIds ?? [],
          continuityFlags: beat.continuityFlags ?? [],
        };
        ch.cards.push(card);
      }
    }
  }

  return {
    version: 1,
    characters: (raw.characters as Character[]) ?? [],
    lore: (raw.lore as LoreEntry[]) ?? [],
    statuses: (raw.statuses as ProjectMeta["statuses"]) ?? {},
    outline: { premise: legacyOutline.premise ?? "" },
    chapters,
  };
}

/** Migrate a blob to v1, handling both new-shape pass-through and legacy fold. */
export function migrateV1(meta: ProjectMeta): ProjectMeta {
  const raw = meta as unknown as Record<string, unknown>;
  if (isNewShapeMeta(raw)) {
    const chapters = meta.chapters ?? {};
    return {
      version: 1,
      characters: meta.characters ?? [],
      lore: meta.lore ?? [],
      statuses: meta.statuses ?? {},
      outline: { premise: meta.outline?.premise ?? "" },
      chapters: Object.fromEntries(
        Object.entries(chapters).map(([id, ch]) => [id, { ...ch, characterIds: ch.characterIds ?? [] }]),
      ),
    };
  }
  return migrateLegacyMeta(raw);
}