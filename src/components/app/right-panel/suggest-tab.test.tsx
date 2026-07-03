// @vitest-environment happy-dom
//
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ai/operations", () => ({ suggestContinuation: vi.fn() }));
vi.mock("@/components/app/editor", () => ({ scrollSelectedIntoView: vi.fn() }));
// The shared composer pulls in scroll/observer APIs happy-dom lacks; the result
// card (with "Insert below") lives in SuggestTab itself, so a stub composer is enough.
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

import { SuggestTab } from "@/components/app/right-panel/suggest-tab";
import { useProjectStore } from "@/stores/project-store";
import { useAiCacheStore } from "@/stores/ai-cache-store";
import { useAiIntentStore, dispatchAiIntent } from "@/stores/ai-intent-store";
import type { SuggestResult } from "@/lib/types";

afterEach(() => cleanup());

beforeEach(() => {
  useProjectStore.setState({
    activeChapterId: "ch1",
    selectedId: "B",
    blocks: [
      { id: "A", type: "narration", text: "Alpha.", raw: "", dirty: false },
      { id: "B", type: "narration", text: "Bravo.", raw: "", dirty: false },
    ],
    meta: { ...useProjectStore.getState().meta, characters: [] },
  } as never);
  useAiCacheStore.setState({ entries: {} });
  useAiIntentStore.setState({ pending: null });
});

describe("SuggestTab intents", () => {
  it("consumes a parked suggest intent: bumps the composer focusKey and prefills", () => {
    dispatchAiIntent({ tab: "suggest", instruction: "more tension" });
    render(<SuggestTab />);
    const composer = screen.getByTestId("composer");
    expect(composer.getAttribute("data-focus-key")).toBe("1");
    expect(composer.getAttribute("data-prefill")).toBe("more tension");
    expect(useAiIntentStore.getState().pending).toBeNull();
  });

  it("mounting without an intent leaves the composer unfocused (focusKey 0)", () => {
    render(<SuggestTab />);
    expect(screen.getByTestId("composer").getAttribute("data-focus-key")).toBe("0");
  });
});

describe("SuggestTab insert", () => {
  it("inserts the continuation after the block it was generated against, not the live caret", () => {
    const data: SuggestResult = {
      suggestions: [{ type: "narration", text: "CONTINUATION", rationale: "why" }],
      followups: [],
    };
    // Generated against block A; the caret has since moved to B (chapter scope keeps
    // the suggestion). Insert must follow A, the frozen anchor -- not the live caret.
    useAiCacheStore.setState({
      entries: {
        "suggest:ch1:cursor:B": { data, loading: false, error: null, anchorId: "A" },
      },
    });

    render(<SuggestTab />);
    fireEvent.click(screen.getByText("Insert below"));

    const blocks = useProjectStore.getState().blocks;
    expect(blocks.map((b) => b.text)).toEqual(["Alpha.", "CONTINUATION", "Bravo."]);
  });

  it("falls back to the live caret when the frozen anchor block was deleted", () => {
    const data: SuggestResult = {
      suggestions: [{ type: "narration", text: "CONTINUATION", rationale: "why" }],
      followups: [],
    };
    // The anchor was generated against a block since removed from the manuscript;
    // its id no longer resolves. Insert must fall back to the live caret (B), not
    // pass a dead id to insertAfter (which would prepend at the top of the chapter).
    useAiCacheStore.setState({
      entries: {
        "suggest:ch1:cursor:B": { data, loading: false, error: null, anchorId: "GHOST" },
      },
    });

    render(<SuggestTab />);
    fireEvent.click(screen.getByText("Insert below"));

    const blocks = useProjectStore.getState().blocks;
    expect(blocks.map((b) => b.text)).toEqual(["Alpha.", "Bravo.", "CONTINUATION"]);
  });
});
