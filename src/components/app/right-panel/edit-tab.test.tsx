// @vitest-environment happy-dom
//
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ai/operations", () => ({ editBlocks: vi.fn() }));
vi.mock("@/components/app/right-panel/shared", () => ({
  AiComposer: () => <div />,
  AiError: () => <div>err</div>,
  AskedCaption: () => <div />,
  LoadingLines: () => <div />,
  PanelEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelHint: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ScopeToggle: () => <div />,
}));

import { EditTab } from "@/components/app/right-panel/edit-tab";
import { editBlocks } from "@/lib/ai/operations";
import { useProjectStore } from "@/stores/project-store";
import { useAiCacheStore } from "@/stores/ai-cache-store";
import type { BlockEdit } from "@/lib/types";

const CACHE_KEY = "edit:ch1:block:e1,e2";

const seedTwoEdits = () => {
  const data: BlockEdit[] = [
    { blockId: "e1", newText: "E1 v1", reason: "r1" },
    { blockId: "e2", newText: "E2 v1", reason: "r2" },
  ];
  useAiCacheStore.setState({
    entries: { [CACHE_KEY]: { data, loading: false, error: null } },
  });
};

const currentEdits = () =>
  useAiCacheStore.getState().entries[CACHE_KEY].data as BlockEdit[];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  useProjectStore.setState({
    activeChapterId: "ch1",
    selectedId: "e1",
    selectedIds: ["e1", "e2"],
    blocks: [
      { id: "e1", type: "narration", text: "E1 orig", raw: "", dirty: false },
      { id: "e2", type: "narration", text: "E2 orig", raw: "", dirty: false },
    ],
    meta: { ...useProjectStore.getState().meta, characters: [] },
  } as never);
  useAiCacheStore.setState({ entries: {} });
});

describe("EditTab refine", () => {
  it("replaces only the refined edit, leaving its siblings untouched", async () => {
    seedTwoEdits();
    vi.mocked(editBlocks).mockResolvedValue([
      { blockId: "e1", newText: "E1 v2", reason: "refined" },
    ]);

    render(<EditTab />);
    fireEvent.click(screen.getAllByText("Refine")[0]);
    fireEvent.change(
      screen.getByPlaceholderText("Refine this edit, e.g. keep it shorter, warmer"),
      { target: { value: "make it colder" } },
    );
    fireEvent.click(screen.getByLabelText("Send refinement"));

    await waitFor(() => {
      expect(currentEdits()).toEqual([
        { blockId: "e1", newText: "E1 v2", reason: "refined" },
        { blockId: "e2", newText: "E2 v1", reason: "r2" },
      ]);
    });
  });

  it("keeps the proposal and reports no change on a no-op refine", async () => {
    seedTwoEdits();
    vi.mocked(editBlocks).mockResolvedValue([]);

    render(<EditTab />);
    fireEvent.click(screen.getAllByText("Refine")[0]);
    fireEvent.change(
      screen.getByPlaceholderText("Refine this edit, e.g. keep it shorter, warmer"),
      { target: { value: "no change please" } },
    );
    fireEvent.click(screen.getByLabelText("Send refinement"));

    await waitFor(() => {
      expect(screen.getByText("No further change suggested.")).toBeTruthy();
    });
    // The original proposals are untouched.
    expect(currentEdits()).toEqual([
      { blockId: "e1", newText: "E1 v1", reason: "r1" },
      { blockId: "e2", newText: "E2 v1", reason: "r2" },
    ]);
  });
});
