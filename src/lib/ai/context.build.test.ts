import { describe, it, expect, beforeEach, vi } from "vitest";

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

import { buildAiContext, buildScopedContext } from "@/lib/ai/context";
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

describe("buildScopedContext", () => {
  it("cursor scope stops at the selection; chapter scope reads the whole chapter", () => {
    useProjectStore.setState({
      blocks: [
        mk({ id: "n1", type: "narration", text: "First." }),
        mk({ id: "n2", type: "narration", text: "Second." }),
        mk({ id: "n3", type: "narration", text: "Third." }),
      ],
      selectedId: "n2",
    });
    expect(buildScopedContext("cursor").blocksText).toBe("First.\n\nSecond.");
    expect(buildScopedContext("chapter").blocksText).toBe(
      "First.\n\nSecond.\n\nThird.",
    );
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
      meta: {
        characters: [], lore: [], statuses: {},
        outline: { premise: "" },
        chapters: {},
      },
      blocks: [mk({ id: "n1", type: "narration", text: "Hi." })],
      selectedId: "n1",
    });
    expect(buildAiContext().structure).toBeUndefined();
  });

  it("includes act info once the chapter has an act assigned", () => {
    useProjectStore.setState({
      project: {
        root: "/p", name: "P", mainFile: "main.tex", title: "P", author: "A",
        metadata: { title: "P", subtitle: "", author: "A", publisher: "", isbn: "" },
        chapters: [{ id: "c1", label: "1", title: "One", file: "c1.tex", wordCount: 0 }],
      },
      activeChapterId: "c1",
      meta: {
        characters: [], lore: [], statuses: {},
        outline: { premise: "" },
        chapters: {
          c1: {
            act: "setup",
            plotPoint: null,
            premise: "",
            goal: "Introduce the protagonist",
            conflict: "",
            turn: "",
            characterIds: [],
            cards: [],
          },
        },
      },
      blocks: [mk({ id: "n1", type: "narration", text: "Hi." })],
      selectedId: "n1",
    });
    const structure = buildAiContext().structure;
    expect(structure).toContain("Act I");
    expect(structure).toContain("Goal: Introduce the protagonist");
  });
});
