// @vitest-environment happy-dom
//
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ai/operations", () => ({ cleanTranscript: vi.fn() }));

import { useBlockActions, type BlockAction } from "@/components/app/block/block-actions";
import { useProjectStore } from "@/stores/project-store";
import { useAiIntentStore } from "@/stores/ai-intent-store";
import { useViewStore } from "@/stores/view-store";
import { PICK_UP_AND_GO_DIRECTIVE, pickUpCursorSuffix } from "@/lib/ai/prompts";
import type { Block } from "@/lib/types";

const block = (id: string, type: Block["type"]): Block => ({
  id,
  type,
  text: "Some prose.",
  raw: "",
  dirty: false,
});

const findAction = (groups: BlockAction[][], label: string): BlockAction => {
  const action = groups.flat().find((a) => a.label === label);
  if (!action) throw new Error(`No block action labeled "${label}"`);
  return action;
};

afterEach(() => cleanup());

beforeEach(() => {
  useProjectStore.setState({
    activeChapterId: "ch1",
    selectedId: null,
    selectedIds: [],
    blocks: [block("A", "narration"), block("B", "dialogue")],
  } as never);
  useAiIntentStore.setState({ pending: null });
});

describe("Pick up from here block action", () => {
  it("selects the block, then parks an auto-running muse intent", () => {
    const { result } = renderHook(() => useBlockActions(block("A", "narration")));
    act(() => findAction(result.current, "Pick up from here").onSelect());

    // The action still selects the block (author orientation when the panel
    // opens); the cursor reaches the muse run through the directive's suffix
    // line, not through the selection.
    expect(useProjectStore.getState().selectedId).toBe("A");
    expect(useAiIntentStore.getState().pending).toEqual({
      tab: "muse",
      instruction: PICK_UP_AND_GO_DIRECTIVE + pickUpCursorSuffix("A"),
      autoRun: true,
    });
    expect(useViewStore.getState().aiTab).toBe("muse");
  });

  it("is disabled on non-prose blocks", () => {
    const { result } = renderHook(() => useBlockActions(block("L", "latex")));
    expect(findAction(result.current, "Pick up from here").disabled).toBe(true);
  });

  it("is enabled on dialogue blocks", () => {
    const { result } = renderHook(() => useBlockActions(block("B", "dialogue")));
    expect(findAction(result.current, "Pick up from here").disabled).toBe(false);
  });
});

describe("Contextual segment actions", () => {
  it("offers 'Add action beat' when the last segment is a quote", () => {
    const { result } = renderHook(() => useBlockActions(block("B", "dialogue")));
    const labels = result.current.flat().map((a) => a.label);
    expect(labels).toContain("Add action beat");
    expect(labels).not.toContain("Add spoken line");
  });

  it("offers 'Add spoken line' when the last segment is a beat", () => {
    const withBeat: Block = { ...block("B", "dialogue"), tail: [{ kind: "beat", text: "he said." }] };
    const { result } = renderHook(() => useBlockActions(withBeat));
    const labels = result.current.flat().map((a) => a.label);
    expect(labels).toContain("Add spoken line");
    expect(labels).not.toContain("Add action beat");
  });
});

describe("Structure into blocks action", () => {
  it("offers 'Structure into blocks' on a multi-paragraph narration", () => {
    const multiParagraph: Block = { id: "b", type: "narration", text: "One.\n\nTwo.", raw: "", dirty: false };
    const { result } = renderHook(() => useBlockActions(multiParagraph));
    const labels = result.current.flat().map((a) => a.label);
    expect(labels).toContain("Structure into blocks");
  });

  it("hides 'Structure into blocks' on a single plain paragraph", () => {
    const singleLine: Block = { id: "b", type: "narration", text: "Just one line.", raw: "", dirty: false };
    const { result } = renderHook(() => useBlockActions(singleLine));
    const labels = result.current.flat().map((a) => a.label);
    expect(labels).not.toContain("Structure into blocks");
  });
});
