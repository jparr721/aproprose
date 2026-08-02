// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeybindingId } from "@/lib/keybindings";
import type { Block } from "@/lib/types";

const keybindings = new Map<KeybindingId, () => void>();

vi.mock("@/lib/tauri", () => ({
  appendAgentFailureLog: vi.fn(),
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/hooks/use-keybinding", () => ({
  useKeybinding: vi.fn(),
  useKeybindingWithOptions: (id: KeybindingId, callback: () => void) => {
    keybindings.set(id, callback);
  },
}));
vi.mock("@/hooks/use-dictation", () => ({
  useDictation: () => ({ supported: false, listening: false, toggle: vi.fn() }),
}));
vi.mock("@/components/app/block", () => ({
  Block: ({ block }: { block: Block }) => <div data-testid={`block-${block.id}`} />,
}));
vi.mock("@/components/app/find-bar", () => ({ FindBar: () => null }));
vi.mock("@/components/app/selection-toolbar", () => ({ SelectionToolbar: () => null }));
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  KeyboardSensor: function KeyboardSensor() {},
  PointerSensor: function PointerSensor() {},
  closestCenter: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));
vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  sortableKeyboardCoordinates: vi.fn(),
  verticalListSortingStrategy: vi.fn(),
}));
vi.mock("@dnd-kit/modifiers", () => ({ restrictToVerticalAxis: vi.fn() }));

import { Editor } from "@/components/app/editor";
import { useProjectStore } from "@/stores/project-store";
import { useSyncStore } from "@/stores/sync-store";

function block(text: string): Block {
  return {
    id: "b1",
    type: "narration",
    text,
    raw: "",
    dirty: true,
  };
}

function renderEditor(selectedBlock: Block): void {
  useProjectStore.setState({
    project: {
      chapters: [{ id: "ch1", label: "1", title: "Test", file: "chapter.tex", wordCount: 0 }],
    },
    activeChapterId: "ch1",
    blocks: [selectedBlock],
    selectedId: selectedBlock.id,
    selectedIds: [],
    editing: false,
    chapterDirty: false,
  } as never);
  useSyncStore.setState({ conflictedFiles: [] });
  render(<Editor />);
}

function pressDelete(): void {
  const callback = keybindings.get("DELETE_BLOCK");
  if (!callback) throw new Error("DELETE_BLOCK keybinding was not registered");
  act(callback);
}

afterEach(cleanup);

beforeEach(() => {
  keybindings.clear();
});

describe("selected block Delete key", () => {
  it("deletes an empty selected block immediately", () => {
    renderEditor(block("  "));
    pressDelete();

    expect(useProjectStore.getState().blocks).toEqual([]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks for confirmation before deleting a populated selected block", () => {
    renderEditor(block("Some prose."));
    pressDelete();

    expect(useProjectStore.getState().blocks).toHaveLength(1);
    expect(screen.getByRole("alertdialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(useProjectStore.getState().blocks).toEqual([]);
  });
});
