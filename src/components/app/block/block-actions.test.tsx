// @vitest-environment happy-dom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentIntent } from "@/lib/ai/agent-types";

const controller = vi.hoisted(() => ({
  dispatchAgentIntent: vi.fn<(intent: AgentIntent) => Promise<void>>(),
}));

vi.mock("@/lib/ai/agent-controller", () => ({
  dispatchAgentIntent: controller.dispatchAgentIntent,
}));

vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));

import {
  useBlockActions,
  type BlockAction,
} from "@/components/app/block/block-actions";
import {
  EMPTY_AGENT_STATE,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import type { Block } from "@/lib/types";

const CLEAN_DIRECTIVE =
  "Clean the selected prose conservatively. Preserve meaning, voice, and structure unless a change is required.";
const STRUCTURE_DIRECTIVE =
  "Structure the selected passage into appropriate narration and dialogue blocks. Preserve wording unless structure requires a minimal edit.";
const PICK_UP_DIRECTIVE =
  "Continue from the anchor. If later prose exists, propose only the minimum bridge into it and preserve that later prose. If the anchor is final prose, continue after it.";

const block = (id: string, type: Block["type"], text = "Some prose."): Block => ({
  id,
  type,
  text,
  raw: "",
  dirty: false,
});

const findAction = (groups: BlockAction[][], label: string): BlockAction => {
  const action = groups.flat().find((candidate) => candidate.label === label);
  if (action === undefined) {
    throw new Error(`No block action labeled "${label}"`);
  }
  return action;
};

const labels = (groups: BlockAction[][]): string[] =>
  groups.flat().map((action) => action.label);

afterEach(() => cleanup());

beforeEach(() => {
  controller.dispatchAgentIntent.mockReset().mockImplementation(async (intent) => {
    useViewStore.getState().openAiConsole();
    if (intent.kind === "add-context") {
      useAgentConsoleStore.getState().addDraftContextRefs(intent.refs);
    }
  });
  useAgentConsoleStore.setState({
    ...EMPTY_AGENT_STATE,
    requestedProjectRoot: "/book",
    activeProjectRoot: "/book",
    hydratedProjectRoot: "/book",
  });
  useViewStore.setState({ aiOpen: false, focus: false });
  useProjectStore.setState({
    activeChapterId: "ch1",
    selectedId: null,
    selectedIds: [],
    blocks: [
      block("A", "narration"),
      block("note", "scratchpad", "Private note."),
      block("B", "dialogue"),
    ],
  });
});

describe("Agent block actions", () => {
  it("puts Add to Chat first, opens the console, and only adds clicked context", () => {
    const { result } = renderHook(() =>
      useBlockActions(block("A", "narration")),
    );

    expect(result.current[2][0].label).toBe("Add to Chat");
    act(() => findAction(result.current, "Add to Chat").onSelect());

    expect(controller.dispatchAgentIntent).toHaveBeenCalledWith({
      kind: "add-context",
      refs: [{ kind: "block", chapterId: "ch1", blockId: "A" }],
    });
    expect(useViewStore.getState().aiOpen).toBe(true);
    expect(useAgentConsoleStore.getState().messages).toEqual([]);
    expect(useAgentConsoleStore.getState().activeRun).toBeNull();
  });

  it("labels a clicked multi-selection and adds it in selection order", () => {
    useProjectStore.setState({ selectedId: "A", selectedIds: ["B", "A"] });
    const { result } = renderHook(() =>
      useBlockActions(block("A", "narration")),
    );

    act(() => findAction(result.current, "Add all to Chat").onSelect());

    expect(controller.dispatchAgentIntent).toHaveBeenCalledWith({
      kind: "add-context",
      refs: [
        { kind: "block", chapterId: "ch1", blockId: "B" },
        { kind: "block", chapterId: "ch1", blockId: "A" },
      ],
    });
  });

  it("replaces single-block structural actions with selected-block actions", () => {
    useProjectStore.setState({ selectedId: "A", selectedIds: ["A", "B"] });
    const { result } = renderHook(() =>
      useBlockActions(block("A", "narration")),
    );

    expect(labels(result.current)).toContain("Move selected blocks up");
    expect(labels(result.current)).toContain("Move selected blocks down");
    expect(labels(result.current)).toContain("Delete selected blocks");
    expect(labels(result.current)).not.toContain("Insert block above");
    expect(labels(result.current)).not.toContain("Pick up from here");
  });

  it("deduplicates repeated Add to Chat context in the console store", () => {
    const { result } = renderHook(() =>
      useBlockActions(block("A", "narration")),
    );
    const action = findAction(result.current, "Add to Chat");

    act(() => {
      action.onSelect();
      action.onSelect();
    });

    expect(useAgentConsoleStore.getState().draftContextRefs).toEqual([
      { kind: "block", chapterId: "ch1", blockId: "A" },
    ]);
  });

  it("submits a complete selected-block clean intent without writing block text", () => {
    const updateBlockText = vi.fn();
    useProjectStore.setState({
      selectedId: "A",
      selectedIds: ["B", "A"],
      updateBlockText,
    });
    const { result } = renderHook(() =>
      useBlockActions(block("A", "narration")),
    );

    act(() => findAction(result.current, "Clean up with AI").onSelect());

    expect(controller.dispatchAgentIntent).toHaveBeenCalledWith({
      kind: "run",
      mode: "edit",
      text: CLEAN_DIRECTIVE,
      refs: [
        { kind: "block", chapterId: "ch1", blockId: "B" },
        { kind: "block", chapterId: "ch1", blockId: "A" },
      ],
      task: {
        kind: "selected-block-edit",
        chapterId: "ch1",
        blockIds: ["B", "A"],
        operation: "clean",
      },
    });
    expect(updateBlockText).not.toHaveBeenCalled();
  });

  it("submits a complete selected-block structure intent without legacy state", () => {
    const structured = block(
      "A",
      "narration",
      "First paragraph.\n\nSecond paragraph.",
    );
    useProjectStore.setState({
      selectedId: "A",
      selectedIds: ["A", "B"],
      blocks: [structured, block("B", "dialogue")],
    });
    const { result } = renderHook(() => useBlockActions(structured));

    act(() => findAction(result.current, "Structure with AI").onSelect());

    expect(controller.dispatchAgentIntent).toHaveBeenCalledWith({
      kind: "run",
      mode: "edit",
      text: STRUCTURE_DIRECTIVE,
      refs: [
        { kind: "block", chapterId: "ch1", blockId: "A" },
        { kind: "block", chapterId: "ch1", blockId: "B" },
      ],
      task: {
        kind: "selected-block-edit",
        chapterId: "ch1",
        blockIds: ["A", "B"],
        operation: "structure",
      },
    });
  });

  it("keeps deterministic Structure into blocks as a local action", () => {
    const structureBlock = vi.fn();
    const structured = block(
      "A",
      "narration",
      "First paragraph.\n\nSecond paragraph.",
    );
    useProjectStore.setState({ structureBlock, blocks: [structured] });
    const { result } = renderHook(() => useBlockActions(structured));

    act(() => findAction(result.current, "Structure into blocks").onSelect());

    expect(structureBlock).toHaveBeenCalledWith("A");
    expect(controller.dispatchAgentIntent).not.toHaveBeenCalled();
  });

  it("submits a Writing bridge with the next prose successor frozen", () => {
    const { result } = renderHook(() =>
      useBlockActions(block("A", "narration")),
    );

    act(() => findAction(result.current, "Pick up from here").onSelect());

    expect(controller.dispatchAgentIntent).toHaveBeenCalledWith({
      kind: "run",
      mode: "writing",
      text: PICK_UP_DIRECTIVE,
      refs: [{ kind: "block", chapterId: "ch1", blockId: "A" }],
      task: {
        kind: "bridge",
        chapterId: "ch1",
        anchorBlockId: "A",
        successorBlockId: "B",
      },
    });
  });

  it("freezes a null successor for the final prose anchor", () => {
    const finalBlock = block("B", "dialogue");
    const { result } = renderHook(() => useBlockActions(finalBlock));

    act(() => findAction(result.current, "Pick up from here").onSelect());

    expect(controller.dispatchAgentIntent).toHaveBeenCalledWith({
      kind: "run",
      mode: "writing",
      text: PICK_UP_DIRECTIVE,
      refs: [{ kind: "block", chapterId: "ch1", blockId: "B" }],
      task: {
        kind: "bridge",
        chapterId: "ch1",
        anchorBlockId: "B",
        successorBlockId: null,
      },
    });
  });

  it.each(["lore", "scratchpad", "latex", "chapter"] as const)(
    "does not offer Pick Up for %s blocks",
    (type) => {
      const { result } = renderHook(() => useBlockActions(block("X", type)));
      expect(labels(result.current)).not.toContain("Pick up from here");
    },
  );
});

describe("Contextual segment actions", () => {
  it("offers Add action beat when the last segment is a quote", () => {
    const { result } = renderHook(() =>
      useBlockActions(block("B", "dialogue")),
    );
    expect(labels(result.current)).toContain("Add action beat");
    expect(labels(result.current)).not.toContain("Add spoken line");
  });

  it("offers Add spoken line when the last segment is a beat", () => {
    const withBeat: Block = {
      ...block("B", "dialogue"),
      tail: [{ kind: "beat", text: "he said." }],
    };
    const { result } = renderHook(() => useBlockActions(withBeat));
    expect(labels(result.current)).toContain("Add spoken line");
    expect(labels(result.current)).not.toContain("Add action beat");
  });
});

describe("Structure into blocks action", () => {
  it("offers Structure into blocks on a multi-paragraph narration", () => {
    const multiParagraph = block("A", "narration", "One.\n\nTwo.");
    const { result } = renderHook(() => useBlockActions(multiParagraph));
    expect(labels(result.current)).toContain("Structure into blocks");
  });

  it("hides Structure into blocks on a single plain paragraph", () => {
    const { result } = renderHook(() =>
      useBlockActions(block("A", "narration", "Just one line.")),
    );
    expect(labels(result.current)).not.toContain("Structure into blocks");
  });
});
