import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Tauri APIs before importing the store.
vi.mock("@/lib/tauri", () => ({
  compileProject: vi.fn(),
  openProject: vi.fn(),
  createProject: vi.fn(),
  writeSkeleton: vi.fn(),
  deleteChapterCmd: vi.fn(),
  migrateToManaged: vi.fn(),
  pickProjectDir: vi.fn(),
  readAppData: vi.fn().mockResolvedValue(null),
  readPdf: vi.fn().mockRejectedValue(new Error("no pdf")),
  readTextFile: vi.fn(),
  writeAppData: vi.fn().mockResolvedValue(undefined),
  writeTextFile: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

import { useProjectStore } from "@/stores/project-store";
import type { Block } from "@/lib/types";

const mkBlock = (p: Partial<Block> = {}): Block => ({
  id: Math.random().toString(36).slice(2),
  type: "narration",
  text: "Hello world",
  raw: "",
  dirty: false,
  ...p,
});

beforeEach(() => {
  useProjectStore.setState({
    blocks: [],
    selectedId: null,
    chapterDirty: false,
    past: [],
    future: [],
    lastTextEditId: null,
  });
});

describe("splitBlock", () => {
  it("splits a block mid-text and focuses the trailing piece", () => {
    const b = mkBlock({ text: "Hello world" });
    useProjectStore.setState({ blocks: [b], selectedId: b.id });

    useProjectStore.getState().splitBlock(b.id, 5);

    const { blocks, selectedId, past } = useProjectStore.getState();
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe("Hello");
    expect(blocks[1].text).toBe("world");
    expect(selectedId).toBe(blocks[1].id);
    expect(past).toHaveLength(1); // one history entry pushed
  });

  it("is a no-op when caret is at the edge (no history pushed)", () => {
    const b = mkBlock({ text: "Hello world" });
    useProjectStore.setState({ blocks: [b], selectedId: b.id, past: [] });

    useProjectStore.getState().splitBlock(b.id, 0);

    const { blocks, past } = useProjectStore.getState();
    expect(blocks).toHaveLength(1);
    expect(past).toHaveLength(0);
  });
});

describe("convertSelection", () => {
  it("collapses a whitespace-only selection to a split (no empty block)", () => {
    const b = mkBlock({ text: "one   two" });
    useProjectStore.setState({ blocks: [b] });

    useProjectStore.getState().convertSelection(b.id, 3, 6, "dialogue");

    const { blocks } = useProjectStore.getState();
    // whitespace-only → planCarve delegates to planSplit → 2 pieces, no empty dialogue block
    expect(blocks).toHaveLength(2);
    expect(blocks.every((p) => p.type === "narration")).toBe(true);
  });

  it("carves a real selection into a new block type", () => {
    const b = mkBlock({ text: "abc def ghi" });
    useProjectStore.setState({ blocks: [b] });

    useProjectStore.getState().convertSelection(b.id, 4, 7, "lore");

    const { blocks } = useProjectStore.getState();
    expect(blocks).toHaveLength(3);
    expect(blocks[1].type).toBe("lore");
    expect(blocks[1].text).toBe("def");
  });
});

describe("reorderBlock", () => {
  it("moves a block to a later position, keeps it selected, pushes one history entry", () => {
    const a = mkBlock({ id: "a" });
    const b = mkBlock({ id: "b" });
    const c = mkBlock({ id: "c" });
    const d = mkBlock({ id: "d" });
    useProjectStore.setState({ blocks: [a, b, c, d], selectedId: "a", past: [] });

    useProjectStore.getState().reorderBlock("a", "c");

    const { blocks, selectedId, past, chapterDirty } = useProjectStore.getState();
    expect(blocks.map((x) => x.id)).toEqual(["b", "c", "a", "d"]);
    expect(selectedId).toBe("a");
    expect(past).toHaveLength(1);
    expect(chapterDirty).toBe(true);
  });

  it("moves a block to an earlier position", () => {
    const a = mkBlock({ id: "a" });
    const b = mkBlock({ id: "b" });
    const c = mkBlock({ id: "c" });
    const d = mkBlock({ id: "d" });
    useProjectStore.setState({ blocks: [a, b, c, d], past: [] });

    useProjectStore.getState().reorderBlock("d", "b");

    expect(useProjectStore.getState().blocks.map((x) => x.id)).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  it("is a no-op when source and target are the same (no history)", () => {
    const a = mkBlock({ id: "a" });
    const b = mkBlock({ id: "b" });
    useProjectStore.setState({ blocks: [a, b], past: [], chapterDirty: false });

    useProjectStore.getState().reorderBlock("a", "a");

    const { blocks, past, chapterDirty } = useProjectStore.getState();
    expect(blocks.map((x) => x.id)).toEqual(["a", "b"]);
    expect(past).toHaveLength(0);
    expect(chapterDirty).toBe(false);
  });
});

describe("undo / redo", () => {
  it("round-trips a split through undo", () => {
    const b = mkBlock({ text: "Hello world" });
    useProjectStore.setState({ blocks: [b], selectedId: b.id, past: [], future: [] });

    useProjectStore.getState().splitBlock(b.id, 5);
    expect(useProjectStore.getState().blocks).toHaveLength(2);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().blocks).toHaveLength(1);
    expect(useProjectStore.getState().blocks[0]).toBe(b);
  });
});
