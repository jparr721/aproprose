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
    aiOpen: true,
    pdfOpen: false,
    outlineOpen: false,
    focus: false,
    buildErrorsOpen: false,
    pending: null,
    rightPanelWidth: 360,
  });
  useProjectStore.setState({ chapterDirty: false });
});

describe("view-store AI console", () => {
  it("removes the obsolete tab and rail state", () => {
    const state = useViewStore.getState();

    expect(state).not.toHaveProperty("aiTab");
    expect(state).not.toHaveProperty("aiCollapsed");
    expect(state).not.toHaveProperty("setAiTab");
    expect(state).not.toHaveProperty("setAiCollapsed");
    expect(state).not.toHaveProperty("openAiTab");
  });

  it("sets AI visibility explicitly without changing neighboring panes", () => {
    useViewStore.setState({ pdfOpen: true, outlineOpen: true });

    useViewStore.getState().setAiOpen(false);

    expect(useViewStore.getState().aiOpen).toBe(false);
    expect(useViewStore.getState().pdfOpen).toBe(true);
    expect(useViewStore.getState().outlineOpen).toBe(true);
    useViewStore.getState().setAiOpen(true);
    expect(useViewStore.getState().aiOpen).toBe(true);
  });

  it("toggleAi changes only AI visibility and clears focus", () => {
    useViewStore.setState({
      aiOpen: true,
      pdfOpen: true,
      outlineOpen: true,
      focus: true,
      rightPanelWidth: 412,
    });

    useViewStore.getState().toggleAi();

    expect(useViewStore.getState()).toMatchObject({
      aiOpen: false,
      pdfOpen: true,
      outlineOpen: true,
      focus: false,
      rightPanelWidth: 412,
    });
  });

  it("openAiConsole opens the dock and leaves the left sidebar outside this store", () => {
    useViewStore.setState({ aiOpen: false, focus: true });

    useViewStore.getState().openAiConsole();

    const state = useViewStore.getState();
    expect(state).toMatchObject({ aiOpen: true, focus: false });
    expect(state).not.toHaveProperty("sidebarOpen");
  });
});

describe("view-store applyLayoutPreset", () => {
  it("the two and three pane presets open the AI console", () => {
    useViewStore.setState({ aiOpen: false });
    useViewStore.getState().applyLayoutPreset("two");
    expect(useViewStore.getState().aiOpen).toBe(true);

    useViewStore.setState({ aiOpen: false });
    useViewStore.getState().applyLayoutPreset("three");
    expect(useViewStore.getState().aiOpen).toBe(true);
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
