import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

import { useViewStore } from "@/stores/view-store";
import { useProjectStore } from "@/stores/project-store";

beforeEach(() => {
  useViewStore.setState({
    aiTab: "suggest",
    aiCollapsed: false,
    buildErrorsOpen: false,
    pending: null,
  });
  useProjectStore.setState({ chapterDirty: false });
});

describe("view-store aiTab", () => {
  it("setAiTab switches the active tab, including the new 'edit' tab", () => {
    useViewStore.getState().setAiTab("edit");
    expect(useViewStore.getState().aiTab).toBe("edit");
  });

  it("can switch to the outline surface", () => {
    useViewStore.getState().setAiTab("outline");
    expect(useViewStore.getState().aiTab).toBe("outline");
  });

  it("setAiTab can switch to the muse tab", () => {
    useViewStore.getState().setAiTab("muse");
    expect(useViewStore.getState().aiTab).toBe("muse");
  });
});

describe("view-store aiCollapsed", () => {
  it("defaults to false and setAiCollapsed flips it", () => {
    expect(useViewStore.getState().aiCollapsed).toBe(false);
    useViewStore.getState().setAiCollapsed(true);
    expect(useViewStore.getState().aiCollapsed).toBe(true);
  });

  it("toggleAi reopening a collapsed panel restores content, not a bare rail", () => {
    // Collapse to the rail, close via the toggle, then reopen: the content must
    // show. Otherwise aiOpen + aiCollapsed disagree and the panel reopens collapsed.
    useViewStore.setState({ aiOpen: true, aiCollapsed: true });
    useViewStore.getState().toggleAi(); // close
    expect(useViewStore.getState().aiOpen).toBe(false);
    useViewStore.getState().toggleAi(); // reopen
    expect(useViewStore.getState().aiOpen).toBe(true);
    expect(useViewStore.getState().aiCollapsed).toBe(false);
  });
});

describe("view-store applyLayoutPreset", () => {
  it("the two/three presets clear the collapse flag so panel content shows", () => {
    useViewStore.setState({ aiCollapsed: true });
    useViewStore.getState().applyLayoutPreset("two");
    expect(useViewStore.getState().aiCollapsed).toBe(false);

    useViewStore.setState({ aiCollapsed: true });
    useViewStore.getState().applyLayoutPreset("three");
    expect(useViewStore.getState().aiCollapsed).toBe(false);
  });
});

describe("view-store buildErrorsOpen", () => {
  it("defaults to false and setBuildErrorsOpen flips it both ways", () => {
    expect(useViewStore.getState().buildErrorsOpen).toBe(false);
    useViewStore.getState().setBuildErrorsOpen(true);
    expect(useViewStore.getState().buildErrorsOpen).toBe(true);
    useViewStore.getState().setBuildErrorsOpen(false);
    expect(useViewStore.getState().buildErrorsOpen).toBe(false);
  });

  it("is ephemeral - excluded from the persisted snapshot", () => {
    useViewStore.getState().setBuildErrorsOpen(true);
    const opts = useViewStore.persist.getOptions();
    const persisted = opts.partialize
      ? opts.partialize(useViewStore.getState())
      : {};
    expect(persisted).not.toHaveProperty("buildErrorsOpen");
    expect(persisted).toEqual({
      aiTab: useViewStore.getState().aiTab,
      rightPanelWidth: useViewStore.getState().rightPanelWidth,
      pdfOpen: useViewStore.getState().pdfOpen,
      outlineOpen: useViewStore.getState().outlineOpen,
    });
  });
});

describe("view-store layout persistence", () => {
  it("persists the PDF and Outline open flags so a relaunch restores the layout", () => {
    useViewStore.setState({ pdfOpen: true, outlineOpen: true });
    const opts = useViewStore.persist.getOptions();
    const persisted = opts.partialize
      ? opts.partialize(useViewStore.getState())
      : {};
    expect(persisted).toMatchObject({ pdfOpen: true, outlineOpen: true });
  });
});

describe("view-store guarded action outcomes", () => {
  it("settles a canceled request without running its action", async () => {
    const action = vi.fn();
    useProjectStore.setState({ chapterDirty: true });

    const outcome = useViewStore.getState().requestGuarded(action);

    useViewStore.getState().cancelPending();

    await expect(outcome).resolves.toEqual({ status: "canceled" });
    expect(action).not.toHaveBeenCalled();
    expect(useViewStore.getState().pending).toBeNull();
  });

  it("cancels a replaced request and runs only the confirmed replacement", async () => {
    const firstAction = vi.fn();
    const replacementAction = vi.fn();
    useProjectStore.setState({ chapterDirty: true });

    const firstOutcome = useViewStore.getState().requestGuarded(firstAction);
    const replacementOutcome = useViewStore
      .getState()
      .requestGuarded(replacementAction);

    await expect(firstOutcome).resolves.toEqual({ status: "canceled" });
    expect(firstAction).not.toHaveBeenCalled();
    expect(replacementAction).not.toHaveBeenCalled();

    useViewStore.getState().confirmPending();

    await expect(replacementOutcome).resolves.toEqual({
      status: "ran",
      value: undefined,
    });
    expect(replacementAction).toHaveBeenCalledOnce();
  });
});
