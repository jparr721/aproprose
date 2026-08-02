import { describe, it, expect, beforeEach, vi } from "vitest";

const storage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: storage,
}));

import { useViewStore } from "@/stores/view-store";
import { useProjectStore } from "@/stores/project-store";

beforeEach(() => {
  storage.getItem.mockReset();
  storage.getItem.mockResolvedValue(null);
  storage.setItem.mockReset();
  storage.setItem.mockResolvedValue(undefined);
  storage.removeItem.mockReset();
  storage.removeItem.mockResolvedValue(undefined);
  useViewStore.setState(useViewStore.getInitialState(), true);
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

describe("view-store manuscript review lifecycle", () => {
  it("starts with no manuscript review open", () => {
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
  });

  it("opens a manuscript review without changing AI or PDF visibility", () => {
    useViewStore.setState({
      aiOpen: false,
      pdfOpen: true,
      outlineOpen: true,
      focus: true,
    });

    useViewStore.getState().openManuscriptReview("proposal-1");

    expect(useViewStore.getState()).toMatchObject({
      manuscriptReviewProposalId: "proposal-1",
      aiOpen: false,
      pdfOpen: true,
      outlineOpen: false,
      focus: false,
    });
  });

  it("closes only the manuscript review", () => {
    useViewStore.setState({
      manuscriptReviewProposalId: "proposal-1",
      aiOpen: false,
      pdfOpen: true,
      outlineOpen: false,
      focus: true,
      buildErrorsOpen: true,
      rightPanelWidth: 444,
    });

    useViewStore.getState().closeManuscriptReview();

    expect(useViewStore.getState()).toMatchObject({
      manuscriptReviewProposalId: null,
      aiOpen: false,
      pdfOpen: true,
      outlineOpen: false,
      focus: true,
      buildErrorsOpen: true,
      rightPanelWidth: 444,
    });
  });

  it("opening the outline directly replaces manuscript review", () => {
    useViewStore.setState({ manuscriptReviewProposalId: "proposal-1" });

    useViewStore.getState().openOutline();

    expect(useViewStore.getState()).toMatchObject({
      manuscriptReviewProposalId: null,
      outlineOpen: true,
    });
  });

  it("opening the outline through its toggle replaces manuscript review", () => {
    useViewStore.setState({
      manuscriptReviewProposalId: "proposal-1",
      outlineOpen: false,
    });

    useViewStore.getState().toggleOutline();

    expect(useViewStore.getState()).toMatchObject({
      manuscriptReviewProposalId: null,
      outlineOpen: true,
    });
  });

  it("excludes manuscript review identity and actions from persistence", () => {
    useViewStore.getState().openManuscriptReview("proposal-1");
    const opts = useViewStore.persist.getOptions();
    const persisted = opts.partialize
      ? opts.partialize(useViewStore.getState())
      : {};

    expect(persisted).not.toHaveProperty("manuscriptReviewProposalId");
    expect(persisted).not.toHaveProperty("openManuscriptReview");
    expect(persisted).not.toHaveProperty("closeManuscriptReview");
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

  it("hydrates only current layout fields from a saved state with unknown fields", async () => {
    useViewStore.setState({ aiOpen: false, focus: true });
    storage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        state: {
          rightPanelWidth: 488,
          pdfOpen: true,
          outlineOpen: true,
          manuscriptReviewProposalId: "persisted-proposal",
          obsoleteLayout: true,
        },
        version: 0,
      }),
    );

    await useViewStore.persist.rehydrate();

    const state = useViewStore.getState();
    expect(state).toMatchObject({
      rightPanelWidth: 488,
      pdfOpen: true,
      outlineOpen: true,
      aiOpen: false,
      focus: true,
      manuscriptReviewProposalId: null,
    });
    expect(state).not.toHaveProperty("obsoleteLayout");
    expect(state).not.toHaveProperty("sidebarOpen");
    expect(state.toggleAi).toBeTypeOf("function");
    expect(state.openAiConsole).toBeTypeOf("function");
  });

  it("rejects malformed required persisted layout values as one state", async () => {
    useViewStore.setState({
      rightPanelWidth: 401,
      pdfOpen: false,
      outlineOpen: false,
    });
    storage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        state: {
          rightPanelWidth: "wide",
          pdfOpen: true,
          outlineOpen: true,
        },
        version: 0,
      }),
    );

    await useViewStore.persist.rehydrate();

    expect(useViewStore.getState()).toMatchObject({
      rightPanelWidth: 401,
      pdfOpen: false,
      outlineOpen: false,
    });
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
