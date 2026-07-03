// @vitest-environment happy-dom
//
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/ai/operations", () => ({ editBlocks: vi.fn(), reviseChapter: vi.fn() }));
vi.mock("@/components/app/right-panel/shared", () => ({
  // The composer/scope stubs surface their props as text so tests can assert
  // what the tab handed them (intent prefill, scope routing).
  AiComposer: ({ prefill, toolbar }: { prefill?: string; toolbar?: React.ReactNode }) => (
    <div>
      {`prefill:${prefill ?? ""}`}
      {toolbar}
    </div>
  ),
  AiError: () => <div>err</div>,
  AskedCaption: () => <div />,
  LoadingLines: () => <div />,
  PanelEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelHint: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ScopeToggle: ({ value }: { value: string }) => <div>{`scope:${value}`}</div>,
}));

import { act } from "react";
import { toast } from "sonner";
import { EditTab } from "@/components/app/right-panel/edit-tab";
import { editBlocks } from "@/lib/ai/operations";
import { useProjectStore } from "@/stores/project-store";
import { useAiCacheStore } from "@/stores/ai-cache-store";
import { useAiIntentStore } from "@/stores/ai-intent-store";
import type { BlockChange, ManuscriptProposal } from "@/lib/types";

const CACHE_KEY = "edit:ch1:block:e1,e2";

const change = (p: Partial<BlockChange> & { kind: BlockChange["kind"] }): BlockChange => ({
  blockId: null,
  afterId: null,
  type: null,
  speaker: null,
  newText: null,
  toIndex: null,
  reason: "r",
  ...p,
});

const seedProposal = (changes: BlockChange[]) => {
  const data: ManuscriptProposal = { chapterId: "ch1", summary: "s", changes };
  useAiCacheStore.setState({
    entries: { [CACHE_KEY]: { data, loading: false, error: null } },
  });
};

const currentChanges = () =>
  (useAiCacheStore.getState().entries[CACHE_KEY].data as ManuscriptProposal).changes;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.mocked(toast.warning).mockClear();
  useProjectStore.setState({
    activeChapterId: "ch1",
    selectedId: "e1",
    selectedIds: ["e1", "e2"],
    blocks: [
      { id: "e1", type: "narration", text: "E1 orig", raw: "", dirty: false },
      { id: "e2", type: "narration", text: "E2 orig", raw: "", dirty: false },
    ],
    past: [],
    future: [],
    lastTextEditId: null,
    meta: { ...useProjectStore.getState().meta, characters: [] },
  } as never);
  useAiCacheStore.setState({ entries: {} });
  useAiIntentStore.setState({ pending: null });
});

describe("EditTab without an open chapter", () => {
  it("renders the inert composer state instead of crashing", () => {
    useProjectStore.setState({ activeChapterId: null } as never);
    expect(() => render(<EditTab />)).not.toThrow();
  });
});

describe("EditTab per-kind rendering", () => {
  it("renders an insert card with its anchored position note", () => {
    seedProposal([
      change({ kind: "insert", afterId: "e1", type: "narration", newText: "Fresh line" }),
    ]);
    render(<EditTab />);
    expect(screen.getByText("Insert")).toBeTruthy();
    expect(screen.getByText("Fresh line")).toBeTruthy();
    expect(screen.getByText("After: E1 orig")).toBeTruthy();
  });

  it("renders an unanchored insert as landing at the chapter end", () => {
    seedProposal([change({ kind: "insert", afterId: null, type: "narration", newText: "Coda" })]);
    render(<EditTab />);
    expect(screen.getByText("At chapter end")).toBeTruthy();
  });

  it("renders a remove card with the current text struck through", () => {
    seedProposal([change({ kind: "remove", blockId: "e1" })]);
    render(<EditTab />);
    expect(screen.getByText("Remove")).toBeTruthy();
    expect(screen.getByText("E1 orig").className).toContain("line-through");
  });

  it("renders a move card naming the block and target position", () => {
    seedProposal([change({ kind: "move", blockId: "e2", toIndex: 0 })]);
    render(<EditTab />);
    expect(screen.getByText("Move")).toBeTruthy();
    expect(screen.getByText("E2 orig")).toBeTruthy();
    expect(screen.getByText("Move to position 1")).toBeTruthy();
  });
});

describe("EditTab accept", () => {
  it("accept applies one change through the store and removes it from the cache", () => {
    seedProposal([
      change({ kind: "rewrite", blockId: "e1", newText: "E1 v1" }),
      change({ kind: "rewrite", blockId: "e2", newText: "E2 v1" }),
    ]);
    render(<EditTab />);
    fireEvent.click(screen.getAllByText("Accept")[0]);
    expect(useProjectStore.getState().blocks[0].text).toBe("E1 v1");
    expect(useProjectStore.getState().blocks[1].text).toBe("E2 orig");
    expect(currentChanges()).toEqual([
      change({ kind: "rewrite", blockId: "e2", newText: "E2 v1" }),
    ]);
  });

  it("accept all applies the rest as one undo step and warns about skipped changes", () => {
    seedProposal([
      change({ kind: "rewrite", blockId: "ghost", newText: "gone" }),
      change({ kind: "rewrite", blockId: "e1", newText: "E1 v1" }),
    ]);
    render(<EditTab />);
    fireEvent.click(screen.getByText("Accept all"));
    expect(useProjectStore.getState().blocks[0].text).toBe("E1 v1");
    expect(useProjectStore.getState().past).toHaveLength(1);
    expect(toast.warning).toHaveBeenCalledWith("1 change skipped - its block changed since");
    expect(currentChanges()).toEqual([]);
  });

  it("accept all stays silent when nothing is skipped", () => {
    seedProposal([change({ kind: "rewrite", blockId: "e1", newText: "E1 v1" })]);
    render(<EditTab />);
    fireEvent.click(screen.getByText("Accept all"));
    expect(toast.warning).not.toHaveBeenCalled();
  });
});

describe("EditTab intent handler", () => {
  it("consumes a live edit intent: sets the selection, switches scope, prefills the composer", async () => {
    render(<EditTab />);

    // First park a chapter-scope intent so the block intent below provably
    // switches the scope back rather than reading the default.
    act(() => {
      useAiIntentStore.getState().dispatch({ tab: "edit", scope: "chapter" });
    });
    await waitFor(() => expect(screen.getByText("scope:chapter")).toBeTruthy());

    act(() => {
      useAiIntentStore.getState().dispatch({
        tab: "edit",
        instruction: "tighten this paragraph",
        blockIds: ["e2"],
        scope: "block",
      });
    });

    await waitFor(() =>
      expect(screen.getByText("prefill:tighten this paragraph")).toBeTruthy(),
    );
    expect(screen.getByText("scope:block")).toBeTruthy();
    expect(useProjectStore.getState().selectedId).toBe("e2");
    expect(useAiIntentStore.getState().pending).toBeNull();
  });
});

describe("EditTab refine", () => {
  const twoRewrites = () => [
    change({ kind: "rewrite", blockId: "e1", newText: "E1 v1", reason: "r1" }),
    change({ kind: "rewrite", blockId: "e2", newText: "E2 v1", reason: "r2" }),
  ];

  it("replaces only the refined change, leaving its siblings untouched", async () => {
    seedProposal(twoRewrites());
    vi.mocked(editBlocks).mockResolvedValue({
      chapterId: "ch1",
      summary: "",
      changes: [change({ kind: "rewrite", blockId: "e1", newText: "E1 v2", reason: "refined" })],
    });

    render(<EditTab />);
    fireEvent.click(screen.getAllByText("Refine")[0]);
    fireEvent.change(
      screen.getByPlaceholderText("Refine this edit, e.g. keep it shorter, warmer"),
      { target: { value: "make it colder" } },
    );
    fireEvent.click(screen.getByLabelText("Send refinement"));

    await waitFor(() => {
      expect(currentChanges()).toEqual([
        change({ kind: "rewrite", blockId: "e1", newText: "E1 v2", reason: "refined" }),
        change({ kind: "rewrite", blockId: "e2", newText: "E2 v1", reason: "r2" }),
      ]);
    });
  });

  it("keeps the proposal and reports no change on a no-op refine", async () => {
    seedProposal(twoRewrites());
    vi.mocked(editBlocks).mockResolvedValue({ chapterId: "ch1", summary: "", changes: [] });

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
    expect(currentChanges()).toEqual(twoRewrites());
  });
});
