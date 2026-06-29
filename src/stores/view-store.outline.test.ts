import { beforeEach, describe, expect, it } from "vitest";
import { useViewStore } from "@/stores/view-store";

describe("view-store outline toggle", () => {
  beforeEach(() => {
    useViewStore.setState({ outlineOpen: false, pdfOpen: false, focus: false });
  });

  it("defaults outlineOpen to false", () => {
    expect(useViewStore.getState().outlineOpen).toBe(false);
  });

  it("toggleOutline flips outlineOpen", () => {
    useViewStore.getState().toggleOutline();
    expect(useViewStore.getState().outlineOpen).toBe(true);
    useViewStore.getState().toggleOutline();
    expect(useViewStore.getState().outlineOpen).toBe(false);
  });

  it("toggleOutline clears focus but leaves pdfOpen independent", () => {
    useViewStore.setState({ focus: true, pdfOpen: true });
    useViewStore.getState().toggleOutline();
    const s = useViewStore.getState();
    expect(s.outlineOpen).toBe(true);
    expect(s.focus).toBe(false);
    expect(s.pdfOpen).toBe(true);
  });

  it("persists outlineOpen so a relaunch reopens the storyboard", () => {
    useViewStore.getState().toggleOutline();
    const persisted = JSON.parse(
      JSON.stringify(useViewStore.persist.getOptions().partialize!(useViewStore.getState())),
    );
    expect(persisted).toStrictEqual({
      aiTab: useViewStore.getState().aiTab,
      rightPanelWidth: useViewStore.getState().rightPanelWidth,
      pdfOpen: useViewStore.getState().pdfOpen,
      outlineOpen: useViewStore.getState().outlineOpen,
    });
    expect(persisted.outlineOpen).toBe(true);
  });
});
