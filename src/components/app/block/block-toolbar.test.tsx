// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentIntent } from "@/lib/ai/agent-types";

const controller = vi.hoisted(() => ({
  dispatchAgentIntent: vi.fn<(intent: AgentIntent) => Promise<void>>(),
}));

vi.mock("@/lib/ai/agent-controller", () => ({
  dispatchAgentIntent: controller.dispatchAgentIntent,
}));

vi.mock("@/components/app/block/type-chip", () => ({
  TypeChip: () => <span>Type</span>,
}));

vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));

import { BlockToolbar } from "@/components/app/block/block-toolbar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import type { Block } from "@/lib/types";

const prose: Block = {
  id: "block-1",
  type: "narration",
  text: "Rain crossed the window.",
  raw: "Rain crossed the window.\n",
  dirty: false,
};

afterEach(() => cleanup());

beforeEach(() => {
  controller.dispatchAgentIntent.mockReset().mockImplementation(async () => {
    useViewStore.getState().openAiConsole();
  });
  useViewStore.setState({ aiOpen: false, focus: false });
  useProjectStore.setState({
    activeChapterId: "chapter-1",
    selectedId: null,
    selectedIds: [],
    blocks: [prose],
  });
});

describe("BlockToolbar Suggest", () => {
  it("submits a Writing conversation with the clicked block as context", () => {
    render(
      <TooltipProvider>
        <BlockToolbar
          block={prose}
          characters={[]}
          dictation={{ supported: false, listening: false, toggle: vi.fn() }}
          selected={false}
          actions={[]}
        />
      </TooltipProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Suggest what comes next here" }),
    );

    expect(controller.dispatchAgentIntent).toHaveBeenCalledWith({
      kind: "run",
      mode: "writing",
      text: "Suggest what should come next from the selected context.",
      refs: [
        { kind: "block", chapterId: "chapter-1", blockId: "block-1" },
      ],
      task: { kind: "conversation", targetChapterId: "chapter-1" },
    });
    expect(useProjectStore.getState().selectedId).toBe("block-1");
    expect(useViewStore.getState().aiOpen).toBe(true);
  });
});
