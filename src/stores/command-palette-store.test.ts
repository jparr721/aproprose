import { describe, it, expect, beforeEach } from "vitest";
import { useCommandPaletteStore } from "@/stores/command-palette-store";

const reset = () =>
  useCommandPaletteStore.setState({ open: false, page: "root", recentIds: [] });

describe("command palette store", () => {
  beforeEach(reset);

  it("records recents most-recent-first, deduped, capped at 5", () => {
    const { recordRun } = useCommandPaletteStore.getState();
    recordRun("a");
    recordRun("b");
    recordRun("a"); // re-running moves it back to the front
    expect(useCommandPaletteStore.getState().recentIds).toEqual(["a", "b"]);

    recordRun("c");
    recordRun("d");
    recordRun("e");
    recordRun("f");
    const ids = useCommandPaletteStore.getState().recentIds;
    expect(ids).toHaveLength(5);
    expect(ids[0]).toBe("f");
    expect(ids).not.toContain("b"); // oldest dropped past the cap
  });

  it("pushPage drills in; popToRoot returns", () => {
    useCommandPaletteStore.getState().pushPage("chapters");
    expect(useCommandPaletteStore.getState().page).toBe("chapters");
    useCommandPaletteStore.getState().popToRoot();
    expect(useCommandPaletteStore.getState().page).toBe("root");
  });

  it("openPalette resets to root; togglePalette flips open", () => {
    useCommandPaletteStore.setState({ page: "projects" });
    useCommandPaletteStore.getState().openPalette();
    expect(useCommandPaletteStore.getState().open).toBe(true);
    expect(useCommandPaletteStore.getState().page).toBe("root");

    useCommandPaletteStore.getState().togglePalette();
    expect(useCommandPaletteStore.getState().open).toBe(false);

    useCommandPaletteStore.setState({ page: "chapters" });
    useCommandPaletteStore.getState().togglePalette();
    expect(useCommandPaletteStore.getState().open).toBe(true);
    expect(useCommandPaletteStore.getState().page).toBe("root");
  });
});
