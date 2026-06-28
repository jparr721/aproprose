// model.ts -- pure chapter-centric outline operations.
//
// Mirrors src/lib/blocks/carve.ts: no I/O, no store access. Every function takes
// the chapters map (or an Outline) and returns NEW data, never mutating inputs.
// The store (project-store) wires these to persistence; the UI calls the store.

import { uid } from "@/lib/id";
import type {
  ActKind,
  BeatType,
  Card,
  ChapterOutline,
  ChapterRef,
  ContinuityFlag,
  Outline,
  SculptProposal,
} from "@/lib/types";

/** Three-act proportions: setup 25%, confrontation 50%, resolution 25%. */
export const ACT_TARGETS: Record<ActKind, number> = {
  setup: 0.25,
  confrontation: 0.5,
  resolution: 0.25,
};

export const ACT_ROMAN: Record<ActKind, string> = {
  setup: "I",
  confrontation: "II",
  resolution: "III",
};

export const ACT_TITLES: Record<ActKind, string> = {
  setup: "Setup",
  confrontation: "Confrontation",
  resolution: "Resolution",
};

export const ACT_ORDER: ActKind[] = ["setup", "confrontation", "resolution"];

type Chapters = Record<string, ChapterOutline>;

const _EMPTY_OUTLINE: ChapterOutline = {
  act: null,
  plotPoint: null,
  premise: "",
  goal: "",
  conflict: "",
  turn: "",
  characterIds: [],
  cards: [],
};

export function emptyChapterOutline(): ChapterOutline {
  return _EMPTY_OUTLINE;
}

/** The entry for a chapter, or a fresh empty one (never mutates the map). */
export function getChapterOutline(chapters: Chapters, chapterId: string): ChapterOutline {
  return chapters[chapterId] ?? emptyChapterOutline();
}

function updateChapter(
  chapters: Chapters,
  chapterId: string,
  fn: (ch: ChapterOutline) => ChapterOutline,
): Chapters {
  return { ...chapters, [chapterId]: fn(getChapterOutline(chapters, chapterId)) };
}

function emptyCard(): Card {
  return { id: uid("card"), title: "", intention: "", characterIds: [], loreIds: [], continuityFlags: [] };
}

export function addCard(chapters: Chapters, chapterId: string): { chapters: Chapters; cardId: string } {
  const card = emptyCard();
  return {
    chapters: updateChapter(chapters, chapterId, (ch) => ({ ...ch, cards: [...ch.cards, card] })),
    cardId: card.id,
  };
}

export function removeCard(chapters: Chapters, chapterId: string, cardId: string): Chapters {
  return updateChapter(chapters, chapterId, (ch) => ({
    ...ch,
    cards: ch.cards.filter((c) => c.id !== cardId),
  }));
}

function patchCard(
  chapters: Chapters,
  chapterId: string,
  cardId: string,
  fn: (card: Card) => Card,
): Chapters {
  return updateChapter(chapters, chapterId, (ch) => ({
    ...ch,
    cards: ch.cards.map((c) => (c.id === cardId ? fn(c) : c)),
  }));
}

export function editCard(
  chapters: Chapters,
  chapterId: string,
  cardId: string,
  patch: Partial<Pick<Card, "title" | "intention">>,
): Chapters {
  return patchCard(chapters, chapterId, cardId, (c) => ({ ...c, ...patch }));
}

export function moveCardWithin(
  chapters: Chapters,
  chapterId: string,
  cardId: string,
  toIndex: number,
): Chapters {
  const ch = chapters[chapterId];
  if (!ch) return chapters;
  const idx = ch.cards.findIndex((c) => c.id === cardId);
  if (idx < 0) return chapters;
  const cards = [...ch.cards];
  const [moved] = cards.splice(idx, 1);
  const clamped = Math.max(0, Math.min(toIndex, cards.length));
  cards.splice(clamped, 0, moved);
  return { ...chapters, [chapterId]: { ...ch, cards } };
}

/** Move a card from one chapter to another at a clamped index. Same-chapter
 *  moves delegate to moveCardWithin. No-op if the source card isn't found. */
export function moveCardToChapter(
  chapters: Chapters,
  fromChapterId: string,
  toChapterId: string,
  cardId: string,
  toIndex: number,
): Chapters {
  if (fromChapterId === toChapterId) return moveCardWithin(chapters, fromChapterId, cardId, toIndex);
  const from = chapters[fromChapterId];
  if (!from) return chapters;
  const card = from.cards.find((c) => c.id === cardId);
  if (!card) return chapters;
  const to = getChapterOutline(chapters, toChapterId);
  const cards = [...to.cards];
  const clamped = Math.max(0, Math.min(toIndex, cards.length));
  cards.splice(clamped, 0, card);
  return {
    ...chapters,
    [fromChapterId]: { ...from, cards: from.cards.filter((c) => c.id !== cardId) },
    [toChapterId]: { ...to, cards },
  };
}

export function addCharacterToCard(c: Chapters, chapterId: string, cardId: string, characterId: string): Chapters {
  return patchCard(c, chapterId, cardId, (card) =>
    card.characterIds.includes(characterId) ? card : { ...card, characterIds: [...card.characterIds, characterId] },
  );
}

export function removeCharacterFromCard(c: Chapters, chapterId: string, cardId: string, characterId: string): Chapters {
  return patchCard(c, chapterId, cardId, (card) => ({
    ...card, characterIds: card.characterIds.filter((id) => id !== characterId),
  }));
}

export function addLoreToCard(c: Chapters, chapterId: string, cardId: string, loreId: string): Chapters {
  return patchCard(c, chapterId, cardId, (card) =>
    card.loreIds.includes(loreId) ? card : { ...card, loreIds: [...card.loreIds, loreId] },
  );
}

export function removeLoreFromCard(c: Chapters, chapterId: string, cardId: string, loreId: string): Chapters {
  return patchCard(c, chapterId, cardId, (card) => ({
    ...card, loreIds: card.loreIds.filter((id) => id !== loreId),
  }));
}

export function setCardContinuityFlags(
  c: Chapters, chapterId: string, cardId: string, flags: ContinuityFlag[],
): Chapters {
  return patchCard(c, chapterId, cardId, (card) => ({ ...card, continuityFlags: [...flags] }));
}

export function addCharacterToChapter(chapters: Chapters, chapterId: string, characterId: string): Chapters {
  return updateChapter(chapters, chapterId, (ch) =>
    ch.characterIds.includes(characterId) ? ch : { ...ch, characterIds: [...ch.characterIds, characterId] },
  );
}

export function removeCharacterFromChapter(chapters: Chapters, chapterId: string, characterId: string): Chapters {
  return updateChapter(chapters, chapterId, (ch) => ({
    ...ch, characterIds: ch.characterIds.filter((id) => id !== characterId),
  }));
}

export function setChapterAct(chapters: Chapters, chapterId: string, act: ActKind | null): Chapters {
  return updateChapter(chapters, chapterId, (ch) => ({ ...ch, act }));
}

export function setChapterPlotPoint(chapters: Chapters, chapterId: string, plotPoint: BeatType | null): Chapters {
  return updateChapter(chapters, chapterId, (ch) => ({ ...ch, plotPoint }));
}

export function editChapterField(
  chapters: Chapters,
  chapterId: string,
  patch: Partial<Pick<ChapterOutline, "premise" | "goal" | "conflict" | "turn">>,
): Chapters {
  return updateChapter(chapters, chapterId, (ch) => ({ ...ch, ...patch }));
}

export function editPremise(outline: Outline, premise: string): Outline {
  return { ...outline, premise };
}

export interface ActPacing {
  actualShare: number;
  targetShare: number;
  words: number;
}

/** Word-count share per act, summed across chapters that have an act assigned.
 *  Shares are over PLACED chapters so the three sum to 1; unassigned chapters
 *  contribute to neither. */
export function actPacing(chapters: Chapters, chapterRefs: ChapterRef[]): Record<ActKind, ActPacing> {
  const words: Record<ActKind, number> = { setup: 0, confrontation: 0, resolution: 0 };
  let total = 0;
  for (const ref of chapterRefs) {
    const act = chapters[ref.id]?.act ?? null;
    if (act) {
      words[act] += ref.wordCount;
      total += ref.wordCount;
    }
  }
  const out = {} as Record<ActKind, ActPacing>;
  for (const kind of ACT_ORDER) {
    out[kind] = {
      words: words[kind],
      actualShare: total > 0 ? words[kind] / total : 0,
      targetShare: ACT_TARGETS[kind],
    };
  }
  return out;
}

/**
 * Fold a sculpt proposal's KEPT changes into one chapter's cards, in proposal
 * order, by delegating to the same pure card editors the manual UI uses. A
 * skipped change is a no-op; a change targeting a card that no longer exists is
 * skipped defensively. Pure: returns a new chapters map.
 */
export function applySculpt(
  chapters: Chapters,
  chapterId: string,
  proposal: SculptProposal,
  kept: number[],
): Chapters {
  const keptSet = new Set(kept);
  return proposal.changes.reduce((acc, change, index) => {
    if (!keptSet.has(index)) return acc;
    const cards = acc[chapterId]?.cards ?? [];
    const exists = (id: string) => cards.some((c) => c.id === id);
    switch (change.kind) {
      case "rewrite": {
        if (change.cardId === null || !exists(change.cardId)) return acc;
        const patch: Partial<Pick<Card, "title" | "intention">> = {};
        if (change.title !== null) patch.title = change.title;
        if (change.intention !== null) patch.intention = change.intention;
        return editCard(acc, chapterId, change.cardId, patch);
      }
      case "add": {
        const { chapters: added, cardId } = addCard(acc, chapterId);
        const patch: Partial<Pick<Card, "title" | "intention">> = {};
        if (change.title !== null) patch.title = change.title;
        if (change.intention !== null) patch.intention = change.intention;
        return editCard(added, chapterId, cardId, patch);
      }
      case "move": {
        if (change.cardId === null || change.toIndex === null || !exists(change.cardId)) return acc;
        return moveCardWithin(acc, chapterId, change.cardId, change.toIndex);
      }
      case "remove": {
        if (change.cardId === null || !exists(change.cardId)) return acc;
        return removeCard(acc, chapterId, change.cardId);
      }
    }
  }, chapters);
}
