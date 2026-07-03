// @vitest-environment happy-dom
//
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ai/operations", () => ({ continuityCheck: vi.fn() }));
vi.mock("@/components/app/editor", () => ({ scrollBlockIntoView: vi.fn() }));
vi.mock("@/components/app/right-panel/shared", () => ({
  AiComposer: () => <div />,
  AiError: () => <div>err</div>,
  AskedCaption: () => <div />,
  LoadingLines: () => <div />,
  PanelEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ScopeToggle: () => <div />,
}));

import { ContinuityTab } from "@/components/app/right-panel/continuity-tab";
import { scrollBlockIntoView } from "@/components/app/editor";
import { useProjectStore } from "@/stores/project-store";
import { useAiCacheStore } from "@/stores/ai-cache-store";
import { useAiIntentStore } from "@/stores/ai-intent-store";
import type { ContinuityFlag } from "@/lib/types";

const CACHE_KEY = "continuity:ch1:cursor:b1";

const seedFlags = (flags: ContinuityFlag[]) =>
  useAiCacheStore.setState({
    entries: { [CACHE_KEY]: { data: flags, loading: false, error: null } },
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

describe("ContinuityTab card actions", () => {
  it("jumps to the anchored block and selects it", () => {
    seedFlags([{ sev: "flag", tag: "Props", text: "The knife moved.", blockIds: ["b2"] }]);
    render(<ContinuityTab />);
    fireEvent.click(screen.getByText("Go to block"));
    expect(useProjectStore.getState().selectedId).toBe("b2");
    expect(vi.mocked(scrollBlockIntoView)).toHaveBeenCalledWith("b2");
  });

  it("offers no jump for a scene-level flag but still offers Send to Edit", () => {
    seedFlags([{ sev: "warn", tag: "Timeline", text: "Day drifts.", blockIds: [] }]);
    render(<ContinuityTab />);
    expect(screen.queryByText("Go to block")).toBeNull();
    fireEvent.click(screen.getByText("Send to Edit"));
    expect(useAiIntentStore.getState().pending).toEqual({
      tab: "edit",
      instruction: "Day drifts.",
      blockIds: [],
      scope: "chapter",
    });
  });
});
