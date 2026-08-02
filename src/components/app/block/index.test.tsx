// @vitest-environment happy-dom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    setActivatorNodeRef: () => {},
    transform: { x: 0, y: 120, scaleX: 1, scaleY: 0.45 },
    transition: undefined,
    isDragging: true,
  }),
}));

import { Block } from "@/components/app/block";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Block as BlockT } from "@/lib/types";
import { useProjectStore } from "@/stores/project-store";

const block: BlockT = {
  id: "dialogue-1",
  type: "dialogue",
  text: "A long block that crosses a shorter drop target.",
  raw: "",
  dirty: false,
};

afterEach(() => cleanup());

beforeEach(() => {
  useProjectStore.setState({
    blocks: [block],
    selectedId: null,
    selectedIds: [],
    editing: false,
  });
});

describe("Block drag transform", () => {
  it("preserves block dimensions when dnd-kit supplies a scale", () => {
    render(
      <TooltipProvider>
        <Block
          block={block}
          dictation={{ supported: false, listening: false, toggle: () => {} }}
        />
      </TooltipProvider>,
    );

    const element = document.querySelector<HTMLElement>(`[data-block-id="${block.id}"]`);
    expect(element?.style.getPropertyValue("--dnd-transform")).toBe(
      "translate3d(0px, 120px, 0)",
    );
  });
});
