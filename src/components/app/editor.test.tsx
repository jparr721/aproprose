// @vitest-environment happy-dom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentIntent } from "@/lib/ai/agent-types";

const controller = vi.hoisted(() => ({
  dispatchAgentIntent: vi.fn<(intent: AgentIntent) => Promise<void>>(),
}));

vi.mock("@/lib/ai/agent-controller", () => ({
  dispatchAgentIntent: controller.dispatchAgentIntent,
}));

vi.mock("@/components/app/block", () => ({
  Block: ({ block }: { block: { id: string } }) => (
    <div data-block-id={block.id} />
  ),
}));

vi.mock("@/components/app/find-bar", () => ({ FindBar: () => null }));
vi.mock("@/components/app/selection-toolbar", () => ({
  SelectionToolbar: () => null,
}));
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/use-dictation", () => ({
  useDictation: () => ({ supported: false, listening: false, toggle: vi.fn() }),
}));
vi.mock("@/hooks/use-keybinding", () => ({
  useKeybinding: vi.fn(),
  useKeybindingWithOptions: vi.fn(),
}));
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  KeyboardSensor: function KeyboardSensor() {},
  PointerSensor: function PointerSensor() {},
  closestCenter: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
}));
vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  sortableKeyboardCoordinates: vi.fn(),
  verticalListSortingStrategy: vi.fn(),
}));
vi.mock("@dnd-kit/modifiers", () => ({ restrictToVerticalAxis: vi.fn() }));
vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));

import { Editor } from "@/components/app/editor";
import { useAiCacheStore } from "@/stores/ai-cache-store";
import { useAiIntentStore } from "@/stores/ai-intent-store";
import { useProjectStore } from "@/stores/project-store";
import { useSyncStore } from "@/stores/sync-store";
import { useViewStore } from "@/stores/view-store";
import type { Block, ProjectInfo, ProjectMeta } from "@/lib/types";

const project: ProjectInfo = {
  root: "/book",
  name: "Book",
  mainFile: "main.tex",
  title: "Book",
  author: "Author",
  metadata: {
    title: "Book",
    subtitle: "",
    author: "Author",
    publisher: "",
    isbn: "",
  },
  chapters: [
    {
      id: "chapter-1",
      label: "1",
      title: "The Crossing",
      file: "chapter-1.tex",
      wordCount: 12,
    },
  ],
};

const blocks: Block[] = [
  {
    id: "block-1",
    type: "narration",
    text: "Rain crossed the window.",
    raw: "Rain crossed the window.\n",
    dirty: false,
  },
  {
    id: "block-2",
    type: "dialogue",
    text: "Stay here.",
    raw: "Stay here.\n",
    dirty: false,
  },
];

const meta: ProjectMeta = {
  version: 3,
  characters: [],
  lore: [],
  statuses: {},
  outline: { premise: "" },
  chapters: {
    "chapter-1": {
      act: null,
      plotPoint: null,
      premise: "",
      goal: "",
      conflict: "",
      turn: "",
      characterIds: [],
      cards: [],
    },
  },
};

afterEach(() => cleanup());

beforeEach(() => {
  controller.dispatchAgentIntent.mockReset().mockImplementation(async () => {
    useViewStore.getState().openAiConsole();
  });
  useAiCacheStore.getState().reset();
  useAiIntentStore.setState({ pending: null });
  useViewStore.setState({ aiOpen: false, focus: false });
  useSyncStore.setState({ conflictedFiles: [] });
  useProjectStore.setState({
    project,
    meta,
    activeChapterId: "chapter-1",
    blocks,
    selectedId: null,
    selectedIds: [],
    editing: false,
    chapterDirty: false,
  });
});

describe("Editor Suggest from context", () => {
  it("submits the live selected block set in selection order", () => {
    useProjectStore.setState({
      selectedId: "block-1",
      selectedIds: ["block-2", "block-1"],
    });
    render(<Editor />);

    fireEvent.click(
      screen.getByRole("button", { name: "Suggest from context" }),
    );

    expect(controller.dispatchAgentIntent).toHaveBeenCalledWith({
      kind: "run",
      mode: "writing",
      text: "Suggest what should come next from the selected context.",
      refs: [
        {
          kind: "block",
          chapterId: "chapter-1",
          blockId: "block-2",
        },
        {
          kind: "block",
          chapterId: "chapter-1",
          blockId: "block-1",
        },
      ],
      task: { kind: "conversation", targetChapterId: "chapter-1" },
    });
    expect(useViewStore.getState().aiOpen).toBe(true);
    expect(useAiIntentStore.getState().pending).toBeNull();
    expect(useAiCacheStore.getState().entries).toEqual({});
  });

  it("still submits a chapter-targeted conversation without a selection", () => {
    render(<Editor />);

    fireEvent.click(
      screen.getByRole("button", { name: "Suggest from context" }),
    );

    expect(controller.dispatchAgentIntent).toHaveBeenCalledWith({
      kind: "run",
      mode: "writing",
      text: "Suggest what should come next from the selected context.",
      refs: [],
      task: { kind: "conversation", targetChapterId: "chapter-1" },
    });
    expect(useAiIntentStore.getState().pending).toBeNull();
    expect(useAiCacheStore.getState().entries).toEqual({});
  });
});
