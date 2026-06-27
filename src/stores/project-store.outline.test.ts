import { describe, it, expect, beforeEach, vi } from "vitest";

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

import { useProjectStore } from "@/stores/project-store";
import { defaultOutline, beatForChapter } from "@/lib/outline/model";
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
