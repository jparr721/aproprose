// @vitest-environment happy-dom
//
// Render-boundary + structure guard for the redesigned This-chapter card: it now
// builds from style-guide primitives (Card + Select) instead of hand-rolled divs.
// Mounting it proves the selectors are snapshot-stable (no infinite render loop)
// and that the beat picker renders as a real Select (role="combobox").

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

import { ThisChapterCard } from "@/components/app/outline/this-chapter-card";
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

describe("ThisChapterCard", () => {
  it("mounts without an infinite render loop and shows the three fields", () => {
    render(<ThisChapterCard />);
    expect(screen.getByText("This chapter")).toBeTruthy();
    expect(screen.getByText("Goal")).toBeTruthy();
    expect(screen.getByText("Conflict")).toBeTruthy();
    expect(screen.getByText("Turn")).toBeTruthy();
  });

  it("renders the beat assignment as a Select combobox", () => {
    render(<ThisChapterCard />);
    expect(screen.getByRole("combobox")).toBeTruthy();
  });

  it("renders nothing when no chapter is active", () => {
    useProjectStore.setState({ activeChapterId: null });
    const { container } = render(<ThisChapterCard />);
    expect(container.firstChild).toBeNull();
  });
});
