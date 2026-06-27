// @vitest-environment happy-dom
//
// Render-boundary guard: a zustand selector that returns a freshly-built object
// or array on every call violates useSyncExternalStore's Object.is snapshot
// contract and sends React into an infinite render loop ("The result of
// getSnapshot should be cached"). Pure unit tests cannot catch it -- only
// actually mounting the component does. This test mounts the act spine and
// fails (throws "Maximum update depth exceeded") if any selector is unstable.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

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

import { ActSection } from "@/components/app/outline/act-section";
import { useProjectStore } from "@/stores/project-store";
import { defaultOutline } from "@/lib/outline/model";
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

afterEach(() => cleanup());

describe("ActSection", () => {
  it("mounts without an infinite render loop", () => {
    render(<ActSection actKind="setup" />);
    expect(screen.getByText("Add beat")).toBeTruthy();
  });

  it("mounts when no project is loaded (chapters absent)", () => {
    useProjectStore.setState({ project: null });
    render(<ActSection actKind="confrontation" />);
    expect(screen.getByText("Add beat")).toBeTruthy();
  });
});
