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
import { EMPTY_AGENT_STATE, useAgentConsoleStore } from "@/stores/agent-console-store";
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
    useViewStore.getState().openChanges();
    useAgentConsoleStore.getState().beginPreflight();
  });
  useViewStore.setState({ aiOpen: false, changesOpen: false, focus: false });
  useAgentConsoleStore.setState({ ...EMPTY_AGENT_STATE, requestedProjectRoot: "/book", activeProjectRoot: "/book", hydratedProjectRoot: "/book" });
  useProjectStore.setState({
    project: {
      root: "/book", name: "Book", mainFile: "main.tex", title: "Book", author: "Author",
      metadata: { title: "Book", subtitle: "", author: "Author", publisher: "", isbn: "" },
      chapters: [{ id: "chapter-1", label: "1", title: "One", file: "one.tex", wordCount: 5 }],
    },
    activeChapterId: "chapter-1",
    selectedId: null,
    selectedIds: [],
    blocks: [prose],
  });
});

describe("BlockToolbar Suggest", () => {
  it("stages an anchored continuation and immediately prevents repeated clicks", () => {
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
      task: { kind: "bridge", chapterId: "chapter-1", anchorBlockId: "block-1", successorBlockId: null },
    });
    expect(useProjectStore.getState().selectedId).toBe("block-1");
    expect(useViewStore.getState().changesOpen).toBe(true);
    const suggest = screen.getByRole("button", { name: "Suggest what comes next here" });
    expect(suggest.hasAttribute("disabled")).toBe(true);
    expect(suggest.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(suggest);
    expect(controller.dispatchAgentIntent).toHaveBeenCalledTimes(1);
  });
});
