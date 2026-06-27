import { describe, it, expect, beforeEach, vi } from "vitest";
import { defaultOutline, assignChapter } from "@/lib/outline/model";

vi.mock("@/lib/tauri", () => ({
  compileProject: vi.fn(),
  openProject: vi.fn(),
  pickProjectDir: vi.fn(),
  readAppData: vi.fn().mockResolvedValue(null),
  readPdf: vi.fn().mockRejectedValue(new Error("no pdf")),
  readTextFile: vi.fn(),
  writeAppData: vi.fn().mockResolvedValue(undefined),
  writeTextFile: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { buildAiContext } from "@/lib/ai/context";
import { useProjectStore } from "@/stores/project-store";
import type { Block } from "@/lib/types";

const mk = (p: Partial<Block>): Block => ({
  id: "x",
  type: "narration",
  text: "t",
  raw: "",
  dirty: false,
  ...p,
});

beforeEach(() => {
  useProjectStore.setState({
    project: null,
    activeChapterId: null,
    selectedId: null,
    blocks: [],
  });
});

describe("buildAiContext", () => {
  it("includes a freeform break's own text, not a hardcoded separator", () => {
    useProjectStore.setState({
      blocks: [
        mk({ id: "n1", type: "narration", text: "Before." }),
        mk({ id: "brk", type: "chapter", level: "break", text: "Interlude" }),
      ],
    });
    expect(buildAiContext().blocksText).toBe("Before.\n\nInterlude");
  });

  it("falls back to the canonical separator for an empty break", () => {
    useProjectStore.setState({
      blocks: [mk({ id: "brk", type: "chapter", level: "break", text: "" })],
    });
    expect(buildAiContext().blocksText).toBe("* * *");
  });
});

describe("buildAiContext structure", () => {
  it("is undefined when the outline is untouched and the chapter is unlinked", () => {
    useProjectStore.setState({
      project: {
        root: "/p", name: "P", mainFile: "main.tex", title: "P", author: "A",
        metadata: { title: "P", subtitle: "", author: "A", publisher: "", isbn: "" },
        chapters: [{ id: "c1", label: "1", title: "One", file: "c1.tex", wordCount: 0 }],
      },
      activeChapterId: "c1",
      meta: { characters: [], lore: [], statuses: {}, outline: defaultOutline(), chapterBeats: {} },
      blocks: [mk({ id: "n1", type: "narration", text: "Hi." })],
      selectedId: "n1",
    });
    expect(buildAiContext().structure).toBeUndefined();
  });

  it("includes the served beat once the chapter is linked", () => {
    const o = assignChapter(defaultOutline(), "c1", defaultOutline().acts[1].beats[1].id);
    const beatId = o.acts[1].beats[1].id;
    const linked = assignChapter(o, "c1", beatId);
    useProjectStore.setState({
      project: {
        root: "/p", name: "P", mainFile: "main.tex", title: "P", author: "A",
        metadata: { title: "P", subtitle: "", author: "A", publisher: "", isbn: "" },
        chapters: [{ id: "c1", label: "1", title: "One", file: "c1.tex", wordCount: 0 }],
      },
      activeChapterId: "c1",
      meta: { characters: [], lore: [], statuses: {}, outline: linked, chapterBeats: {} },
      blocks: [mk({ id: "n1", type: "narration", text: "Hi." })],
      selectedId: "n1",
    });
    expect(buildAiContext().structure).toContain("It serves the beat");
  });
});
