// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchCoordinator } from "@/components/app/search-coordinator";
import { useSearchSurfaceStore } from "@/stores/search-surface-store";

const keybinding = vi.hoisted(() => ({
  callback: null as (() => void) | null,
}));

vi.mock("@/hooks/use-keybinding", () => ({
  useKeybinding: (_id: unknown, callback: () => void): void => {
    keybinding.callback = callback;
  },
}));

afterEach(() => cleanup());

beforeEach(() => {
  keybinding.callback = null;
  useSearchSurfaceStore.setState({
    activeSurface: "editor",
    openSurface: null,
    focusRevision: 0,
  });
});

describe("SearchCoordinator", () => {
  it("opens whichever surface is active", () => {
    render(<SearchCoordinator pdfAvailable={true} />);
    useSearchSurfaceStore.getState().activate("pdf");
    act(() => keybinding.callback?.());
    expect(useSearchSurfaceStore.getState().openSurface).toBe("pdf");
  });

  it("removes PDF activation when the pane is unavailable", () => {
    const view = render(<SearchCoordinator pdfAvailable={true} />);
    useSearchSurfaceStore.setState({
      activeSurface: "pdf",
      openSurface: "pdf",
    });
    view.rerender(<SearchCoordinator pdfAvailable={false} />);
    expect(useSearchSurfaceStore.getState()).toMatchObject({
      activeSurface: "editor",
      openSurface: null,
    });
  });
});
