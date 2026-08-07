// @vitest-environment happy-dom

import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentIntent,
  AgentRun,
  ManuscriptPendingProposal,
  OutlinePendingProposal,
  PendingProposal,
} from "@/lib/ai/agent-types";

const controller = vi.hoisted(() => ({
  dispatchAgentIntent: vi.fn<(intent: AgentIntent) => Promise<void>>(),
  recordProposalEvent: vi.fn(),
}));

const editorHooks = vi.hoisted(() => ({
  dictationFinal: null as ((text: string) => void) | null,
  dictationListening: false,
  dictationToggle: vi.fn(),
  keybindings: new Map<
    string,
    {
      callback: () => void;
      options: {
        enabled: boolean;
        ignoreEventWhen: (event: KeyboardEvent) => boolean;
      };
    }
  >(),
}));

vi.mock("@/lib/ai/agent-controller", () => ({
  dispatchAgentIntent: controller.dispatchAgentIntent,
  recordProposalEvent: controller.recordProposalEvent,
}));

vi.mock("@/components/app/block", () => ({
  Block: ({ block }: { block: { id: string } }) => (
    <div data-authoring-block data-block-id={block.id} />
  ),
}));

vi.mock("@/components/app/find-bar", () => ({
  FindBar: () => <div data-testid="find-bar" />,
}));
vi.mock("@/components/app/selection-toolbar", () => ({
  SelectionToolbar: () => <div data-testid="selection-toolbar" />,
}));
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/use-dictation", () => ({
  useDictation: (onFinal: (text: string) => void) => {
    editorHooks.dictationFinal = onFinal;
    return {
      supported: true,
      listening: editorHooks.dictationListening,
      toggle: editorHooks.dictationToggle,
    };
  },
}));
vi.mock("@/hooks/use-keybinding", () => ({
  useKeybinding: (id: string, callback: () => void) => {
    editorHooks.keybindings.set(id, {
      callback,
      options: { enabled: true, ignoreEventWhen: () => false },
    });
  },
  useKeybindingWithOptions: (
    id: string,
    callback: () => void,
    options: {
      enabled: boolean;
      ignoreEventWhen: (event: KeyboardEvent) => boolean;
    },
  ) => {
    editorHooks.keybindings.set(id, { callback, options });
  },
}));
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: ReactNode }) => (
    <div data-testid="dnd-context">{children}</div>
  ),
  KeyboardSensor: function KeyboardSensor() {},
  PointerSensor: function PointerSensor() {},
  closestCenter: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
}));
vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => (
    <div data-testid="sortable-context">{children}</div>
  ),
  sortableKeyboardCoordinates: vi.fn(),
  verticalListSortingStrategy: vi.fn(),
}));
vi.mock("@dnd-kit/modifiers", () => ({ restrictToVerticalAxis: vi.fn() }));
vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));

import { Editor } from "@/components/app/editor";
import { buildManuscriptPendingProposal } from "@/lib/ai/agent-proposals";
import { KEYBINDING_IDS, type KeybindingId } from "@/lib/keybindings";
import {
  EMPTY_AGENT_STATE,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useSearchSurfaceStore } from "@/stores/search-surface-store";
import { useSyncStore } from "@/stores/sync-store";
import { useViewStore } from "@/stores/view-store";
import type { Block, ProjectInfo, ProjectMeta } from "@/lib/types";

const project: ProjectInfo = {
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
      id: "chapter-1",
      label: "1",
      title: "The Crossing",
      file: "chapter-1.tex",
      wordCount: 12,
    },
    {
      id: "chapter-2",
      label: "2",
      title: "The Return",
      file: "chapter-2.tex",
      wordCount: 0,
    },
  ],
};

const blocks: Block[] = [
  {
    id: "block-1",
    type: "narration",
    text: "Rain crossed the window.",
    raw: "Rain crossed the window.\n",
    dirty: false,
  },
  {
    id: "block-2",
    type: "dialogue",
    text: "Stay here.",
    raw: "Stay here.\n",
    dirty: false,
  },
];

const meta: ProjectMeta = {
  version: 3,
  characters: [],
  lore: [],
  statuses: {},
  outline: { premise: "", overview: "" },
  chapters: {
    "chapter-1": {
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
};

function manuscriptProposal(): ManuscriptPendingProposal {
  let nextId = 0;
  return buildManuscriptPendingProposal({
    run: {
      id: "run-1",
      projectRoot: "/book",
      mode: "edit",
      task: { kind: "conversation", targetChapterId: "chapter-1" },
      userMessageId: "user-1",
      attachments: [],
      startedAt: "2026-08-01T00:00:00.000Z",
    } satisfies AgentRun,
    raw: {
      chapterId: "chapter-1",
      summary: "Tighten the opening",
      changes: [
        {
          kind: "rewrite",
          blockId: "block-1",
          afterId: null,
          type: null,
          speaker: null,
          newText: "Rain traced the window.",
          toIndex: null,
          reason: "Sharpen the image",
        },
      ],
    },
    blocks,
    currentPending: null,
    currentOverview: "",
    originatingMessageId: "assistant-1",
    makeId: () => (nextId++ === 0 ? "proposal-1" : "change-1"),
    now: "2026-08-01T00:01:00.000Z",
  });
}

function outlineProposal(): OutlinePendingProposal {
  return {
    id: "proposal-1",
    kind: "outline",
    projectRoot: "/book",
    chapterId: "chapter-1",
    summary: "Tighten the outline",
    createdAt: "2026-08-01T00:01:00.000Z",
    originatingMessageId: "assistant-1",
    changes: [],
  };
}

function setReviewState(proposal: PendingProposal, reviewId: string): void {
  useAgentConsoleStore.setState({ pendingProposal: proposal });
  useViewStore.setState({ manuscriptReviewProposalId: reviewId });
}

function expectNormalAuthoring(): void {
  expect(screen.getByTestId("find-bar")).toBeTruthy();
  expect(screen.getByTestId("dnd-context")).toBeTruthy();
  expect(screen.getByTestId("sortable-context")).toBeTruthy();
  expect(document.querySelectorAll("[data-authoring-block]")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Narration" })).toBeTruthy();
  expect(screen.getByTestId("selection-toolbar")).toBeTruthy();
  expect(screen.queryByText("Manuscript review")).toBeNull();
}

function invokeKeybinding(id: KeybindingId): void {
  const binding = editorHooks.keybindings.get(id);
  if (binding === undefined) {
    throw new Error(`Missing captured keybinding: ${id}`);
  }
  binding.callback();
}

function expectKeybindingEnabled(id: KeybindingId, enabled: boolean): void {
  const binding = editorHooks.keybindings.get(id);
  if (binding === undefined) {
    throw new Error(`Missing captured keybinding: ${id}`);
  }
  expect(binding.options.enabled).toBe(enabled);
}

function invokeDictation(text: string): void {
  if (editorHooks.dictationFinal === null) {
    throw new Error("Missing captured dictation callback.");
  }
  editorHooks.dictationFinal(text);
}

function focusStaleProseBody(
  container: HTMLElement,
  start: number,
  end: number,
): HTMLTextAreaElement {
  const host = document.createElement("div");
  host.dataset.blockId = "block-1";
  const textarea = document.createElement("textarea");
  textarea.setAttribute("data-prose-body", "");
  textarea.value = blocks[0].text;
  host.append(textarea);
  container.append(host);
  textarea.focus();
  textarea.setSelectionRange(start, end);
  return textarea;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  editorHooks.dictationFinal = null;
  editorHooks.dictationListening = false;
  editorHooks.dictationToggle.mockReset();
  editorHooks.keybindings.clear();
  controller.dispatchAgentIntent.mockReset().mockImplementation(async () => {
    useViewStore.getState().openAiConsole();
  });
  useSearchSurfaceStore.setState({
    activeSurface: "editor",
    openSurface: null,
    focusRevision: 0,
  });
  useViewStore.setState({
    aiOpen: false,
    focus: false,
    manuscriptReviewProposalId: null,
    outlineOpen: false,
  });
  useAgentConsoleStore.setState({
    ...EMPTY_AGENT_STATE,
    requestedProjectRoot: "/book",
    activeProjectRoot: "/book",
    hydratedProjectRoot: "/book",
  });
  useSyncStore.setState({ conflictedFiles: [] });
  useProjectStore.setState({
    project,
    meta,
    activeChapterId: "chapter-1",
    blocks,
    selectedId: null,
    selectedIds: [],
    editing: false,
    editCaret: null,
    chapterDirty: false,
    past: [],
    future: [],
    lastTextEditId: null,
  });
});

describe("Editor Suggest from context", () => {
  it("submits the live selected block set in selection order", () => {
    useProjectStore.setState({
      selectedId: "block-1",
      selectedIds: ["block-2", "block-1"],
    });
    render(<Editor />);

    fireEvent.click(
      screen.getByRole("button", { name: "Suggest from context" }),
    );

    expect(controller.dispatchAgentIntent).toHaveBeenCalledWith({
      kind: "run",
      mode: "writing",
      text: "Suggest what should come next from the selected context.",
      refs: [
        {
          kind: "block",
          chapterId: "chapter-1",
          blockId: "block-2",
        },
        {
          kind: "block",
          chapterId: "chapter-1",
          blockId: "block-1",
        },
      ],
      task: { kind: "conversation", targetChapterId: "chapter-1" },
    });
    expect(useViewStore.getState().aiOpen).toBe(true);
  });

  it("still submits a chapter-targeted conversation without a selection", () => {
    render(<Editor />);

    fireEvent.click(
      screen.getByRole("button", { name: "Suggest from context" }),
    );

    expect(controller.dispatchAgentIntent).toHaveBeenCalledWith({
      kind: "run",
      mode: "writing",
      text: "Suggest what should come next from the selected context.",
      refs: [],
      task: { kind: "conversation", targetChapterId: "chapter-1" },
    });
  });
});

describe("Editor manuscript review activation", () => {
  it("renders only the inline review body for a strictly matching proposal", () => {
    const proposal = manuscriptProposal();
    setReviewState(proposal, proposal.id);

    const { container } = render(<Editor />);

    expect(screen.getByText("The Crossing")).toBeTruthy();
    expect(screen.getByText(/2 blocks - 6 words - saved/)).toBeTruthy();
    expect(screen.getByText("Manuscript review")).toBeTruthy();
    expect(screen.getByText("Tighten the opening")).toBeTruthy();
    expect(screen.queryByTestId("find-bar")).toBeNull();
    expect(screen.queryByTestId("dnd-context")).toBeNull();
    expect(screen.queryByTestId("sortable-context")).toBeNull();
    expect(container.querySelector("[data-authoring-block]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Narration" })).toBeNull();
    expect(screen.queryByTestId("selection-toolbar")).toBeNull();
  });

  it("keeps normal authoring for a mismatched review ID", () => {
    setReviewState(manuscriptProposal(), "proposal-other");

    render(<Editor />);

    expectNormalAuthoring();
  });

  it("keeps normal authoring for a mismatched project root", () => {
    const proposal = { ...manuscriptProposal(), projectRoot: "/other-book" };
    setReviewState(proposal, proposal.id);

    render(<Editor />);

    expectNormalAuthoring();
  });

  it("keeps normal authoring for a different active chapter", () => {
    const proposal = { ...manuscriptProposal(), chapterId: "chapter-2" };
    setReviewState(proposal, proposal.id);

    render(<Editor />);

    expectNormalAuthoring();
  });

  it("never activates manuscript review for an outline proposal", () => {
    const proposal = outlineProposal();
    setReviewState(proposal, proposal.id);

    render(<Editor />);

    expectNormalAuthoring();
  });

  it("returns to authoring when review closes without clearing the proposal", () => {
    const proposal = manuscriptProposal();
    setReviewState(proposal, proposal.id);
    render(<Editor />);

    fireEvent.click(screen.getByRole("button", { name: "Close Review" }));

    expectNormalAuthoring();
    expect(useAgentConsoleStore.getState().pendingProposal).toEqual(proposal);
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
  });

  it("blocks history shortcuts during manuscript review", () => {
    const proposal = manuscriptProposal();
    setReviewState(proposal, proposal.id);
    render(<Editor />);
    const historyState = {
      blocks,
      selectedId: "block-1",
      selectedIds: ["block-1", "block-2"],
      editing: true,
      editCaret: "end" as const,
      chapterDirty: false,
      past: [
        {
          blocks: [{ ...blocks[0], text: "Undo text" }, blocks[1]],
          selectedId: "block-2",
        },
      ],
      future: [
        {
          blocks: [{ ...blocks[0], text: "Redo text" }, blocks[1]],
          selectedId: "block-2",
        },
      ],
      lastTextEditId: null,
    };

    for (const id of [
      KEYBINDING_IDS.UNDO,
      KEYBINDING_IDS.REDO,
      KEYBINDING_IDS.REDO_ALT,
    ]) {
      act(() => useProjectStore.setState(historyState));
      const before = useProjectStore.getState();
      expectKeybindingEnabled(id, false);

      act(() => invokeKeybinding(id));

      const after = useProjectStore.getState();
      expect(after.blocks).toBe(before.blocks);
      expect(after.past).toBe(before.past);
      expect(after.future).toBe(before.future);
      expect(after.selectedId).toBe(before.selectedId);
      expect(after.selectedIds).toBe(before.selectedIds);
      expect(after.editing).toBe(before.editing);
      expect(after.editCaret).toBe(before.editCaret);
      expect(after.chapterDirty).toBe(before.chapterDirty);
    }
  });

  it("blocks selection and editing shortcuts during manuscript review", () => {
    const proposal = manuscriptProposal();
    setReviewState(proposal, proposal.id);
    render(<Editor />);
    const cases = [
      {
        id: KEYBINDING_IDS.NAV_PREV_BLOCK,
        selectedId: "block-2",
        editing: false,
      },
      {
        id: KEYBINDING_IDS.NAV_NEXT_BLOCK,
        selectedId: "block-1",
        editing: false,
      },
      {
        id: KEYBINDING_IDS.EDIT_BLOCK,
        selectedId: "block-1",
        editing: false,
      },
      {
        id: KEYBINDING_IDS.EDIT_BLOCK_ENTER,
        selectedId: "block-1",
        editing: false,
      },
      {
        id: KEYBINDING_IDS.EXIT_BLOCK,
        selectedId: "block-1",
        editing: true,
      },
    ];

    for (const testCase of cases) {
      act(() =>
        useProjectStore.setState({
          selectedId: testCase.selectedId,
          selectedIds: ["block-1", "block-2"],
          editing: testCase.editing,
          editCaret: testCase.editing ? "end" : null,
        }),
      );
      const before = useProjectStore.getState();
      expectKeybindingEnabled(testCase.id, false);

      act(() => invokeKeybinding(testCase.id));

      const after = useProjectStore.getState();
      expect(after.blocks).toBe(before.blocks);
      expect(after.selectedId).toBe(before.selectedId);
      expect(after.selectedIds).toBe(before.selectedIds);
      expect(after.editing).toBe(before.editing);
      expect(after.editCaret).toBe(before.editCaret);
    }
  });

  it("blocks save, split, and formatting shortcuts during manuscript review", () => {
    const compileNow = vi
      .spyOn(useProjectStore.getState(), "compileNow")
      .mockImplementation(async () => {
        useProjectStore
          .getState()
          .updateBlockText("block-1", "Saved during review");
      });
    const proposal = manuscriptProposal();
    setReviewState(proposal, proposal.id);
    const { container } = render(<Editor />);

    const beforeSave = useProjectStore.getState().blocks;
    expectKeybindingEnabled(KEYBINDING_IDS.SAVE_CHAPTER, false);
    act(() => invokeKeybinding(KEYBINDING_IDS.SAVE_CHAPTER));
    expect(useProjectStore.getState().blocks).toBe(beforeSave);
    expect(compileNow).not.toHaveBeenCalled();

    for (const testCase of [
      { id: KEYBINDING_IDS.SPLIT_BLOCK, start: 5, end: 5 },
      { id: KEYBINDING_IDS.FORMAT_BOLD, start: 0, end: 4 },
      { id: KEYBINDING_IDS.FORMAT_ITALIC, start: 5, end: 12 },
    ]) {
      act(() =>
        useProjectStore.setState({
          blocks,
          selectedId: "block-1",
          selectedIds: [],
          editing: true,
          editCaret: null,
          chapterDirty: false,
          past: [],
          future: [],
          lastTextEditId: null,
        }),
      );
      const textarea = focusStaleProseBody(
        container,
        testCase.start,
        testCase.end,
      );
      const before = useProjectStore.getState();
      expectKeybindingEnabled(testCase.id, false);

      act(() => invokeKeybinding(testCase.id));

      const after = useProjectStore.getState();
      expect(after.blocks).toBe(before.blocks);
      expect(after.past).toBe(before.past);
      expect(after.future).toBe(before.future);
      expect(after.selectedId).toBe(before.selectedId);
      expect(after.editing).toBe(before.editing);
      expect(after.chapterDirty).toBe(before.chapterDirty);
      textarea.parentElement?.remove();
    }
  });

  it("ignores late dictation and stops active recognition when review opens", () => {
    editorHooks.dictationListening = true;
    useProjectStore.setState({ selectedId: "block-1" });
    render(<Editor />);
    const proposal = manuscriptProposal();

    act(() => setReviewState(proposal, proposal.id));
    const before = useProjectStore.getState();
    act(() => invokeDictation("Late dictated text"));

    const after = useProjectStore.getState();
    expect(after.blocks).toBe(before.blocks);
    expect(after.past).toBe(before.past);
    expect(after.future).toBe(before.future);
    expect(after.chapterDirty).toBe(before.chapterDirty);
    expect(editorHooks.dictationToggle).toHaveBeenCalledTimes(1);
  });

  it("keeps dictation and editor shortcuts available during normal authoring", () => {
    useProjectStore.setState({ selectedId: "block-1" });
    render(<Editor />);

    expectKeybindingEnabled(KEYBINDING_IDS.UNDO, true);
    expectKeybindingEnabled(KEYBINDING_IDS.NAV_NEXT_BLOCK, true);
    expectKeybindingEnabled(KEYBINDING_IDS.EDIT_BLOCK, true);

    act(() => invokeDictation("Thunder answered"));
    expect(useProjectStore.getState().blocks[0].text).toBe(
      "Rain crossed the window. Thunder answered",
    );

    act(() => invokeKeybinding(KEYBINDING_IDS.UNDO));
    expect(useProjectStore.getState().blocks[0].text).toBe(
      "Rain crossed the window.",
    );

    act(() => useProjectStore.setState({ selectedId: "block-1" }));
    act(() => invokeKeybinding(KEYBINDING_IDS.NAV_NEXT_BLOCK));
    expect(useProjectStore.getState().selectedId).toBe("block-2");

    act(() => invokeKeybinding(KEYBINDING_IDS.EDIT_BLOCK));
    expect(useProjectStore.getState().editing).toBe(true);

  });
});
