// @vitest-environment happy-dom
//
// happy-dom gives scrollMatchIntoView a real `document` (querySelector returns
// null with nothing rendered, so the scroll is a no-op); the index math under
// test is otherwise DOM-free.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Tauri / toast so importing the project store has no native side effects.
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
  readProjectMeta: vi.fn().mockResolvedValue(null),
  readTextFile: vi.fn(),
  writeAppData: vi.fn().mockResolvedValue(undefined),
  writeProjectMeta: vi.fn().mockResolvedValue(undefined),
  writeTextFile: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { useFindStore } from "@/stores/find-store";
import { useProjectStore } from "@/stores/project-store";
import type { Block } from "@/lib/types";

const mkBlock = (id: string, text: string): Block => ({
  id,
  type: "narration",
  text,
  raw: "",
  dirty: false,
});

const seed = (blocks: Block[]): void => {
  useProjectStore.setState({
    blocks,
    selectedId: null,
    chapterDirty: false,
    past: [],
    future: [],
    lastTextEditId: null,
  });
};

const setText = (id: string, text: string): void =>
  useProjectStore.setState((s) => ({
    blocks: s.blocks.map((b) => (b.id === id ? { ...b, text } : b)),
  }));

beforeEach(() => {
  useFindStore.setState({
    open: false,
    query: "",
    replacement: "",
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    replaceExpanded: false,
    matches: [],
    currentIndex: -1,
    error: null,
    focusTick: 0,
  });
});

describe("recompute", () => {
  it("derives matches from the project blocks and selects the first", () => {
    seed([mkBlock("a", "the cat sat"), mkBlock("b", "cat and cat")]);
    useFindStore.setState({ open: true, query: "cat" });
    useFindStore.getState().recompute();
    const s = useFindStore.getState();
    expect(s.matches).toEqual([
      { blockId: "a", start: 4, end: 7 },
      { blockId: "b", start: 0, end: 3 },
      { blockId: "b", start: 8, end: 11 },
    ]);
    expect(s.currentIndex).toBe(0);
    expect(s.error).toBeNull();
  });

  it("keeps the user on the same match across an edit that shifts indices", () => {
    seed([mkBlock("a", "cat"), mkBlock("b", "cat cat")]);
    useFindStore.setState({ open: true, query: "cat" });
    useFindStore.getState().recompute();
    useFindStore.getState().next(); // index 1 -> { b, 0 }
    expect(useFindStore.getState().currentIndex).toBe(1);

    setText("a", "cat cat"); // block a gains a match, pushing { b, 0 } later
    useFindStore.getState().recompute();
    const s = useFindStore.getState();
    expect(s.matches).toEqual([
      { blockId: "a", start: 0, end: 3 },
      { blockId: "a", start: 4, end: 7 },
      { blockId: "b", start: 0, end: 3 },
      { blockId: "b", start: 4, end: 7 },
    ]);
    expect(s.currentIndex).toBe(2); // still on { b, 0 }
  });

  it("clamps the current index when matches shrink", () => {
    seed([mkBlock("a", "cat cat cat")]);
    useFindStore.setState({ open: true, query: "cat" });
    useFindStore.getState().recompute();
    useFindStore.getState().next();
    useFindStore.getState().next();
    expect(useFindStore.getState().currentIndex).toBe(2);

    setText("a", "cat"); // only one match remains; index 2 is out of range
    useFindStore.getState().recompute();
    const s = useFindStore.getState();
    expect(s.matches).toEqual([{ blockId: "a", start: 0, end: 3 }]);
    expect(s.currentIndex).toBe(0);
  });
});

describe("next / prev", () => {
  it("wraps around in both directions", () => {
    seed([mkBlock("a", "cat cat")]);
    useFindStore.setState({ open: true, query: "cat" });
    useFindStore.getState().recompute();
    expect(useFindStore.getState().currentIndex).toBe(0);
    useFindStore.getState().next();
    expect(useFindStore.getState().currentIndex).toBe(1);
    useFindStore.getState().next(); // wraps to 0
    expect(useFindStore.getState().currentIndex).toBe(0);
    useFindStore.getState().prev(); // wraps to last
    expect(useFindStore.getState().currentIndex).toBe(1);
  });

  it("no-ops when there are no matches", () => {
    seed([mkBlock("a", "dog")]);
    useFindStore.setState({ open: true, query: "cat" });
    useFindStore.getState().recompute();
    expect(useFindStore.getState().currentIndex).toBe(-1);
    useFindStore.getState().next();
    useFindStore.getState().prev();
    expect(useFindStore.getState().currentIndex).toBe(-1);
  });
});

describe("replaceCurrent", () => {
  it("replaces the current match and advances to the next", () => {
    seed([mkBlock("a", "cat cat")]);
    useFindStore.setState({ open: true, query: "cat", replacement: "dog" });
    useFindStore.getState().recompute();
    useFindStore.getState().replaceCurrent();
    expect(useProjectStore.getState().blocks[0].text).toBe("dog cat");
    const s = useFindStore.getState();
    expect(s.matches).toEqual([{ blockId: "a", start: 4, end: 7 }]);
    expect(s.currentIndex).toBe(0);
  });

  it("advances past a replacement that itself contains the query (no re-hit)", () => {
    seed([mkBlock("a", "cat cat")]);
    useFindStore.setState({ open: true, query: "cat", replacement: "cats" });
    useFindStore.getState().recompute();
    useFindStore.getState().replaceCurrent();
    expect(useProjectStore.getState().blocks[0].text).toBe("cats cat");
    const s = useFindStore.getState();
    expect(s.matches).toEqual([
      { blockId: "a", start: 0, end: 3 }, // the "cat" inside the inserted "cats"
      { blockId: "a", start: 5, end: 8 }, // the original second "cat"
    ]);
    expect(s.currentIndex).toBe(1); // skipped the inserted text, landed on the next real match
  });

  it("advances by the actual expansion length, not the replacement template length", () => {
    // The regex template "$2$1" is 4 chars but expands to 2 ("ba"); advancing by the
    // template length would skip the match at offset 2 onto the one at offset 4.
    seed([mkBlock("a", "ababab")]);
    useFindStore.setState({ open: true, query: "(a)(b)", replacement: "$2$1", regex: true });
    useFindStore.getState().recompute();
    useFindStore.getState().replaceCurrent();
    expect(useProjectStore.getState().blocks[0].text).toBe("baabab");
    const s = useFindStore.getState();
    expect(s.matches).toEqual([
      { blockId: "a", start: 2, end: 4 },
      { blockId: "a", start: 4, end: 6 },
    ]);
    expect(s.currentIndex).toBe(0);
  });
});

describe("replaceAll", () => {
  it("rewrites every match in one edit and re-derives the now-empty match set", () => {
    seed([mkBlock("a", "cat cat"), mkBlock("b", "a cat")]);
    useFindStore.setState({ open: true, query: "cat", replacement: "dog" });
    useFindStore.getState().recompute();
    useFindStore.getState().replaceAll();
    const blocks = useProjectStore.getState().blocks;
    expect(blocks.map((b) => b.text)).toEqual(["dog dog", "a dog"]);
    const s = useFindStore.getState();
    expect(s.matches).toEqual([]);
    expect(s.currentIndex).toBe(-1);
  });

  it("surfaces an invalid-regex error instead of silently doing nothing", () => {
    seed([mkBlock("a", "abc")]);
    useFindStore.setState({ open: true, query: "(", replacement: "x", regex: true });
    useFindStore.getState().replaceAll();
    expect(useFindStore.getState().error).toBeTruthy();
    expect(useProjectStore.getState().blocks[0].text).toBe("abc");
  });
});
