// @vitest-environment happy-dom
//
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ai/operations", () => ({ critique: vi.fn() }));
vi.mock("@/components/app/editor", () => ({ scrollBlockIntoView: vi.fn() }));
vi.mock("@/components/app/right-panel/shared", () => ({
  AiComposer: () => <div />,
  AiError: () => <div>err</div>,
  AskedCaption: () => <div />,
  LoadingLines: () => <div />,
  PanelEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ScopeToggle: () => <div />,
}));

import { CritiqueTab } from "@/components/app/right-panel/critique-tab";
import { scrollBlockIntoView } from "@/components/app/editor";
import { useProjectStore } from "@/stores/project-store";
import { useAiCacheStore } from "@/stores/ai-cache-store";
import { useAiIntentStore } from "@/stores/ai-intent-store";
import { useViewStore } from "@/stores/view-store";
import type { CritiqueNote } from "@/lib/types";

const CACHE_KEY = "critique:ch1:cursor:b1";

const seedNotes = (notes: CritiqueNote[]) =>
  useAiCacheStore.setState({
    entries: { [CACHE_KEY]: { data: notes, loading: false, error: null } },
  });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  useProjectStore.setState({
    activeChapterId: "ch1",
    selectedId: "b1",
    selectedIds: [],
    blocks: [
      { id: "b1", type: "narration", text: "One.", raw: "", dirty: false },
      { id: "b2", type: "narration", text: "Two.", raw: "", dirty: false },
    ],
    meta: { ...useProjectStore.getState().meta, characters: [] },
  } as never);
  useAiCacheStore.setState({ entries: {} });
  useAiIntentStore.setState({ pending: null });
});

describe("CritiqueTab card actions", () => {
  it("jumps to the first live anchored block and selects it", () => {
    seedNotes([{ kind: "watch", tag: "Pacing", text: "Drags here.", blockIds: ["ghost", "b2"] }]);
    render(<CritiqueTab />);
    fireEvent.click(screen.getByText("Go to block"));
    expect(useProjectStore.getState().selectedId).toBe("b2");
    expect(vi.mocked(scrollBlockIntoView)).toHaveBeenCalledWith("b2");
  });

  it("offers no jump when no anchored id resolves", () => {
    seedNotes([{ kind: "idea", tag: "Voice", text: "Push it.", blockIds: ["ghost"] }]);
    render(<CritiqueTab />);
    expect(screen.queryByText("Go to block")).toBeNull();
  });

  it("Send to Edit dispatches the edit intent carrying the note", () => {
    seedNotes([{ kind: "watch", tag: "Pacing", text: "Drags here.", blockIds: ["b2"] }]);
    render(<CritiqueTab />);
    fireEvent.click(screen.getByText("Send to Edit"));
    expect(useAiIntentStore.getState().pending).toEqual({
      tab: "edit",
      instruction: "Drags here.",
      blockIds: ["b2"],
      scope: "block",
    });
    expect(useViewStore.getState().aiTab).toBe("edit");
  });

  it("a scene-level note sends chapter scope", () => {
    seedNotes([{ kind: "idea", tag: "Theme", text: "Sharpen the motif.", blockIds: [] }]);
    render(<CritiqueTab />);
    fireEvent.click(screen.getByText("Send to Edit"));
    expect(useAiIntentStore.getState().pending).toMatchObject({ tab: "edit", scope: "chapter" });
  });
});
