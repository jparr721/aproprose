import { beforeEach, describe, expect, it } from "vitest";
import { useSearchSurfaceStore } from "@/stores/search-surface-store";

beforeEach(() => {
  useSearchSurfaceStore.setState({
    activeSurface: "editor",
    openSurface: null,
    focusRevision: 0,
  });
});

describe("search surface state", () => {
  it("opens the active surface and replaces the other open surface", () => {
    useSearchSurfaceStore.getState().openActive();
    expect(useSearchSurfaceStore.getState().openSurface).toBe("editor");

    useSearchSurfaceStore.getState().activate("pdf");
    useSearchSurfaceStore.getState().openActive();
    expect(useSearchSurfaceStore.getState().openSurface).toBe("pdf");
  });

  it("increments focus revision when an open surface is reopened", () => {
    useSearchSurfaceStore.getState().openActive();
    useSearchSurfaceStore.getState().openActive();
    expect(useSearchSurfaceStore.getState().focusRevision).toBe(2);
  });

  it("only closes the requested open surface", () => {
    useSearchSurfaceStore.getState().openActive();
    useSearchSurfaceStore.getState().close("pdf");
    expect(useSearchSurfaceStore.getState().openSurface).toBe("editor");
    useSearchSurfaceStore.getState().close("editor");
    expect(useSearchSurfaceStore.getState().openSurface).toBeNull();
  });

  it("returns to editor when the PDF surface becomes unavailable", () => {
    useSearchSurfaceStore.setState({
      activeSurface: "pdf",
      openSurface: "pdf",
      focusRevision: 3,
    });
    useSearchSurfaceStore.getState().removePdf();
    expect(useSearchSurfaceStore.getState()).toMatchObject({
      activeSurface: "editor",
      openSurface: null,
      focusRevision: 3,
    });
  });
});
