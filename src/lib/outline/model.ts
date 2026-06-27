// model.ts -- pure outline data operations.
//
// Mirrors src/lib/blocks/carve.ts: no I/O, no store access. Every function takes
// an Outline (and maybe chapters) and returns NEW data, never mutating inputs.
// The store (project-store) wires these to persistence; the UI calls the store.

import { uid } from "@/lib/id";
import type {
  ActKind,
  Beat,
  BeatType,
  ChapterRef,
  ContinuityFlag,
  Outline,
  OutlineAct,
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

const ACT_TITLES: Record<ActKind, string> = {
  setup: "Setup",
  confrontation: "Confrontation",
  resolution: "Resolution",
};

const SEED: Record<ActKind, { title: string; intention: string; type: BeatType }[]> = {
  setup: [
    {
      title: "Opening Image",
      intention:
        "Establish the ordinary world and the protagonist's normal before anything breaks.",
      type: "plot-point",
    },
    {
      title: "Inciting Incident",
      intention:
        "The disruption that shatters the normal and pulls the protagonist into the story (often around 10-15%).",
      type: "inciting",
    },
    {
      title: "Plot Point 1",
      intention:
        "The protagonist commits to the central problem and the door closes behind them; Act II begins (~25%).",
      type: "plot-point",
    },
  ],
  confrontation: [
    {
      title: "Rising Action",
      intention:
        "Escalating complications as the protagonist struggles with the problem; each turn costs something.",
      type: "action",
    },
    {
      title: "Midpoint",
      intention:
        "A major revelation or reversal that raises the stakes and changes the protagonist's approach (~50%).",
      type: "midpoint",
    },
    {
      title: "Plot Point 2",
      intention:
        "The lowest point or biggest turn that launches the finale - the hinge into Act III (~75%).",
      type: "plot-point",
    },
  ],
  resolution: [
    {
      title: "Climax",
      intention: "The protagonist faces the central problem head-on, on its terms.",
      type: "climax",
    },
    {
      title: "Resolution",
      intention: "The aftermath - what has changed, and what the ending leaves behind.",
      type: "resolution",
    },
  ],
};

const ACT_ORDER: ActKind[] = ["setup", "confrontation", "resolution"];

function seedAct(kind: ActKind): OutlineAct {
  return {
    kind,
    title: ACT_TITLES[kind],
    summary: "",
    beats: SEED[kind].map((b) => ({
      id: uid("b"),
      title: b.title,
      intention: b.intention,
      chapterIds: [],
      type: b.type,
      characterIds: [],
      loreIds: [],
      continuityFlags: [],
    })),
  };
}

export function defaultOutline(): Outline {
  return {
    premise: "",
    acts: [seedAct("setup"), seedAct("confrontation"), seedAct("resolution")],
  };
}

export function beatForChapter(
  outline: Outline,
  chapterId: string,
): { act: OutlineAct; beat: Beat } | null {
  for (const act of outline.acts) {
    for (const beat of act.beats) {
      if (beat.chapterIds.includes(chapterId)) return { act, beat };
    }
  }
  return null;
}

/** Map over acts/beats producing a new Outline; helper for the editors below. */
function mapBeats(outline: Outline, fn: (beat: Beat, act: OutlineAct) => Beat): Outline {
  return {
    ...outline,
    acts: outline.acts.map((act) => ({
      ...act,
      beats: act.beats.map((beat) => fn(beat, act)),
    })) as Outline["acts"],
  };
}

/** Remove a chapter id from every beat. */
export function unassignChapter(outline: Outline, chapterId: string): Outline {
  return mapBeats(outline, (beat) =>
    beat.chapterIds.includes(chapterId)
      ? { ...beat, chapterIds: beat.chapterIds.filter((id) => id !== chapterId) }
      : beat,
  );
}

/** Link a chapter to one beat, first removing it from any other beat. */
export function assignChapter(outline: Outline, chapterId: string, beatId: string): Outline {
  const cleared = unassignChapter(outline, chapterId);
  return mapBeats(cleared, (beat) =>
    beat.id === beatId ? { ...beat, chapterIds: [...beat.chapterIds, chapterId] } : beat,
  );
}

export function addBeat(
  outline: Outline,
  actKind: ActKind,
  afterBeatId: string | null,
): { outline: Outline; beatId: string } {
  const beat: Beat = {
    id: uid("b"),
    title: "New beat",
    intention: "",
    chapterIds: [],
    type: "action",
    characterIds: [],
    loreIds: [],
    continuityFlags: [],
  };
  const acts = outline.acts.map((act) => {
    if (act.kind !== actKind) return act;
    const idx = afterBeatId ? act.beats.findIndex((b) => b.id === afterBeatId) : -1;
    const beats = [...act.beats];
    beats.splice(idx >= 0 ? idx + 1 : beats.length, 0, beat);
    return { ...act, beats };
  }) as Outline["acts"];
  return { outline: { ...outline, acts }, beatId: beat.id };
}

export function removeBeat(outline: Outline, beatId: string): Outline {
  return {
    ...outline,
    acts: outline.acts.map((act) => ({
      ...act,
      beats: act.beats.filter((b) => b.id !== beatId),
    })) as Outline["acts"],
  };
}

export function moveBeat(outline: Outline, beatId: string, dir: -1 | 1): Outline {
  return {
    ...outline,
    acts: outline.acts.map((act) => {
      const idx = act.beats.findIndex((b) => b.id === beatId);
      if (idx < 0) return act;
      const to = idx + dir;
      if (to < 0 || to >= act.beats.length) return act; // clamp
      const beats = [...act.beats];
      const [moved] = beats.splice(idx, 1);
      beats.splice(to, 0, moved);
      return { ...act, beats };
    }) as Outline["acts"],
  };
}

export function editBeat(
  outline: Outline,
  beatId: string,
  patch: Partial<Pick<Beat, "title" | "intention">>,
): Outline {
  return mapBeats(outline, (beat) => (beat.id === beatId ? { ...beat, ...patch } : beat));
}

export function setBeatType(outline: Outline, beatId: string, type: BeatType): Outline {
  return mapBeats(outline, (beat) => (beat.id === beatId ? { ...beat, type } : beat));
}

export function addCharacterToBeat(
  outline: Outline,
  beatId: string,
  characterId: string,
): Outline {
  return mapBeats(outline, (beat) =>
    beat.id === beatId && !beat.characterIds.includes(characterId)
      ? { ...beat, characterIds: [...beat.characterIds, characterId] }
      : beat,
  );
}

export function removeCharacterFromBeat(
  outline: Outline,
  beatId: string,
  characterId: string,
): Outline {
  return mapBeats(outline, (beat) =>
    beat.id === beatId
      ? { ...beat, characterIds: beat.characterIds.filter((id) => id !== characterId) }
      : beat,
  );
}

export function addLoreToBeat(outline: Outline, beatId: string, loreId: string): Outline {
  return mapBeats(outline, (beat) =>
    beat.id === beatId && !beat.loreIds.includes(loreId)
      ? { ...beat, loreIds: [...beat.loreIds, loreId] }
      : beat,
  );
}

export function removeLoreFromBeat(outline: Outline, beatId: string, loreId: string): Outline {
  return mapBeats(outline, (beat) =>
    beat.id === beatId
      ? { ...beat, loreIds: beat.loreIds.filter((id) => id !== loreId) }
      : beat,
  );
}

export function setBeatContinuityFlags(
  outline: Outline,
  beatId: string,
  flags: ContinuityFlag[],
): Outline {
  return mapBeats(outline, (beat) =>
    beat.id === beatId ? { ...beat, continuityFlags: flags } : beat,
  );
}

export function editPremise(outline: Outline, premise: string): Outline {
  return { ...outline, premise };
}

function editAct(outline: Outline, actKind: ActKind, patch: Partial<OutlineAct>): Outline {
  return {
    ...outline,
    acts: outline.acts.map((act) =>
      act.kind === actKind ? { ...act, ...patch } : act,
    ) as Outline["acts"],
  };
}

export function editActSummary(outline: Outline, actKind: ActKind, summary: string): Outline {
  return editAct(outline, actKind, { summary });
}

export function editActTitle(outline: Outline, actKind: ActKind, title: string): Outline {
  return editAct(outline, actKind, { title });
}

export interface ActPacing {
  actualShare: number;
  targetShare: number;
  words: number;
}

export function actPacing(
  outline: Outline,
  chapters: ChapterRef[],
): Record<ActKind, ActPacing> {
  const wordsById = new Map(chapters.map((c) => [c.id, c.wordCount]));
  const actWords = (act: OutlineAct): number =>
    act.beats.reduce(
      (sum, beat) =>
        sum + beat.chapterIds.reduce((s, id) => s + (wordsById.get(id) ?? 0), 0),
      0,
    );
  const perAct = outline.acts.map((act) => [act.kind, actWords(act)] as const);
  const total = perAct.reduce((s, [, w]) => s + w, 0);
  const out = {} as Record<ActKind, ActPacing>;
  for (const kind of ACT_ORDER) {
    const words = perAct.find(([k]) => k === kind)?.[1] ?? 0;
    out[kind] = {
      words,
      actualShare: total > 0 ? words / total : 0,
      targetShare: ACT_TARGETS[kind],
    };
  }
  return out;
}

export function unplacedChapters(outline: Outline, chapters: ChapterRef[]): ChapterRef[] {
  const linked = new Set(
    outline.acts.flatMap((act) => act.beats.flatMap((b) => b.chapterIds)),
  );
  return chapters.filter((c) => !linked.has(c.id));
}
