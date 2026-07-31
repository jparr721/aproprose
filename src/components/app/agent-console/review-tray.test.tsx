// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

vi.mock("@/lib/tauri", () => ({
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

vi.mock("@/lib/ai/agent-controller", () => ({
  dispatchAgentIntent: vi.fn().mockResolvedValue(undefined),
  recordProposalEvent: vi.fn(),
}));

vi.mock("@/lib/ai/agent-navigation", () => ({
  navigateToProposalChange: vi.fn().mockResolvedValue(true),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { AgentConversation } from "@/components/app/agent-console/agent-conversation";
import { ReviewTray } from "@/components/app/agent-console/review-tray";
import { recordProposalEvent } from "@/lib/ai/agent-controller";
import { navigateToProposalChange } from "@/lib/ai/agent-navigation";
import {
  buildManuscriptPendingProposal,
  buildOutlinePendingProposal,
} from "@/lib/ai/agent-proposals";
import type {
  AgentRun,
  AgentUIMessage,
  ManuscriptPendingProposal,
  OutlinePendingProposal,
} from "@/lib/ai/agent-types";
import { writeProjectMeta } from "@/lib/tauri";
import type {
  Block,
  BlockChange,
  Card,
  ProjectInfo,
  SculptChange,
} from "@/lib/types";
import {
  EMPTY_AGENT_STATE,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { toast } from "sonner";

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
      title: "Chapter One",
      file: "one.tex",
      wordCount: 10,
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
  intention: "Set the stakes",
  characterIds: [],
  loreIds: [],
  continuityFlags: [],
});

const rewrite = (
  blockId: string,
  newText: string,
  reason: string,
): BlockChange => ({
  kind: "rewrite",
  blockId,
  afterId: null,
  type: null,
  speaker: null,
  newText,
  toIndex: null,
  reason,
});

const move = (blockId: string, toIndex: number): BlockChange => ({
  kind: "move",
  blockId,
  afterId: null,
  type: null,
  speaker: null,
  newText: null,
  toIndex,
  reason: "Move the reveal",
});

const idFactory = (): (() => string) => {
  let index = -1;
  return () => {
    index += 1;
    return index === 0 ? "proposal-1" : `change-${index - 1}`;
  };
};

const manuscriptProposal = (
  blocks: Block[],
  changes: BlockChange[],
): ManuscriptPendingProposal =>
  buildManuscriptPendingProposal({
    run: {
      id: "run-1",
      projectRoot: "/book",
      mode: "edit",
      task: { kind: "conversation", targetChapterId: "ch1" },
      userMessageId: "user-1",
      attachments: [],
      startedAt: "2026-07-30T00:00:00.000Z",
    } satisfies AgentRun,
    raw: { chapterId: "ch1", summary: "Revise the opening", changes },
    blocks,
    currentPending: null,
    originatingMessageId: "assistant-1",
    makeId: idFactory(),
    now: "2026-07-30T00:01:00.000Z",
  });

const outlineProposal = (
  cards: Card[],
  changes: SculptChange[],
): OutlinePendingProposal =>
  buildOutlinePendingProposal({
    run: {
      id: "run-1",
      projectRoot: "/book",
      mode: "edit",
      task: { kind: "outline-sculpt", chapterId: "ch1" },
      userMessageId: "user-1",
      attachments: [],
      startedAt: "2026-07-30T00:00:00.000Z",
    } satisfies AgentRun,
    raw: { chapterId: "ch1", summary: "Strengthen the outline", changes },
    cards,
    currentPending: null,
    originatingMessageId: "assistant-1",
    makeId: idFactory(),
    now: "2026-07-30T00:01:00.000Z",
  });

const setPending = (
  proposal: ManuscriptPendingProposal | OutlinePendingProposal,
): void => {
  useAgentConsoleStore.setState({ pendingProposal: proposal });
};

const expandReview = (): void => {
  fireEvent.click(
    screen.getByRole("button", { name: "Expand proposal review" }),
  );
};

const messageFixture = (id: string, text: string): AgentUIMessage => ({
  id,
  role: "assistant",
  metadata: {
    runId: "run-later",
    mode: "writing",
    task: { kind: "conversation", targetChapterId: "ch1" },
    state: "complete",
    createdAt: "2026-07-30T00:02:00.000Z",
    error: null,
    errorCode: null,
    retryOf: null,
    usage: null,
  },
  parts: [{ type: "text", text }],
});

function ConversationWithReview() {
  const messages = useAgentConsoleStore((state) => state.messages);

  return (
    <div className="flex h-96 flex-col">
      <AgentConversation
        messages={messages}
        onNavigateSnapshot={async () => true}
        onOpenSettings={() => undefined}
        onRetry={async () => undefined}
        summary={null}
      />
      <ReviewTray />
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  const blocks = [
    blockFixture("block-1", "The rain fell."),
    blockFixture("block-2", "The door opened."),
  ];
  const cards = [cardFixture("card-1", "Arrival")];
  useProjectStore.setState({
    project: projectFixture(),
    activeChapterId: "ch1",
    blocks,
    selectedId: null,
    selectedIds: [],
    editing: false,
    editCaret: null,
    chapterDirty: false,
    past: [],
    future: [],
    lastTextEditId: null,
    meta: {
      version: 2,
      characters: [],
      lore: [],
      statuses: {},
      outline: { premise: "" },
      chapters: {
        ch1: {
          act: null,
          plotPoint: null,
          premise: "",
          goal: "",
          conflict: "",
          turn: "",
          characterIds: [],
          cards,
        },
      },
    },
  } as never);
  useAgentConsoleStore.setState({
    ...EMPTY_AGENT_STATE,
    messages: [],
    hydratedProjectRoot: "/book",
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReviewTray summary and expansion", () => {
  it("shows the collapsed proposal summary, type, count, and batch actions", () => {
    const blocks = useProjectStore.getState().blocks;
    setPending(
      manuscriptProposal(blocks, [
        rewrite("block-1", "Rain whispered.", "Quiet the opening"),
        rewrite("block-2", "The door eased open.", "Slow the reveal"),
      ]),
    );

    const { container } = render(<ReviewTray />);

    expect(container.querySelector("[data-agent-review-tray]")).toBeTruthy();
    expect(screen.getByText("Manuscript")).toBeTruthy();
    expect(screen.getByText("Revise the opening")).toBeTruthy();
    expect(screen.getByText("2 changes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject All" })).toBeTruthy();
    expect(container.querySelector('[data-agent-change-id="change-0"]')).toBeNull();
  });

  it("expands all review cards in place", () => {
    const blocks = useProjectStore.getState().blocks;
    setPending(
      manuscriptProposal(blocks, [
        rewrite("block-1", "Rain whispered.", "Quiet the opening"),
        rewrite("block-2", "The door eased open.", "Slow the reveal"),
      ]),
    );
    const { container } = render(<ReviewTray />);
    const tray = container.querySelector("[data-agent-review-tray]");

    expandReview();

    expect(container.querySelectorAll("[data-agent-change-id]")).toHaveLength(2);
    expect(container.querySelector("[data-agent-review-tray]")).toBe(tray);
  });

  it("renders a zero-change workspace with a Dismiss action", () => {
    const proposal = manuscriptProposal(
      useProjectStore.getState().blocks,
      [],
    );
    setPending(proposal);
    render(<ReviewTray />);

    expect(screen.getByText("Revise the opening")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(useAgentConsoleStore.getState().pendingProposal).toBeNull();
  });
});

describe("ReviewTray manuscript decisions", () => {
  it("accepts one change, records it, and visibly revalidates the remainder", async () => {
    const blocks = useProjectStore.getState().blocks;
    const proposal = manuscriptProposal(blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
      move("block-2", 0),
    ]);
    setPending(proposal);
    const { container } = render(<ReviewTray />);
    expandReview();
    const first = container.querySelector('[data-agent-change-id="change-0"]');
    if (!(first instanceof HTMLElement)) throw new Error("Missing first change.");

    fireEvent.click(within(first).getByRole("button", { name: "Accept" }));

    expect(useProjectStore.getState().blocks[0].text).toBe("Rain whispered.");
    expect(useProjectStore.getState().past).toHaveLength(1);
    expect(useAgentConsoleStore.getState().pendingProposal?.changes).toHaveLength(1);
    expect(recordProposalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: proposal.id,
        action: "accepted",
        changeCount: 1,
      }),
    );
    expect(await screen.findByText("Source changed - regenerate")).toBeTruthy();
  });

  it("rejects one change without writing manuscript or metadata", () => {
    const blocks = useProjectStore.getState().blocks;
    const proposal = manuscriptProposal(blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
      rewrite("block-2", "The door eased open.", "Slow the reveal"),
    ]);
    const beforeBlocks = structuredClone(blocks);
    const beforeMeta = structuredClone(useProjectStore.getState().meta);
    setPending(proposal);
    const { container } = render(<ReviewTray />);
    expandReview();
    const first = container.querySelector('[data-agent-change-id="change-0"]');
    if (!(first instanceof HTMLElement)) throw new Error("Missing first change.");

    fireEvent.click(within(first).getByRole("button", { name: "Reject" }));

    expect(useProjectStore.getState().blocks).toEqual(beforeBlocks);
    expect(useProjectStore.getState().meta).toEqual(beforeMeta);
    expect(writeProjectMeta).not.toHaveBeenCalled();
    expect(useAgentConsoleStore.getState().pendingProposal?.changes).toHaveLength(1);
    expect(recordProposalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "rejected", changeCount: 1 }),
    );
  });

  it("refuses Accept All when any source is stale", () => {
    const blocks = useProjectStore.getState().blocks;
    const proposal = manuscriptProposal(blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
      rewrite("block-2", "The door eased open.", "Slow the reveal"),
    ]);
    setPending(proposal);
    useProjectStore.setState({
      blocks: [
        { ...blocks[0], text: "The source changed." },
        blocks[1],
      ],
    });
    render(<ReviewTray />);

    const acceptAll = screen.getByRole("button", { name: "Accept All" });
    expect(acceptAll.hasAttribute("disabled")).toBe(true);
    fireEvent.click(acceptAll);
    expect(useAgentConsoleStore.getState().pendingProposal).toEqual(proposal);
    expect(useProjectStore.getState().past).toHaveLength(0);
    expect(recordProposalEvent).not.toHaveBeenCalled();
  });

  it("applies Accept All as one manuscript history entry", () => {
    const blocks = useProjectStore.getState().blocks;
    const proposal = manuscriptProposal(blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
      rewrite("block-2", "The door eased open.", "Slow the reveal"),
    ]);
    setPending(proposal);
    render(<ReviewTray />);

    fireEvent.click(screen.getByRole("button", { name: "Accept All" }));

    expect(useProjectStore.getState().blocks.map((block) => block.text)).toEqual([
      "Rain whispered.",
      "The door eased open.",
    ]);
    expect(useProjectStore.getState().past).toHaveLength(1);
    expect(useAgentConsoleStore.getState().pendingProposal).toBeNull();
    expect(recordProposalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "accepted-all", changeCount: 2 }),
    );
  });
});

describe("ReviewTray outline decisions", () => {
  it("offers guarded Undo after applying all outline changes", () => {
    const cards = useProjectStore.getState().meta.chapters.ch1.cards;
    const proposal = outlineProposal(cards, [
      {
        kind: "rewrite",
        cardId: "card-1",
        title: "Hard arrival",
        intention: null,
        toIndex: null,
        reason: "Raise the stakes",
      },
    ]);
    setPending(proposal);
    render(<ReviewTray />);

    fireEvent.click(screen.getByRole("button", { name: "Accept All" }));

    expect(useProjectStore.getState().meta.chapters.ch1.cards[0].title).toBe(
      "Hard arrival",
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Outline changes applied",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      }),
    );
    const options = vi.mocked(toast.success).mock.calls[0][1];
    const undoAction = options?.action;
    if (
      undoAction === null ||
      typeof undoAction !== "object" ||
      !("onClick" in undoAction) ||
      typeof undoAction.onClick !== "function"
    ) {
      throw new Error("Expected the guarded outline Undo action.");
    }
    undoAction.onClick({} as never);
    expect(useProjectStore.getState().meta.chapters.ch1.cards[0].title).toBe(
      "Arrival",
    );
  });
});

describe("ReviewTray rejection and navigation", () => {
  it("rejects the complete workspace without a project write", () => {
    const blocks = useProjectStore.getState().blocks;
    const proposal = manuscriptProposal(blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
    ]);
    const beforeBlocks = structuredClone(blocks);
    const beforeMeta = structuredClone(useProjectStore.getState().meta);
    setPending(proposal);
    render(<ReviewTray />);

    fireEvent.click(screen.getByRole("button", { name: "Reject All" }));

    expect(useAgentConsoleStore.getState().pendingProposal).toBeNull();
    expect(useProjectStore.getState().blocks).toEqual(beforeBlocks);
    expect(useProjectStore.getState().meta).toEqual(beforeMeta);
    expect(writeProjectMeta).not.toHaveBeenCalled();
    expect(recordProposalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "rejected-all", changeCount: 1 }),
    );
  });

  it("navigates a review card without closing the tray", async () => {
    const blocks = useProjectStore.getState().blocks;
    const proposal = manuscriptProposal(blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
    ]);
    setPending(proposal);
    const { container } = render(<ReviewTray />);
    expandReview();
    const card = container.querySelector('[data-agent-change-id="change-0"]');
    if (!(card instanceof HTMLElement)) throw new Error("Missing review card.");

    fireEvent.click(
      within(card).getByRole("button", { name: "Read in context" }),
    );

    await waitFor(() =>
      expect(navigateToProposalChange).toHaveBeenCalledWith(
        "ch1",
        proposal.changes[0],
      ),
    );
    expect(container.querySelector("[data-agent-review-tray]")).toBeTruthy();
    expect(useAgentConsoleStore.getState().pendingProposal).toEqual(proposal);
  });

  it("preserves expanded review and scroll state through conversation updates", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
    ]);
    setPending(proposal);
    useAgentConsoleStore.setState({
      messages: [messageFixture("assistant-first", "The first response.")],
    });
    const { container } = render(<ConversationWithReview />);
    expandReview();
    const tray = container.querySelector("[data-agent-review-tray]");
    const reviewViewport = tray?.querySelector(
      '[data-slot="scroll-area-viewport"]',
    );
    const conversation = screen.getByRole("log");
    if (!(tray instanceof HTMLElement)) throw new Error("Missing review tray.");
    if (!(reviewViewport instanceof HTMLElement)) {
      throw new Error("Missing review viewport.");
    }
    Object.defineProperty(conversation, "scrollHeight", {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(conversation, "clientHeight", {
      configurable: true,
      value: 100,
    });
    conversation.scrollTop = 41;
    reviewViewport.scrollTop = 17;
    fireEvent.scroll(conversation);
    fireEvent.scroll(reviewViewport);

    act(() => {
      useAgentConsoleStore.setState({
        messages: [
          messageFixture("assistant-first", "The first response."),
          messageFixture("assistant-later", "A later response."),
        ],
      });
    });

    expect(screen.getByText("A later response.")).toBeTruthy();
    expect(container.querySelector("[data-agent-review-tray]")).toBe(tray);
    expect(
      screen.getByRole("button", { name: "Collapse proposal review" }),
    ).toBeTruthy();
    expect(
      tray.querySelector('[data-slot="scroll-area-viewport"]'),
    ).toBe(reviewViewport);
    expect(reviewViewport.scrollTop).toBe(17);
    expect(screen.getByRole("log")).toBe(conversation);
    expect(conversation.scrollTop).toBe(41);
  });
});
