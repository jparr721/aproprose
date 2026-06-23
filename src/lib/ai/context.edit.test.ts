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
});
