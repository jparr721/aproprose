import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SculptProposal } from "@/lib/types";

vi.mock("@/lib/tauri", () => ({
  compileProject: vi.fn(),
  createProject: vi.fn(),
  deleteChapterCmd: vi.fn(),
  migrateToManaged: vi.fn(),
  openProject: vi.fn(),
  pickProjectDir: vi.fn(),
  readAppData: vi.fn().mockResolvedValue(null),
  readPdf: vi.fn().mockRejectedValue(new Error("no pdf")),
  readProjectMeta: vi.fn().mockResolvedValue(null),
  readTextFile: vi.fn(),
  writeAppData: vi.fn().mockResolvedValue(undefined),
  writeProjectMeta: vi.fn().mockResolvedValue(undefined),
  writeSkeleton: vi.fn(),
  writeTextFile: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useProjectStore, normalizeMeta } from "@/stores/project-store";
import { defaultOutline, beatForChapter } from "@/lib/outline/model";
import { beatTypeFromTitle } from "@/lib/outline/beat-types";
import { deleteChapterCmd } from "@/lib/tauri";
import type { ChapterRef, ProjectInfo } from "@/lib/types";

const chapter = (id: string): ChapterRef => ({
  id,
  label: id,
  title: id,
  file: `${id}.tex`,
  wordCount: 100,
});

const fakeProject = (ids: string[]): ProjectInfo => ({
  root: "/p",
  name: "P",
  mainFile: "main.tex",
  title: "P",
  author: "A",
  metadata: { title: "P", subtitle: "", author: "A", publisher: "", isbn: "" },
  chapters: ids.map(chapter),
});

beforeEach(() => {
  useProjectStore.setState({
    project: fakeProject(["c1", "c2"]),
    meta: {
      characters: [],
      lore: [],
      statuses: {},
      outline: defaultOutline(),
      chapterBeats: {},
    },
    activeChapterId: "c1",
  });
});

describe("project-store outline actions", () => {
  it("setPremise updates the outline", () => {
    useProjectStore.getState().setPremise("A logline.");
    expect(useProjectStore.getState().meta.outline.premise).toBe("A logline.");
  });

  it("assignChapterToBeat enforces one beat per chapter", () => {
    const o = useProjectStore.getState().meta.outline;
    const first = o.acts[0].beats[0].id;
    const second = o.acts[1].beats[0].id;
    useProjectStore.getState().assignChapterToBeat("c1", first);
    useProjectStore.getState().assignChapterToBeat("c1", second);
    const meta = useProjectStore.getState().meta;
    expect(beatForChapter(meta.outline, "c1")?.beat.id).toBe(second);
  });

  it("setChapterBeat merges patch fields", () => {
    useProjectStore.getState().setChapterBeat("c1", { goal: "Find the room." });
    useProjectStore.getState().setChapterBeat("c1", { conflict: "It is locked." });
    expect(useProjectStore.getState().meta.chapterBeats.c1).toEqual({
      goal: "Find the room.",
      conflict: "It is locked.",
      turn: "",
    });
  });

  it("addBeat returns the new id and inserts after the given beat", () => {
    const o = useProjectStore.getState().meta.outline;
    const after = o.acts[0].beats[0].id;
    const id = useProjectStore.getState().addBeat("setup", after);
    const beats = useProjectStore.getState().meta.outline.acts[0].beats;
    expect(beats[1].id).toBe(id);
  });

  it("setBeatType updates a beat's type", () => {
    const id = useProjectStore.getState().meta.outline.acts[0].beats[0].id;
    useProjectStore.getState().setBeatType(id, "climax");
    expect(
      useProjectStore.getState().meta.outline.acts[0].beats[0].type,
    ).toBe("climax");
  });

  it("addCharacterToBeat is idempotent and removeCharacterFromBeat clears it", () => {
    const id = useProjectStore.getState().meta.outline.acts[0].beats[0].id;
    useProjectStore.getState().addCharacterToBeat(id, "ch1");
    useProjectStore.getState().addCharacterToBeat(id, "ch1");
    expect(
      useProjectStore.getState().meta.outline.acts[0].beats[0].characterIds,
    ).toEqual(["ch1"]);
    useProjectStore.getState().removeCharacterFromBeat(id, "ch1");
    expect(
      useProjectStore.getState().meta.outline.acts[0].beats[0].characterIds,
    ).toEqual([]);
  });

  it("addLoreToBeat / removeLoreFromBeat round-trips", () => {
    const id = useProjectStore.getState().meta.outline.acts[0].beats[0].id;
    useProjectStore.getState().addLoreToBeat(id, "l1");
    expect(
      useProjectStore.getState().meta.outline.acts[0].beats[0].loreIds,
    ).toEqual(["l1"]);
    useProjectStore.getState().removeLoreFromBeat(id, "l1");
    expect(
      useProjectStore.getState().meta.outline.acts[0].beats[0].loreIds,
    ).toEqual([]);
  });

  it("setBeatContinuityFlags replaces the flags", () => {
    const id = useProjectStore.getState().meta.outline.acts[0].beats[0].id;
    useProjectStore.getState().setBeatContinuityFlags(id, [
      { sev: "flag", tag: "Cast", text: "Two characters in two places." },
    ]);
    expect(
      useProjectStore.getState().meta.outline.acts[0].beats[0].continuityFlags,
    ).toHaveLength(1);
  });

  it("moveBeatTo moves a beat across acts", () => {
    const id = useProjectStore.getState().meta.outline.acts[0].beats[0].id;
    useProjectStore.getState().moveBeatTo(id, "resolution", 0);
    const outline = useProjectStore.getState().meta.outline;
    expect(outline.acts[0].beats.find((b) => b.id === id)).toBeUndefined();
    expect(outline.acts[2].beats[0].id).toBe(id);
  });
});

describe("deleteChapter cleanup", () => {
  it("drops the deleted chapter's outline links and chapter beat", async () => {
    const o = useProjectStore.getState().meta.outline;
    const beatId = o.acts[0].beats[0].id;
    useProjectStore.getState().assignChapterToBeat("c2", beatId);
    useProjectStore.getState().setChapterBeat("c2", { goal: "x" });
    vi.mocked(deleteChapterCmd).mockResolvedValue(fakeProject(["c1"]));

    await useProjectStore.getState().deleteChapter("c2");

    const meta = useProjectStore.getState().meta;
    expect(beatForChapter(meta.outline, "c2")).toBeNull();
    expect(meta.chapterBeats.c2).toBeUndefined();
  });
});

describe("store.applySculpt", () => {
  it("applies kept changes through the model and persists meta", () => {
    const store = useProjectStore.getState();
    const setupAct = store.meta.outline.acts[0];
    const rewriteId = setupAct.beats[0].id;
    const proposal: SculptProposal = {
      actKind: "setup",
      summary: "Tighten.",
      changes: [
        {
          kind: "rewrite",
          beatId: rewriteId,
          title: "Cold Open",
          intention: "Mid-action.",
          type: "inciting",
          toIndex: null,
          reason: "Hook faster.",
        },
        {
          kind: "remove",
          beatId: setupAct.beats[1].id,
          title: null,
          intention: null,
          type: null,
          toIndex: null,
          reason: "Cut.",
        },
      ],
    };

    // Keep only the rewrite (index 0).
    store.applySculpt(proposal, [0]);

    const after = useProjectStore.getState().meta.outline.acts[0];
    expect(after.beats.find((b) => b.id === rewriteId)?.title).toBe("Cold Open");
    expect(after.beats.find((b) => b.id === rewriteId)?.type).toBe("inciting");
    // skipped remove left the beat in place
    expect(after.beats.find((b) => b.id === setupAct.beats[1].id)).toBeDefined();
  });
});

describe("normalizeMeta backfill", () => {
  it("backfills the 4 new fields on every beat of a legacy meta", () => {
    // A legacy meta: every beat lacks type/characterIds/loreIds/continuityFlags.
    const legacy = defaultOutline();
    const stripped = {
      ...legacy,
      acts: legacy.acts.map((a) => ({
        ...a,
        beats: a.beats.map((b) => ({
          id: b.id,
          title: b.title,
          intention: b.intention,
          chapterIds: b.chapterIds,
        })),
      })),
    };
    const normalized = normalizeMeta({
      characters: [],
      lore: [],
      statuses: {},
      outline: stripped as typeof legacy,
      chapterBeats: {},
    });
    for (const act of normalized.outline.acts) {
      for (const beat of act.beats) {
        expect(beat.type).toBe(beatTypeFromTitle(beat.title));
        expect(beat.characterIds).toEqual([]);
        expect(beat.loreIds).toEqual([]);
        expect(beat.continuityFlags).toEqual([]);
      }
    }
  });

  it("preserves existing beat fields and does not drop data", () => {
    const meta = normalizeMeta({
      characters: [{ id: "c1", name: "Ada", color: "oklch(0 0 0)", role: "" }],
      lore: [],
      statuses: { ch1: "draft" },
      outline: defaultOutline(),
      chapterBeats: { ch1: { goal: "g", conflict: "c", turn: "t" } },
    });
    expect(meta.characters).toHaveLength(1);
    expect(meta.statuses.ch1).toBe("draft");
    expect(meta.chapterBeats.ch1.goal).toBe("g");
    const first = meta.outline.acts[0].beats[0];
    expect(first.type).toBe("plot-point");
  });
});
