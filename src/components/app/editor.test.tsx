// @vitest-environment happy-dom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  useDictation: () => ({ supported: false, listening: false, toggle: vi.fn() }),
}));
vi.mock("@/hooks/use-keybinding", () => ({
  useKeybinding: vi.fn(),
  useKeybindingWithOptions: vi.fn(),
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
import {
  EMPTY_AGENT_STATE,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
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
  outline: { premise: "" },
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

afterEach(() => cleanup());

beforeEach(() => {
  controller.dispatchAgentIntent.mockReset().mockImplementation(async () => {
    useViewStore.getState().openAiConsole();
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
    chapterDirty: false,
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
});
