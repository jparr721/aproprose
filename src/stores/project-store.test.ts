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
    editing: false,
    editCaret: null,
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

describe("modal selection / editing", () => {
  it("select highlights a block in nav mode (not editing)", () => {
    const a = mkBlock({ id: "a" });
    useProjectStore.setState({ blocks: [a], selectedId: null, editing: true });

    useProjectStore.getState().select("a");

    const { selectedId, editing, editCaret } = useProjectStore.getState();
    expect(selectedId).toBe("a");
    expect(editing).toBe(false);
    expect(editCaret).toBeNull();
  });

  it("beginEdit enters edit mode on the selected editable block", () => {
    const a = mkBlock({ id: "a" });
    useProjectStore.setState({ blocks: [a], selectedId: "a", editing: false });

    useProjectStore.getState().beginEdit();

    expect(useProjectStore.getState().editing).toBe(true);
    expect(useProjectStore.getState().editCaret).toBeNull();
  });

  it("beginEdit('start') requests the caret at the start", () => {
    const a = mkBlock({ id: "a" });
    useProjectStore.setState({ blocks: [a], selectedId: "a", editing: false });

    useProjectStore.getState().beginEdit("start");

    expect(useProjectStore.getState().editing).toBe(true);
    expect(useProjectStore.getState().editCaret).toBe("start");
  });

  it("beginEdit enters edit mode on a chapter break", () => {
    const brk = mkBlock({ id: "b", type: "chapter", level: "break", text: "" });
    useProjectStore.setState({ blocks: [brk], selectedId: "b", editing: false });

    useProjectStore.getState().beginEdit();

    expect(useProjectStore.getState().editing).toBe(true);
  });

  it("beginEdit is a no-op when nothing is selected", () => {
    const a = mkBlock({ id: "a" });
    useProjectStore.setState({ blocks: [a], selectedId: null, editing: false });

    useProjectStore.getState().beginEdit();

    expect(useProjectStore.getState().editing).toBe(false);
  });

  it("stopEdit exits edit mode but keeps the selection", () => {
    const a = mkBlock({ id: "a" });
    useProjectStore.setState({ blocks: [a], selectedId: "a", editing: true, editCaret: "start" });

    useProjectStore.getState().stopEdit();

    const { selectedId, editing, editCaret } = useProjectStore.getState();
    expect(selectedId).toBe("a");
    expect(editing).toBe(false);
    expect(editCaret).toBeNull();
  });

  it("deselect clears both the selection and editing", () => {
    const a = mkBlock({ id: "a" });
    useProjectStore.setState({ blocks: [a], selectedId: "a", editing: true });

    useProjectStore.getState().deselect();

    const { selectedId, editing } = useProjectStore.getState();
    expect(selectedId).toBeNull();
    expect(editing).toBe(false);
  });

  it("moveSelection moves to the next/previous block in nav mode", () => {
    const a = mkBlock({ id: "a" });
    const b = mkBlock({ id: "b" });
    const c = mkBlock({ id: "c" });
    useProjectStore.setState({ blocks: [a, b, c], selectedId: "b", editing: true });

    useProjectStore.getState().moveSelection(1);
    expect(useProjectStore.getState().selectedId).toBe("c");
    expect(useProjectStore.getState().editing).toBe(false);

    useProjectStore.getState().moveSelection(-1);
    expect(useProjectStore.getState().selectedId).toBe("b");
  });

  it("moveSelection clamps at the ends (no wrap)", () => {
    const a = mkBlock({ id: "a" });
    const b = mkBlock({ id: "b" });
    useProjectStore.setState({ blocks: [a, b], selectedId: "a" });

    useProjectStore.getState().moveSelection(-1);
    expect(useProjectStore.getState().selectedId).toBe("a");

    useProjectStore.setState({ selectedId: "b" });
    useProjectStore.getState().moveSelection(1);
    expect(useProjectStore.getState().selectedId).toBe("b");
  });

  it("insertAfter opens the new block directly in edit mode with caret at start", () => {
    const a = mkBlock({ id: "a" });
    useProjectStore.setState({ blocks: [a], selectedId: "a", editing: false });

    const newId = useProjectStore.getState().insertAfter("a");

    const { selectedId, editing, editCaret } = useProjectStore.getState();
    expect(selectedId).toBe(newId);
    expect(editing).toBe(true);
    expect(editCaret).toBe("start");
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

  it("restores selection to the split block (not the last block) on undo", () => {
    const first = mkBlock({ id: "first", text: "Hello world" });
    const last = mkBlock({ id: "last", text: "Tail block" });
    useProjectStore.setState({
      blocks: [first, last],
      selectedId: "first",
      past: [],
      future: [],
    });

    useProjectStore.getState().splitBlock("first", 5);
    useProjectStore.getState().undo();

    // The split block is restored and re-selected — selection must NOT jump to
    // the last block (which would scroll the viewport to the bottom).
    expect(useProjectStore.getState().selectedId).toBe("first");
  });

  it("restores selection to the carved block (not the last block) on undo", () => {
    const first = mkBlock({ id: "first", text: "abc def ghi" });
    const last = mkBlock({ id: "last", text: "Tail block" });
    useProjectStore.setState({
      blocks: [first, last],
      selectedId: "first",
      past: [],
      future: [],
    });

    useProjectStore.getState().convertSelection("first", 4, 7, "lore");
    useProjectStore.getState().undo();

    expect(useProjectStore.getState().selectedId).toBe("first");
  });

  it("restores the post-split selection on redo", () => {
    const first = mkBlock({ id: "first", text: "Hello world" });
    const last = mkBlock({ id: "last", text: "Tail block" });
    useProjectStore.setState({
      blocks: [first, last],
      selectedId: "first",
      past: [],
      future: [],
    });

    useProjectStore.getState().splitBlock("first", 5);
    const afterSplitSelection = useProjectStore.getState().selectedId;
    useProjectStore.getState().undo();
    useProjectStore.getState().redo();

    expect(useProjectStore.getState().selectedId).toBe(afterSplitSelection);
  });
});

describe("applyBlockEdits", () => {
  it("applies many edits as ONE undo step", () => {
    const a = mkBlock({ id: "a", text: "alpha" });
    const b = mkBlock({ id: "b", text: "bravo" });
    const c = mkBlock({ id: "c", text: "charlie" });
    // Seed a redo stack + clean flag so we can prove the batch clears future and
    // marks the chapter dirty.
    useProjectStore.setState({
      blocks: [a, b, c],
      past: [],
      future: [{ blocks: [a], selectedId: null }],
      chapterDirty: false,
    });

    useProjectStore.getState().applyBlockEdits([
      { id: "a", text: "ALPHA" },
      { id: "c", text: "CHARLIE" },
    ]);

    const { blocks, past, future, chapterDirty } = useProjectStore.getState();
    expect(blocks.map((x) => x.text)).toEqual(["ALPHA", "bravo", "CHARLIE"]);
    expect(blocks[0].dirty).toBe(true);
    expect(blocks[1].dirty).toBe(false); // untouched block keeps its flag
    expect(past).toHaveLength(1); // single undo entry for the whole batch
    expect(chapterDirty).toBe(true);
    expect(future).toEqual([]); // redo stack cleared

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().blocks.map((x) => x.text)).toEqual([
      "alpha",
      "bravo",
      "charlie",
    ]);
  });

  it("is a no-op (no history push) for an empty edit list", () => {
    const a = mkBlock({ id: "a", text: "alpha" });
    useProjectStore.setState({ blocks: [a], past: [] });
    useProjectStore.getState().applyBlockEdits([]);
    expect(useProjectStore.getState().past).toHaveLength(0);
  });
});

describe("formatBlockText", () => {
  it("sets text and records exactly one undo step", () => {
    const b = mkBlock({ text: "abc" });
    useProjectStore.setState({
      blocks: [b],
      selectedId: b.id,
      past: [],
      future: [{ blocks: [], selectedId: null }],
      lastTextEditId: b.id,
    });

    useProjectStore.getState().formatBlockText(b.id, "a**b**c");

    const { blocks, past, future, lastTextEditId } = useProjectStore.getState();
    expect(blocks[0].text).toBe("a**b**c");
    expect(blocks[0].dirty).toBe(true);
    expect(past).toHaveLength(1);
    expect(future).toHaveLength(0);
    expect(lastTextEditId).toBeNull();
  });
});

describe("editable breaks", () => {
  it("lets a selected break enter edit mode", () => {
    const b = mkBlock({ type: "chapter", level: "break", text: "* * *" });
    useProjectStore.setState({ blocks: [b], selectedId: b.id, editing: false });

    useProjectStore.getState().beginEdit("start");

    expect(useProjectStore.getState().editing).toBe(true);
  });

  it("inserts a break after the selected block", () => {
    const b = mkBlock({ text: "para" });
    useProjectStore.setState({ blocks: [b], selectedId: b.id });

    const id = useProjectStore.getState().insertAfter(b.id, { type: "chapter", level: "break", text: "* * *" });

    const { blocks } = useProjectStore.getState();
    const created = blocks.find((x) => x.id === id);
    expect(created?.type).toBe("chapter");
    expect(created?.level).toBe("break");
    expect(created?.text).toBe("* * *");
  });
});
