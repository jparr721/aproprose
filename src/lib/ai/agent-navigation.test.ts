// @vitest-environment happy-dom

import { cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

vi.mock("@/lib/tauri", () => ({
  appendAgentFailureLog: vi.fn(),
  compileProject: vi.fn(),
  openProject: vi.fn(),
  createProject: vi.fn(),
  writeSkeleton: vi.fn(),
  deleteChapterCmd: vi.fn(),
  migrateToManaged: vi.fn(),
  pickProjectDir: vi.fn(),
  readAppData: vi.fn().mockResolvedValue(null),
  readPdf: vi.fn().mockResolvedValue(null),
  readProjectMeta: vi.fn().mockResolvedValue(null),
  readTextFile: vi.fn(),
  writeAppData: vi.fn().mockResolvedValue(undefined),
  writeProjectMeta: vi.fn().mockResolvedValue(undefined),
  writeTextFile: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

import {
  blockFingerprint,
  blockSnapshotText,
  cardFingerprint,
  cardSnapshotText,
  findingFingerprint,
} from "@/lib/ai/agent-context";
import { Editor } from "@/components/app/editor";
import {
  navigateToContextSnapshot,
  navigateToProposalChange,
  openManuscriptProposalInEditor,
} from "@/lib/ai/agent-navigation";
import type {
  AgentUIMessage,
  ContextSnapshot,
  ManuscriptPendingChange,
  ManuscriptPendingProposal,
  OutlinePendingChange,
  SourceLocator,
} from "@/lib/ai/agent-types";
import { parseChapter } from "@/lib/latex";
import { readTextFile } from "@/lib/tauri";
import { emptyProjectKnowledge } from "@/lib/story-knowledge/model";
import type { Block, Card, ProjectInfo } from "@/lib/types";
import {
  EMPTY_AGENT_STATE,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { useOutlineBoardStore } from "@/stores/outline-board-store";
import { useProjectStore } from "@/stores/project-store";
import { useSyncStore } from "@/stores/sync-store";
import { useViewStore } from "@/stores/view-store";

const projectFixture = (): ProjectInfo => ({
  root: "/book",
  name: "Book",
  mainFile: "main.tex",
  title: "Book",
  author: "Author",
  metadata: {
    title: "Book",
    subtitle: "",
    author: "Author",
    publisher: "",
    isbn: "",
  },
  chapters: [
    {
      id: "ch1",
      label: "I",
      title: "One",
      file: "one.tex",
      wordCount: 2,
    },
    {
      id: "ch2",
      label: "II",
      title: "Two",
      file: "two.tex",
      wordCount: 3,
    },
  ],
});

const blockFixture = (id: string, text: string): Block => ({
  id,
  type: "narration",
  text,
  raw: `${text}\n`,
  dirty: false,
});

const cardFixture = (id: string, title: string): Card => ({
  id,
  title,
  intention: "Force the choice",
  characterIds: [],
  loreIds: [],
  continuityFlags: [],
});

const blockLocator = (block: Block, order: number): SourceLocator => ({
  sourceId: block.id,
  order,
  fingerprint: blockFingerprint(block),
  sourceType: block.type,
  label: "Narration block",
  exactText: block.text,
  previewText: blockSnapshotText(block),
});

const appendChange = (): ManuscriptPendingChange => ({
  id: "append-change",
  change: {
    kind: "insert",
    blockId: null,
    afterId: null,
    type: "narration",
    speaker: null,
    newText: "A final line.",
    toIndex: null,
    reason: "Complete the chapter",
  },
  precondition: {
    kind: "insert",
    boundary: "immediate",
    anchor: null,
    expectedNext: null,
  },
});

const outlineAddChange = (): OutlinePendingChange => ({
  id: "outline-add",
  change: {
    kind: "add",
    cardId: null,
    title: "The final turn",
    intention: "Force the choice",
    toIndex: null,
    reason: "Complete the outline",
  },
  precondition: {
    kind: "outline-order",
    orderFingerprint: "811c9dc5",
  },
});

const manuscriptProposal = (
  id: string,
  projectRoot: string,
  chapterId: string,
  changes: ManuscriptPendingChange[],
): ManuscriptPendingProposal => ({
  id,
  kind: "manuscript",
  projectRoot,
  chapterId,
  summary: "Review the manuscript changes",
  createdAt: "2026-08-01T00:00:00.000Z",
  originatingMessageId: "assistant-1",
  changes,
});

const snapshotFixture = (
  block: Block,
  order: number,
  chapterId: string,
): ContextSnapshot => ({
  id: "snapshot-1",
  kind: "block",
  chapterId,
  sourceId: block.id,
  order,
  sourceType: block.type,
  label: "Narration block",
  exactText: block.text,
  sourceFingerprint: blockFingerprint(block),
});

const addScrollTarget = (attribute: string, id: string): HTMLElement => {
  const element = document.createElement("div");
  element.setAttribute(attribute, id);
  document.body.append(element);
  return element;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readTextFile).mockReset();
  vi.stubGlobal("CSS", { escape: (value: string): string => value });
  vi.stubGlobal(
    "requestAnimationFrame",
    (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  useAgentConsoleStore.setState({
    ...EMPTY_AGENT_STATE,
    messages: [],
    requestedProjectRoot: "/book",
    activeProjectRoot: "/book",
    hydratedProjectRoot: "/book",
  });
  useOutlineBoardStore.setState({
    openChapterId: null,
    highlightedCardId: null,
  });
  useViewStore.setState({
    outlineOpen: false,
    manuscriptReviewProposalId: null,
    focus: false,
    pending: null,
  });
  useProjectStore.setState(useProjectStore.getInitialState(), true);
  useProjectStore.setState({
    project: projectFixture(),
    activeChapterId: "ch1",
    blocks: [],
    selectedId: null,
    selectedIds: [],
    editing: false,
    editCaret: null,
    chapterDirty: false,
    meta: {
      version: 2,
      characters: [],
      lore: [],
      statuses: {},
      outline: { premise: "", overview: "" },
      chapters: {
        ch1: {
          act: null,
          plotPoint: null,
          premise: "",
          goal: "",
          conflict: "",
          turn: "",
          characterIds: [],
          cards: [],
        },
        ch2: {
          act: null,
          plotPoint: null,
          premise: "",
          goal: "",
          conflict: "",
          turn: "",
          characterIds: [],
          cards: [],
        },
      },
      knowledge: emptyProjectKnowledge(),
    },
  } as never);
  useSyncStore.setState({ conflictedFiles: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Editor navigation target", () => {
  it("mounts one stable target at the end of the active chapter", () => {
    const { container } = render(createElement(Editor));

    expect(container.querySelectorAll("[data-editor-end]")).toHaveLength(1);
  });
});

describe("navigateToContextSnapshot", () => {
  it("relocates a reminted active-chapter block by order and fingerprint", async () => {
    const frozen = blockFixture("old-id", "The same paragraph.");
    const reminted = blockFixture("new-id", "The same paragraph.");
    useProjectStore.setState({ blocks: [reminted] });
    const target = addScrollTarget("data-block-id", reminted.id);

    await expect(
      navigateToContextSnapshot(snapshotFixture(frozen, 0, "ch1")),
    ).resolves.toBe(true);

    expect(useProjectStore.getState().selectedId).toBe(reminted.id);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("navigates a sent snapshot to its exact live id after the text changes", async () => {
    const frozen = blockFixture("stable-id", "The original paragraph.");
    const live = blockFixture("stable-id", "The author revised this paragraph.");
    useProjectStore.setState({ blocks: [live] });
    const target = addScrollTarget("data-block-id", live.id);

    await expect(
      navigateToContextSnapshot(snapshotFixture(frozen, 0, "ch1")),
    ).resolves.toBe(true);

    expect(useProjectStore.getState().selectedId).toBe(live.id);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("routes an inactive chapter through the dirty guard and awaits selection", async () => {
    const source = "The second chapter paragraph.";
    const frozen = parseChapter(source)[0];
    vi.mocked(readTextFile).mockResolvedValue(source);
    const requestGuarded = vi.spyOn(
      useViewStore.getState(),
      "requestGuarded",
    );

    const didNavigate = await navigateToContextSnapshot(
      snapshotFixture(frozen, 0, "ch2"),
    );

    expect(didNavigate).toBe(true);
    expect(requestGuarded).toHaveBeenCalledOnce();
    expect(useProjectStore.getState().activeChapterId).toBe("ch2");
    expect(useProjectStore.getState().selectedId).toBe(
      useProjectStore.getState().blocks[0].id,
    );
  });

  it("returns false when a sent source was deleted", async () => {
    const frozen = blockFixture("deleted-id", "Deleted prose.");
    useProjectStore.setState({
      blocks: [blockFixture("other-id", "Other prose.")],
    });

    await expect(
      navigateToContextSnapshot(snapshotFixture(frozen, 0, "ch1")),
    ).resolves.toBe(false);
    expect(useProjectStore.getState().selectedId).toBeNull();
  });

  it("returns the unresolved result after guarded inactive navigation runs", async () => {
    const frozen = parseChapter("The missing inactive paragraph.")[0];
    vi.mocked(readTextFile).mockResolvedValue("A different live paragraph.");
    useProjectStore.setState({ chapterDirty: true });

    const navigation = navigateToContextSnapshot(
      snapshotFixture(frozen, 0, "ch2"),
    );
    let settled = false;
    void navigation.then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(useViewStore.getState().pending).not.toBeNull();
    expect(useProjectStore.getState().activeChapterId).toBe("ch1");

    useViewStore.getState().confirmPending();

    await expect(navigation).resolves.toBe(false);
    expect(useProjectStore.getState().activeChapterId).toBe("ch2");
    expect(useProjectStore.getState().selectedId).toBeNull();
  });

  it("selects the first live linked block for a finding", async () => {
    const linked = blockFixture("linked-2", "Live linked prose.");
    useProjectStore.setState({ blocks: [linked] });
    const finding = {
      kind: "watch" as const,
      tag: "Pacing",
      text: "The middle slows.",
      blockIds: ["deleted-1", "linked-2"],
    };
    const findingMessage: AgentUIMessage = {
      id: "assistant-1",
      role: "assistant",
      metadata: {
        runId: "run-1",
        mode: "edit",
        task: { kind: "chapter-analysis", chapterId: "ch1", analysis: "critique" },
        state: "complete",
        createdAt: "2026-07-30T00:00:00.000Z",
        error: null,
        errorCode: null,
        retryOf: null,
        usage: null,
      },
      parts: [
        {
          type: "data-findings",
          data: {
            kind: "critique",
            chapterId: "ch1",
            items: [finding],
          },
        },
      ],
    };
    useAgentConsoleStore.setState({ messages: [findingMessage] });
    const snapshot: ContextSnapshot = {
      id: "finding-snapshot",
      kind: "finding",
      chapterId: "ch1",
      sourceId: "assistant-1:0",
      order: 0,
      sourceType: "critique",
      label: "Pacing",
      exactText: "The middle slows.",
      sourceFingerprint: findingFingerprint(finding),
    };

    await expect(navigateToContextSnapshot(snapshot)).resolves.toBe(true);
    expect(useProjectStore.getState().selectedId).toBe("linked-2");
  });
});

describe("openManuscriptProposalInEditor", () => {
  it("opens a proposal for the active chapter without using the dirty guard", async () => {
    const proposal = manuscriptProposal(
      "proposal-1",
      "/book",
      "ch1",
      [appendChange()],
    );
    useAgentConsoleStore.setState({ pendingProposal: proposal });
    const requestGuarded = vi.spyOn(
      useViewStore.getState(),
      "requestGuarded",
    );

    await expect(openManuscriptProposalInEditor(proposal)).resolves.toBe(true);

    expect(requestGuarded).not.toHaveBeenCalled();
    expect(useViewStore.getState().manuscriptReviewProposalId).toBe(proposal.id);
  });

  it("guards chapter selection before opening an inactive proposal", async () => {
    const proposal = manuscriptProposal(
      "proposal-1",
      "/book",
      "ch2",
      [appendChange()],
    );
    useAgentConsoleStore.setState({ pendingProposal: proposal });
    vi.mocked(readTextFile).mockResolvedValue("");
    const requestGuarded = vi.spyOn(
      useViewStore.getState(),
      "requestGuarded",
    );

    await expect(openManuscriptProposalInEditor(proposal)).resolves.toBe(true);

    expect(requestGuarded).toHaveBeenCalledOnce();
    expect(useProjectStore.getState().activeChapterId).toBe("ch2");
    expect(useViewStore.getState().manuscriptReviewProposalId).toBe(proposal.id);
  });

  it("settles a canceled dirty guard without opening review", async () => {
    const proposal = manuscriptProposal(
      "proposal-1",
      "/book",
      "ch2",
      [appendChange()],
    );
    useAgentConsoleStore.setState({ pendingProposal: proposal });
    useProjectStore.setState({ chapterDirty: true });

    const opening = openManuscriptProposalInEditor(proposal);
    expect(useViewStore.getState().pending).not.toBeNull();
    useViewStore.getState().cancelPending();

    await expect(opening).resolves.toBe(false);
    expect(useProjectStore.getState().activeChapterId).toBe("ch1");
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
  });

  it("returns false when no project is open", async () => {
    const proposal = manuscriptProposal(
      "proposal-1",
      "/book",
      "ch1",
      [appendChange()],
    );
    useAgentConsoleStore.setState({ pendingProposal: proposal });
    useProjectStore.setState({ project: null });

    await expect(openManuscriptProposalInEditor(proposal)).resolves.toBe(false);
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
  });

  it("returns false when the open project has another root", async () => {
    const proposal = manuscriptProposal(
      "proposal-1",
      "/book",
      "ch1",
      [appendChange()],
    );
    useAgentConsoleStore.setState({ pendingProposal: proposal });
    useProjectStore.setState({
      project: { ...projectFixture(), root: "/another-book" },
    });

    await expect(openManuscriptProposalInEditor(proposal)).resolves.toBe(false);
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
  });

  it("returns false when the proposal chapter no longer exists", async () => {
    const proposal = manuscriptProposal(
      "proposal-1",
      "/book",
      "ch2",
      [appendChange()],
    );
    useAgentConsoleStore.setState({ pendingProposal: proposal });
    useProjectStore.setState({
      project: {
        ...projectFixture(),
        chapters: projectFixture().chapters.filter(
          (chapter) => chapter.id !== "ch2",
        ),
      },
    });

    await expect(openManuscriptProposalInEditor(proposal)).resolves.toBe(false);
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
  });

  it("returns false when guarded chapter selection fails", async () => {
    const proposal = manuscriptProposal(
      "proposal-1",
      "/book",
      "ch2",
      [appendChange()],
    );
    useAgentConsoleStore.setState({ pendingProposal: proposal });
    vi.mocked(readTextFile).mockRejectedValue(new Error("Chapter unavailable"));

    await expect(openManuscriptProposalInEditor(proposal)).resolves.toBe(false);
    expect(useProjectStore.getState().activeChapterId).toBe("ch1");
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
  });

  it("does not open a proposal replaced during chapter selection", async () => {
    const proposal = manuscriptProposal(
      "proposal-1",
      "/book",
      "ch2",
      [appendChange()],
    );
    const replacement = manuscriptProposal(
      "proposal-2",
      "/book",
      "ch2",
      [appendChange()],
    );
    useAgentConsoleStore.setState({ pendingProposal: proposal });
    let resolveSource: ((source: string) => void) | null = null;
    vi.mocked(readTextFile).mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveSource = resolve;
      }),
    );

    const opening = openManuscriptProposalInEditor(proposal);
    await waitFor(() => expect(readTextFile).toHaveBeenCalledOnce());
    useAgentConsoleStore.setState({ pendingProposal: replacement });
    if (resolveSource === null) throw new Error("Expected a pending chapter read");
    resolveSource("");

    await expect(opening).resolves.toBe(false);
    expect(useAgentConsoleStore.getState().pendingProposal).toBe(replacement);
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
  });

  it("revalidates the project root after chapter selection", async () => {
    const proposal = manuscriptProposal(
      "proposal-1",
      "/book",
      "ch2",
      [appendChange()],
    );
    useAgentConsoleStore.setState({ pendingProposal: proposal });
    let resolveSource: ((source: string) => void) | null = null;
    vi.mocked(readTextFile).mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveSource = resolve;
      }),
    );

    const opening = openManuscriptProposalInEditor(proposal);
    await waitFor(() => expect(readTextFile).toHaveBeenCalledOnce());
    useProjectStore.setState({
      project: { ...projectFixture(), root: "/replacement-book" },
    });
    if (resolveSource === null) throw new Error("Expected a pending chapter read");
    resolveSource("");

    await expect(opening).resolves.toBe(false);
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
  });

  it("revalidates the active chapter after guarded selection", async () => {
    const proposal = manuscriptProposal(
      "proposal-1",
      "/book",
      "ch2",
      [appendChange()],
    );
    useAgentConsoleStore.setState({ pendingProposal: proposal });
    vi.spyOn(
      useProjectStore.getState(),
      "selectChapter",
    ).mockImplementation(async (chapterId) => {
      useProjectStore.setState({ activeChapterId: chapterId });
      queueMicrotask(() => {
        useProjectStore.setState({ activeChapterId: "ch1" });
      });
    });

    await expect(openManuscriptProposalInEditor(proposal)).resolves.toBe(false);
    expect(useProjectStore.getState().activeChapterId).toBe("ch1");
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
  });

  it("scrolls the first projected decision row into view", async () => {
    const first = blockFixture("first", "First paragraph.");
    const second = blockFixture("second", "Second paragraph.");
    const secondChange: ManuscriptPendingChange = {
      id: "second-change",
      change: {
        kind: "rewrite",
        blockId: second.id,
        afterId: null,
        type: null,
        speaker: null,
        newText: "Revised second paragraph.",
        toIndex: null,
        reason: "Revise the second paragraph",
      },
      precondition: { kind: "target", target: blockLocator(second, 1) },
    };
    const firstChange: ManuscriptPendingChange = {
      id: "first-change",
      change: {
        kind: "rewrite",
        blockId: first.id,
        afterId: null,
        type: null,
        speaker: null,
        newText: "Revised first paragraph.",
        toIndex: null,
        reason: "Revise the first paragraph",
      },
      precondition: { kind: "target", target: blockLocator(first, 0) },
    };
    const proposal = manuscriptProposal(
      "proposal-1",
      "/book",
      "ch1",
      [secondChange, firstChange],
    );
    useProjectStore.setState({ blocks: [first, second] });
    useAgentConsoleStore.setState({ pendingProposal: proposal });
    const firstTarget = addScrollTarget(
      "data-agent-decision-change-id",
      firstChange.id,
    );
    const secondTarget = addScrollTarget(
      "data-agent-decision-change-id",
      secondChange.id,
    );
    firstTarget.scrollIntoView = vi.fn();
    secondTarget.scrollIntoView = vi.fn();

    await expect(openManuscriptProposalInEditor(proposal)).resolves.toBe(true);

    expect(firstTarget.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(secondTarget.scrollIntoView).not.toHaveBeenCalled();
  });
});

describe("navigateToProposalChange", () => {
  it("opens a valid sparse empty outline for an add change", async () => {
    useProjectStore.setState((state) => ({
      meta: { ...state.meta, chapters: {} },
    }));

    await expect(
      navigateToProposalChange("ch1", outlineAddChange()),
    ).resolves.toBe(true);

    expect(useViewStore.getState().outlineOpen).toBe(true);
    expect(useOutlineBoardStore.getState().highlightedCardId).toBeNull();
  });

  it("does not open a neighboring outline for a deleted chapter", async () => {
    const neighbor = cardFixture("neighbor-card", "Neighboring chapter");
    useProjectStore.setState((state) => ({
      project: {
        ...projectFixture(),
        chapters: projectFixture().chapters.filter(
          (chapter) => chapter.id !== "ch1",
        ),
      },
      meta: {
        ...state.meta,
        chapters: {
          ch2: { ...state.meta.chapters.ch2, cards: [neighbor] },
        },
      },
    }));
    const neighborTarget = addScrollTarget(
      "data-outline-card-id",
      neighbor.id,
    );

    await expect(
      navigateToProposalChange("ch1", outlineAddChange()),
    ).resolves.toBe(false);

    expect(useViewStore.getState().outlineOpen).toBe(false);
    expect(useOutlineBoardStore.getState().highlightedCardId).toBeNull();
    expect(neighborTarget.scrollIntoView).not.toHaveBeenCalled();
  });

  it("navigates an active append insert to the exact editor end", async () => {
    const neighbor = blockFixture("neighbor-id", "Neighboring prose.");
    useProjectStore.setState({ blocks: [neighbor], selectedId: neighbor.id });
    const target = document.createElement("div");
    target.setAttribute("data-editor-end", "");
    document.body.append(target);

    await expect(
      navigateToProposalChange("ch1", appendChange()),
    ).resolves.toBe(true);

    expect(useProjectStore.getState().selectedId).toBeNull();
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "end" });
  });

  it("guards an inactive append insert and clears the loaded selection", async () => {
    vi.mocked(readTextFile).mockResolvedValue("Loaded neighboring prose.");
    const requestGuarded = vi.spyOn(
      useViewStore.getState(),
      "requestGuarded",
    );
    const target = document.createElement("div");
    target.setAttribute("data-editor-end", "");
    document.body.append(target);

    await expect(
      navigateToProposalChange("ch2", appendChange()),
    ).resolves.toBe(true);

    expect(requestGuarded).toHaveBeenCalledOnce();
    expect(useProjectStore.getState().activeChapterId).toBe("ch2");
    expect(useProjectStore.getState().selectedId).toBeNull();
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "end" });
  });

  it("navigates an empty chapter append to its editor end", async () => {
    vi.mocked(readTextFile).mockResolvedValue("");
    const target = document.createElement("div");
    target.setAttribute("data-editor-end", "");
    document.body.append(target);

    await expect(
      navigateToProposalChange("ch2", appendChange()),
    ).resolves.toBe(true);

    expect(useProjectStore.getState().activeChapterId).toBe("ch2");
    expect(useProjectStore.getState().blocks).toEqual([]);
    expect(useProjectStore.getState().selectedId).toBeNull();
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "end" });
  });

  it("settles a canceled guarded append navigation as false", async () => {
    vi.mocked(readTextFile).mockResolvedValue("Loaded prose.");
    useProjectStore.setState({ chapterDirty: true });

    const navigation = navigateToProposalChange("ch2", appendChange());
    useViewStore.getState().cancelPending();

    await expect(navigation).resolves.toBe(false);
    expect(useProjectStore.getState().activeChapterId).toBe("ch1");
    expect(useProjectStore.getState().selectedId).toBeNull();
  });

  it("does not navigate an append insert after its chapter is deleted", async () => {
    useProjectStore.setState({
      project: { ...projectFixture(), chapters: [] },
      selectedId: "neighbor-id",
    });
    const target = document.createElement("div");
    target.setAttribute("data-editor-end", "");
    document.body.append(target);

    await expect(
      navigateToProposalChange("ch1", appendChange()),
    ).resolves.toBe(false);

    expect(useProjectStore.getState().selectedId).toBe("neighbor-id");
    expect(target.scrollIntoView).not.toHaveBeenCalled();
  });

  it("uses a manuscript frozen locator instead of the stale raw change id", async () => {
    const frozen = blockFixture("frozen-id", "Unchanged prose.");
    const reminted = blockFixture("reminted-id", "Unchanged prose.");
    useProjectStore.setState({ blocks: [reminted] });
    const target = addScrollTarget("data-block-id", reminted.id);
    const change: ManuscriptPendingChange = {
      id: "change-1",
      change: {
        kind: "rewrite",
        blockId: "stale-raw-id",
        afterId: null,
        type: null,
        speaker: null,
        newText: "Revised prose.",
        toIndex: null,
        reason: "Tighten",
      },
      precondition: { kind: "target", target: blockLocator(frozen, 0) },
    };

    await expect(navigateToProposalChange("ch1", change)).resolves.toBe(true);
    expect(useProjectStore.getState().selectedId).toBe("reminted-id");
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("opens the outline overview, highlights the card, and scrolls it", async () => {
    const card = cardFixture("card-1", "The turn");
    useProjectStore.setState((state) => ({
      meta: {
        ...state.meta,
        chapters: {
          ...state.meta.chapters,
          ch1: { ...state.meta.chapters.ch1, cards: [card] },
        },
      },
    }));
    useOutlineBoardStore.setState({ openChapterId: "ch1" });
    const target = addScrollTarget("data-outline-card-id", card.id);
    const locator: SourceLocator = {
      sourceId: card.id,
      order: 0,
      fingerprint: cardFingerprint(card),
      sourceType: "outline-card",
      label: card.title,
      exactText: `${card.title}\n${card.intention}`,
      previewText: cardSnapshotText(card),
    };
    const change: OutlinePendingChange = {
      id: "outline-change-1",
      change: {
        kind: "rewrite",
        cardId: card.id,
        title: "The harder turn",
        intention: null,
        toIndex: null,
        reason: "Raise pressure",
      },
      precondition: { kind: "card", target: locator },
    };

    await expect(navigateToProposalChange("ch1", change)).resolves.toBe(true);

    expect(useViewStore.getState().outlineOpen).toBe(true);
    expect(useOutlineBoardStore.getState().openChapterId).toBeNull();
    expect(useOutlineBoardStore.getState().highlightedCardId).toBe(card.id);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("relocates a reminted outline card by order and semantic fingerprint", async () => {
    const frozen = cardFixture("frozen-card-id", "The turn");
    const reminted = { ...frozen, id: "reminted-card-id" };
    useProjectStore.setState((state) => ({
      meta: {
        ...state.meta,
        chapters: {
          ...state.meta.chapters,
          ch1: { ...state.meta.chapters.ch1, cards: [reminted] },
        },
      },
    }));
    const target = addScrollTarget("data-outline-card-id", reminted.id);
    const change: OutlinePendingChange = {
      id: "outline-remint",
      change: {
        kind: "remove",
        cardId: frozen.id,
        title: null,
        intention: null,
        toIndex: null,
        reason: "Cut the repeated turn",
      },
      precondition: {
        kind: "card",
        target: {
          sourceId: frozen.id,
          order: 0,
          fingerprint: cardFingerprint(frozen),
          sourceType: "outline-card",
          label: frozen.title,
          exactText: `${frozen.title}\n${frozen.intention}`,
          previewText: cardSnapshotText(frozen),
        },
      },
    };

    await expect(navigateToProposalChange("ch1", change)).resolves.toBe(true);
    expect(useOutlineBoardStore.getState().highlightedCardId).toBe(reminted.id);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("does not select a neighboring block when a proposal target was deleted", async () => {
    const frozen = blockFixture("deleted-id", "Deleted target.");
    useProjectStore.setState({
      blocks: [blockFixture("neighbor-id", "A neighbor.")],
      selectedId: null,
    });
    const change: ManuscriptPendingChange = {
      id: "change-1",
      change: {
        kind: "remove",
        blockId: "deleted-id",
        afterId: null,
        type: null,
        speaker: null,
        newText: null,
        toIndex: null,
        reason: "Cut repetition",
      },
      precondition: { kind: "target", target: blockLocator(frozen, 0) },
    };

    await expect(navigateToProposalChange("ch1", change)).resolves.toBe(false);
    expect(useProjectStore.getState().selectedId).toBeNull();
  });

  it("returns false for an unresolved inactive manuscript proposal", async () => {
    const frozen = parseChapter("The removed proposal target.")[0];
    vi.mocked(readTextFile).mockResolvedValue("A neighboring live paragraph.");
    const change: ManuscriptPendingChange = {
      id: "inactive-change",
      change: {
        kind: "remove",
        blockId: frozen.id,
        afterId: null,
        type: null,
        speaker: null,
        newText: null,
        toIndex: null,
        reason: "Cut the target",
      },
      precondition: { kind: "target", target: blockLocator(frozen, 0) },
    };

    await expect(navigateToProposalChange("ch2", change)).resolves.toBe(false);
    expect(useProjectStore.getState().activeChapterId).toBe("ch2");
    expect(useProjectStore.getState().selectedId).toBeNull();
  });

  it("keeps guarded inactive navigation pending until the author confirms", async () => {
    const source = "Guarded chapter prose.";
    const frozen = parseChapter(source)[0];
    vi.mocked(readTextFile).mockResolvedValue(source);
    useProjectStore.setState({ chapterDirty: true });

    const navigation = navigateToContextSnapshot(
      snapshotFixture(frozen, 0, "ch2"),
    );

    expect(useProjectStore.getState().activeChapterId).toBe("ch1");
    expect(useViewStore.getState().pending).not.toBeNull();

    useViewStore.getState().confirmPending();
    await expect(navigation).resolves.toBe(true);
    await waitFor(() => {
      expect(useProjectStore.getState().activeChapterId).toBe("ch2");
      expect(useProjectStore.getState().selectedId).toBe(
        useProjectStore.getState().blocks[0].id,
      );
    });
  });

  it("settles false when guarded inactive navigation is canceled", async () => {
    const source = "Canceled chapter prose.";
    const frozen = parseChapter(source)[0];
    vi.mocked(readTextFile).mockResolvedValue(source);
    useProjectStore.setState({ chapterDirty: true });

    const navigation = navigateToContextSnapshot(
      snapshotFixture(frozen, 0, "ch2"),
    );
    let result: boolean | null = null;
    void navigation.then((didNavigate) => {
      result = didNavigate;
    });

    useViewStore.getState().cancelPending();

    await waitFor(() => expect(result).toBe(false));
    expect(useViewStore.getState().pending).toBeNull();
    expect(useProjectStore.getState().activeChapterId).toBe("ch1");
    expect(useProjectStore.getState().selectedId).toBeNull();
  });

  it("settles false when another guarded action replaces navigation", async () => {
    const source = "Replaced chapter prose.";
    const frozen = parseChapter(source)[0];
    const replacement = vi.fn();
    vi.mocked(readTextFile).mockResolvedValue(source);
    useProjectStore.setState({ chapterDirty: true });

    const navigation = navigateToContextSnapshot(
      snapshotFixture(frozen, 0, "ch2"),
    );
    let result: boolean | null = null;
    void navigation.then((didNavigate) => {
      result = didNavigate;
    });

    void useViewStore.getState().requestGuarded(replacement);

    await waitFor(() => expect(result).toBe(false));
    expect(replacement).not.toHaveBeenCalled();
    expect(useViewStore.getState().pending).not.toBeNull();

    useViewStore.getState().confirmPending();

    expect(replacement).toHaveBeenCalledOnce();
    expect(useProjectStore.getState().activeChapterId).toBe("ch1");
    expect(useProjectStore.getState().selectedId).toBeNull();
  });
});
