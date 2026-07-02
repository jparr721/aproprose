// @vitest-environment happy-dom
//
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ai/operations", () => ({ editBlocks: vi.fn() }));
vi.mock("@/components/app/right-panel/shared", () => ({
  AiComposer: ({ focusKey, prefill }: { focusKey?: number; prefill?: string }) => (
    <div data-testid="composer" data-focus-key={focusKey} data-prefill={prefill ?? ""} />
  ),
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
import { useAiIntentStore, dispatchAiIntent } from "@/stores/ai-intent-store";
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
  useAiIntentStore.setState({ pending: null });
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

describe("EditTab intents", () => {
  it("consumes an edit intent: selects the blocks, prefills, focuses, never auto-runs", () => {
    render(<EditTab />);
    act(() => {
      dispatchAiIntent({ tab: "edit", instruction: "Fix the pacing here", blockIds: ["e2"], scope: "block" });
    });
    expect(useProjectStore.getState().selectedId).toBe("e2");
    expect(useProjectStore.getState().selectedIds).toEqual([]);
    const composer = screen.getByTestId("composer");
    expect(composer.getAttribute("data-prefill")).toBe("Fix the pacing here");
    expect(composer.getAttribute("data-focus-key")).toBe("1");
    // No autoRun in P1: nothing may enter loading.
    expect(Object.values(useAiCacheStore.getState().entries).every((e) => !e.loading)).toBe(true);
    expect(useAiIntentStore.getState().pending).toBeNull();
  });

  it("maps a chapter-scope intent onto the chapter scope with no selection", () => {
    render(<EditTab />);
    act(() => {
      dispatchAiIntent({ tab: "edit", instruction: "Raise the tension", blockIds: [], scope: "chapter" });
    });
    expect(useProjectStore.getState().selectedId).toBeNull();
    expect(screen.getByTestId("composer").getAttribute("data-prefill")).toBe("Raise the tension");
  });
});

describe("EditTab without an open chapter", () => {
  it("renders the inert composer state instead of crashing", () => {
    useProjectStore.setState({ activeChapterId: null } as never);
    expect(() => render(<EditTab />)).not.toThrow();
  });
});
