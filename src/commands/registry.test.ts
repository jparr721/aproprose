import { describe, it, expect, beforeEach } from "vitest";
import {
  STATIC_COMMANDS,
  buildPage,
  buildRootCommands,
  resolveStaticCommand,
} from "@/commands/registry";
import { useProjectStore } from "@/stores/project-store";
import type { ChapterRef, ProjectInfo } from "@/lib/types";

const chapter = (id: string, label: string, title: string): ChapterRef => ({
  id,
  label,
  title,
  file: `content/${id}.tex`,
  wordCount: 0,
});

const project = (chapters: ChapterRef[]): ProjectInfo => ({
  root: "/tmp/book",
  name: "Book",
  mainFile: "main.tex",
  title: null,
  author: null,
  chapters,
});

describe("command registry", () => {
  beforeEach(() => {
    useProjectStore.setState({ project: null, recents: [] });
  });

  it("has unique command ids", () => {
    const ids = STATIC_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every command is exactly a leaf (run) or a page-opener (page)", () => {
    for (const c of STATIC_COMMANDS) {
      const isLeaf = typeof c.run === "function";
      const isPage = typeof c.page === "string";
      expect(isLeaf).toBe(!isPage);
    }
  });

  it("resolves static commands by id but not dynamic nav targets", () => {
    expect(resolveStaticCommand("view.toggle-pdf")).toBeTruthy();
    expect(resolveStaticCommand("nav.chapter.anything")).toBeUndefined();
  });

  it("hides project-scoped commands when no project is open", () => {
    const ids = buildRootCommands().map((c) => c.id);
    expect(ids).not.toContain("nav.go-to-chapter");
    expect(ids).not.toContain("nav.switch-project");
    expect(ids).not.toContain("nav.close-project");
    // universally-valid commands are still present
    expect(ids).toContain("settings.theme-dark");
    expect(ids).toContain("window.minimize");
  });

  it("shows chapter navigation once a project with chapters is open", () => {
    useProjectStore.setState({ project: project([chapter("c1", "I", "Arrival")]) });
    expect(buildRootCommands().map((c) => c.id)).toContain("nav.go-to-chapter");
  });

  it("builds one command per chapter on the chapters page", () => {
    useProjectStore.setState({
      project: project([chapter("c1", "I", "Arrival"), chapter("c2", "II", "")]),
    });
    const titles = buildPage("chapters").map((c) => c.title);
    expect(titles).toEqual(["I - Arrival", "II"]);
  });

  it("disables Save & build while a compile is in flight", () => {
    useProjectStore.setState({
      project: project([chapter("c1", "I", "Arrival")]),
      compile: {
        status: "compiling",
        pdfBase64: null,
        log: "",
        errors: [],
        durationMs: 0,
        at: null,
      },
    });
    expect(buildRootCommands().map((c) => c.id)).not.toContain("doc.compile");
  });

  it("offers View build errors only after a failed build", () => {
    useProjectStore.setState({
      compile: {
        status: "clean",
        pdfBase64: null,
        log: "",
        errors: [],
        durationMs: 0,
        at: null,
      },
    });
    expect(buildRootCommands().map((c) => c.id)).not.toContain("doc.build-errors");

    useProjectStore.setState({
      compile: {
        status: "error",
        pdfBase64: null,
        log: "! Undefined control sequence",
        errors: [{ file: "main.tex", line: 12, message: "Undefined control sequence" }],
        durationMs: 5,
        at: 1,
      },
    });
    expect(buildRootCommands().map((c) => c.id)).toContain("doc.build-errors");
  });

  it("exposes every AI tab in the palette, including Edit", () => {
    const ids = STATIC_COMMANDS.map((c) => c.id);
    for (const tab of ["suggest", "edit", "critique", "brainstorm", "continuity"]) {
      expect(ids).toContain(`ai.tab-${tab}`);
    }
  });
});
