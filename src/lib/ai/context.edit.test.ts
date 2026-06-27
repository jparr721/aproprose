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

import { buildEditRequest } from "@/lib/ai/context";
import { useProjectStore } from "@/stores/project-store";
import type { Block, ProjectInfo } from "@/lib/types";

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
    blocks: [
      mk({ id: "n1", type: "narration", text: "Narr one" }),
      mk({ id: "d1", type: "dialogue", text: "Hi there" }),
      mk({ id: "c1", type: "chapter", level: "scene", text: "Scene" }),
      mk({ id: "brk", type: "chapter", level: "break", text: "" }),
      mk({ id: "lore1", type: "lore", text: "secret" }),
      mk({ id: "scr1", type: "scratchpad", text: "todo" }),
      mk({ id: "tex1", type: "latex", text: "\\noindent" }),
    ],
  });
});

describe("buildEditRequest", () => {
  it("chapter scope keeps only rendered prose (narration/dialogue/scene)", () => {
    const req = buildEditRequest("chapter", "fix typos");
    expect(req.blocks.map((b) => b.id)).toEqual(["n1", "d1", "c1"]);
    expect(req.instruction).toBe("fix typos");
  });

  it("block scope returns only the selected eligible block", () => {
    useProjectStore.setState({ selectedId: "d1" });
    expect(buildEditRequest("block", "x").blocks.map((b) => b.id)).toEqual(["d1"]);
  });

  it("block scope returns empty when the selected block is ineligible", () => {
    useProjectStore.setState({ selectedId: "lore1" });
    expect(buildEditRequest("block", "x").blocks).toEqual([]);
  });

  it("block scope returns empty when nothing is selected", () => {
    useProjectStore.setState({ selectedId: null });
    expect(buildEditRequest("block", "x").blocks).toEqual([]);
  });

  it("block scope targets the multi-selection set when present, in document order", () => {
    useProjectStore.setState({ selectedId: "c1", selectedIds: ["c1", "n1", "d1"] });
    expect(buildEditRequest("block", "x").blocks.map((b) => b.id)).toEqual([
      "n1",
      "d1",
      "c1",
    ]);
  });

  it("block scope drops non-editable members of the multi-selection", () => {
    useProjectStore.setState({ selectedId: "lore1", selectedIds: ["n1", "lore1", "tex1"] });
    expect(buildEditRequest("block", "x").blocks.map((b) => b.id)).toEqual(["n1"]);
  });

  it("block scope falls back to the single selection when the set is empty", () => {
    useProjectStore.setState({ selectedId: "d1", selectedIds: [] });
    expect(buildEditRequest("block", "x").blocks.map((b) => b.id)).toEqual(["d1"]);
  });

  it("forwards the active chapter title and cast to the request", () => {
    useProjectStore.setState({
      project: { chapters: [{ id: "ch1", title: "The Gate" }] } as unknown as ProjectInfo,
      activeChapterId: "ch1",
      selectedId: "n1",
      meta: {
        ...useProjectStore.getState().meta,
        characters: [{ id: "c1", name: "Mara", color: "oklch(0.7 0.1 30)", role: "PI" }],
      },
    });
    const req = buildEditRequest("block", "tighten");
    expect(req.chapterTitle).toBe("The Gate");
    expect(req.characters).toEqual([{ name: "Mara", role: "PI" }]);
  });
});
