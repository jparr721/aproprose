// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "@/components/app/command-palette";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { AgentIntent } from "@/lib/ai/agent-types";
import type { Block } from "@/lib/types";
import { useCommandPaletteStore } from "@/stores/command-palette-store";
import { useProjectStore } from "@/stores/project-store";

const controller = vi.hoisted(() => ({
  dispatchAgentIntent: vi.fn<(intent: AgentIntent) => Promise<void>>(),
}));

vi.mock("@/lib/ai/agent-controller", () => ({
  dispatchAgentIntent: controller.dispatchAgentIntent,
}));

vi.mock("@/hooks/use-keybinding", () => ({
  useKeybinding: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

const block = (id: string, type: Block["type"]): Block => ({
  id,
  type,
  text: `${id} text`,
  raw: "",
  dirty: false,
});

const renderPalette = (): ReturnType<typeof render> =>
  render(
    <SidebarProvider>
      <CommandPalette />
    </SidebarProvider>,
  );

afterEach(cleanup);

beforeEach(() => {
  controller.dispatchAgentIntent.mockReset().mockResolvedValue(undefined);
  useCommandPaletteStore.setState({
    open: true,
    page: "root",
    recentIds: ["ai.pick-up"],
  });
  useProjectStore.setState({
    activeChapterId: "ch1",
    selectedId: "selected",
    selectedIds: [],
    blocks: [block("selected", "narration")],
  });
});

describe("CommandPalette recent command availability", () => {
  it.each([
    {
      name: "scratchpad selection",
      selectedId: "selected",
      blocks: [block("selected", "scratchpad")],
    },
    { name: "no selection", selectedId: null, blocks: [] },
  ])("hides a recent Pick Up for $name", ({ selectedId, blocks }) => {
    useProjectStore.setState({ selectedId, selectedIds: [], blocks });

    renderPalette();

    expect(screen.queryByText("Pick Up From Here")).toBeNull();
  });

  it("rechecks a recent command before closing, recording, or running it", () => {
    useCommandPaletteStore.setState({
      recentIds: ["ai.suggest", "ai.pick-up"],
    });
    renderPalette();
    const recentHeading = screen.getByText("Recent");
    const recentGroup = recentHeading.closest("[cmdk-group]");
    if (!(recentGroup instanceof HTMLElement)) {
      throw new Error("Expected the Recent command group");
    }
    const pickUp = within(recentGroup).getByText("Pick Up From Here");
    useProjectStore.setState({
      selectedId: "selected",
      selectedIds: [],
      blocks: [block("selected", "scratchpad")],
    });

    fireEvent.click(pickUp);

    expect(controller.dispatchAgentIntent).not.toHaveBeenCalled();
    expect(useCommandPaletteStore.getState()).toMatchObject({
      open: true,
      recentIds: ["ai.suggest", "ai.pick-up"],
    });
  });
});
