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
  openManuscriptProposalInEditor: vi.fn().mockResolvedValue(true),
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
import {
  navigateToProposalChange,
  openManuscriptProposalInEditor,
} from "@/lib/ai/agent-navigation";
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
        onRetry={async () => ({ status: "success" })}
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
    requestedProjectRoot: "/book",
    activeProjectRoot: "/book",
    hydratedProjectRoot: "/book",
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReviewTray manuscript summary", () => {
  it("shows a compact summary with editor and batch actions but no diff cards", () => {
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
    expect(
      screen.getByRole("button", { name: "Review in editor" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject All" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Expand proposal review" }),
    ).toBeNull();
    expect(container.querySelector("[data-agent-change-id]")).toBeNull();
    expect(container.querySelector('[data-slot="collapsible"]')).toBeNull();
    expect(container.querySelector('[data-slot="scroll-area"]')).toBeNull();
  });

  it("opens the pending proposal in the editor without clearing it", async () => {
    const blocks = useProjectStore.getState().blocks;
    const proposal = manuscriptProposal(blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
    ]);
    setPending(proposal);
    render(<ReviewTray />);

    fireEvent.click(
      screen.getByRole("button", { name: "Review in editor" }),
    );

    await waitFor(() =>
      expect(openManuscriptProposalInEditor).toHaveBeenCalledWith(proposal),
    );
    expect(useAgentConsoleStore.getState().pendingProposal).toEqual(proposal);
  });

  it("reports a refused editor navigation and keeps the proposal", async () => {
    const blocks = useProjectStore.getState().blocks;
    const proposal = manuscriptProposal(blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
    ]);
    vi.mocked(openManuscriptProposalInEditor).mockResolvedValueOnce(false);
    setPending(proposal);
    render(<ReviewTray />);

    fireEvent.click(
      screen.getByRole("button", { name: "Review in editor" }),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't open proposal context",
      ),
    );
    expect(useAgentConsoleStore.getState().pendingProposal).toEqual(proposal);
  });

  it("reports an editor navigation error and keeps the proposal", async () => {
    const blocks = useProjectStore.getState().blocks;
    const proposal = manuscriptProposal(blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
    ]);
    vi.mocked(openManuscriptProposalInEditor).mockRejectedValueOnce(
      new Error("Navigation failed"),
    );
    setPending(proposal);
    render(<ReviewTray />);

    fireEvent.click(
      screen.getByRole("button", { name: "Review in editor" }),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't open proposal context",
        { description: "Error: Navigation failed" },
      ),
    );
    expect(useAgentConsoleStore.getState().pendingProposal).toEqual(proposal);
  });

  it.each([
    {
      name: "a same-project persistence transition",
      state: {
        hydratedProjectRoot: "/book",
        persistenceTransition: {
          generation: 9,
          kind: "load" as const,
          projectRoot: "/book",
        },
      },
    },
    {
      name: "a failed load with mismatched hydration",
      state: {
        hydratedProjectRoot: null,
        persistenceTransition: null,
      },
    },
  ])("disables batch decisions during $name", ({ state }) => {
    const blocks = useProjectStore.getState().blocks;
    setPending(
      manuscriptProposal(blocks, [
        rewrite("block-1", "Rain whispered.", "Quiet the opening"),
      ]),
    );
    useAgentConsoleStore.setState(state);
    render(<ReviewTray />);

    expect(
      screen.getByRole("button", { name: "Accept All" }).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Reject All" }).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
  });

  it("disables Accept All for stale sources but keeps Reject All enabled", () => {
    const blocks = useProjectStore.getState().blocks;
    const proposal = manuscriptProposal(blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
      rewrite("block-2", "The door eased open.", "Slow the reveal"),
    ]);
    setPending(proposal);
    useProjectStore.setState({
      blocks: [{ ...blocks[0], text: "The source changed." }, blocks[1]],
    });
    render(<ReviewTray />);

    expect(
      screen.getByRole("button", { name: "Accept All" }).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Reject All" }).hasAttribute(
        "disabled",
      ),
    ).toBe(false);
  });

  it("applies Accept All through the shared manuscript decision", () => {
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

  it("rejects all through the shared manuscript decision without project writes", () => {
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

  it("keeps the compact proposal visible after an apply-time stale result", () => {
    const blocks = useProjectStore.getState().blocks;
    const proposal = manuscriptProposal(blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
    ]);
    vi.spyOn(
      useProjectStore.getState(),
      "applyAgentManuscriptProposal",
    ).mockReturnValue({ status: "stale", staleChangeIds: ["change-0"] });
    setPending(proposal);
    render(<ReviewTray />);

    fireEvent.click(screen.getByRole("button", { name: "Accept All" }));

    expect(useAgentConsoleStore.getState().pendingProposal).toEqual(proposal);
    expect(screen.getByRole("button", { name: "Accept All" })).toBeTruthy();
    expect(recordProposalEvent).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Proposal source changed", {
      description: "Keep this proposal open and ask the agent to regenerate it.",
    });
  });
});

describe("ReviewTray outline decisions", () => {
  it("retains the collapsible summary and renders outline cards only when expanded", () => {
    const cards = useProjectStore.getState().meta.chapters.ch1.cards;
    setPending(
      outlineProposal(cards, [
        {
          kind: "rewrite",
          cardId: "card-1",
          title: "Hard arrival",
          intention: null,
          toIndex: null,
          reason: "Raise the stakes",
        },
      ]),
    );
    const { container } = render(<ReviewTray />);

    expect(screen.getByText("Outline")).toBeTruthy();
    expect(screen.getByText("Strengthen the outline")).toBeTruthy();
    expect(screen.getByText("1 change")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Expand proposal review" }),
    ).toBeTruthy();
    expect(container.querySelector("[data-agent-change-id]")).toBeNull();

    expandReview();

    expect(container.querySelectorAll("[data-agent-change-id]")).toHaveLength(1);
    expect(container.querySelector('[data-slot="scroll-area"]')).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Collapse proposal review" }),
    ).toBeTruthy();
  });

  it.each([
    {
      name: "a same-project persistence transition",
      state: {
        hydratedProjectRoot: "/book",
        persistenceTransition: {
          generation: 9,
          kind: "load" as const,
          projectRoot: "/book",
        },
      },
    },
    {
      name: "a failed load with mismatched hydration",
      state: {
        hydratedProjectRoot: null,
        persistenceTransition: null,
      },
    },
  ])("disables every outline decision during $name", ({ state }) => {
    const cards = useProjectStore.getState().meta.chapters.ch1.cards;
    setPending(
      outlineProposal(cards, [
        {
          kind: "rewrite",
          cardId: "card-1",
          title: "Hard arrival",
          intention: null,
          toIndex: null,
          reason: "Raise the stakes",
        },
      ]),
    );
    useAgentConsoleStore.setState(state);
    const { container } = render(<ReviewTray />);
    expandReview();

    expect(
      screen.getByRole("button", { name: "Accept All" }).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Reject All" }).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
    const change = container.querySelector(
      '[data-agent-change-id="change-0"]',
    );
    if (!(change instanceof HTMLElement)) throw new Error("Missing change.");
    expect(
      within(change).getByRole("button", { name: "Accept" }).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
    expect(
      within(change).getByRole("button", { name: "Reject" }).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
  });

  it("keeps stale outline cards visible and allows rejection", () => {
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
    useProjectStore.setState((state) => ({
      meta: {
        ...state.meta,
        chapters: {
          ...state.meta.chapters,
          ch1: {
            ...state.meta.chapters.ch1,
            cards: [{ ...cards[0], title: "Changed arrival" }],
          },
        },
      },
    }));
    const { container } = render(<ReviewTray />);
    expandReview();

    expect(
      screen.getByRole("button", { name: "Accept All" }).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Reject All" }).hasAttribute(
        "disabled",
      ),
    ).toBe(false);
    const change = container.querySelector(
      '[data-agent-change-id="change-0"]',
    );
    if (!(change instanceof HTMLElement)) throw new Error("Missing stale change.");
    expect(within(change).getByText("Source changed - regenerate")).toBeTruthy();
    expect(
      within(change).getByRole("button", { name: "Accept" }).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
    expect(
      within(change).getByRole("button", { name: "Reject" }).hasAttribute(
        "disabled",
      ),
    ).toBe(false);
  });

  it("applies an individual outline decision through the shared lifecycle", () => {
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
      {
        kind: "add",
        cardId: null,
        title: "The turn",
        intention: "Force the final choice",
        toIndex: null,
        reason: "Complete the arc",
      },
    ]);
    setPending(proposal);
    const { container } = render(<ReviewTray />);
    expandReview();
    const change = container.querySelector(
      '[data-agent-change-id="change-0"]',
    );
    if (!(change instanceof HTMLElement)) throw new Error("Missing change.");

    fireEvent.click(within(change).getByRole("button", { name: "Accept" }));

    expect(useProjectStore.getState().meta.chapters.ch1.cards[0].title).toBe(
      "Hard arrival",
    );
    expect(useAgentConsoleStore.getState().pendingProposal?.changes).toHaveLength(1);
    expect(recordProposalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "accepted", changeCount: 1 }),
    );
  });

  it("keeps a mismatched proposal open without writing or recording an event", () => {
    const cards = useProjectStore.getState().meta.chapters.ch1.cards;
    const addProposal = outlineProposal(cards, [
      {
        kind: "add",
        cardId: null,
        title: "The turn",
        intention: "Force the final choice",
        toIndex: null,
        reason: "Complete the arc",
      },
    ]);
    const targetProposal = outlineProposal(cards, [
      {
        kind: "rewrite",
        cardId: "card-1",
        title: "Hard arrival",
        intention: null,
        toIndex: null,
        reason: "Raise the stakes",
      },
    ]);
    const mismatchedProposal = {
      ...addProposal,
      changes: [
        {
          ...addProposal.changes[0],
          precondition: targetProposal.changes[0].precondition,
        },
      ],
    };
    const before = structuredClone(useProjectStore.getState().meta);
    setPending(mismatchedProposal);
    render(<ReviewTray />);

    fireEvent.click(screen.getByRole("button", { name: "Accept All" }));

    expect(useProjectStore.getState().meta).toEqual(before);
    expect(useAgentConsoleStore.getState().pendingProposal).toEqual(
      mismatchedProposal,
    );
    expect(writeProjectMeta).not.toHaveBeenCalled();
    expect(recordProposalEvent).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Proposal couldn't be applied", {
      description: "Keep this proposal open and ask the agent to replace it.",
    });
  });

  it("renders and accepts an add for a valid sparse empty outline", () => {
    useProjectStore.setState((state) => ({
      meta: { ...state.meta, chapters: {} },
    }));
    const proposal = outlineProposal([], [
      {
        kind: "add",
        cardId: null,
        title: "The turn",
        intention: "Force the final choice",
        toIndex: null,
        reason: "Complete the arc",
      },
    ]);
    setPending(proposal);
    render(<ReviewTray />);

    expect(
      screen.getByRole("button", { name: "Accept All" }).hasAttribute("disabled"),
    ).toBe(false);
    expandReview();
    expect(screen.getByText("Start of outline")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept All" }));

    expect(useProjectStore.getState().meta.chapters.ch1.cards).toHaveLength(1);
    expect(useProjectStore.getState().meta.chapters.ch1.cards[0]).toMatchObject({
      title: "The turn",
      intention: "Force the final choice",
    });
    expect(useAgentConsoleStore.getState().pendingProposal).toBeNull();
  });

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

  it("keeps a proposal visible and reports an invalid batch result", () => {
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
    vi.spyOn(
      useProjectStore.getState(),
      "applyAgentOutlineProposal",
    ).mockReturnValue({
      status: "invalid",
      invalidChangeIds: ["change-0"],
      reason: "conflicting-changes",
    });
    setPending(proposal);
    render(<ReviewTray />);

    fireEvent.click(screen.getByRole("button", { name: "Accept All" }));

    expect(useAgentConsoleStore.getState().pendingProposal).toEqual(proposal);
    expect(screen.getByRole("button", { name: "Accept All" })).toBeTruthy();
    expect(recordProposalEvent).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Proposal couldn't be applied", {
      description: "Keep this proposal open and ask the agent to replace it.",
    });
  });
  it("navigates a review card without closing the tray", async () => {
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
    const conversationViewport = screen.getByRole("region", {
      name: "Conversation messages",
    });
    if (!(tray instanceof HTMLElement)) throw new Error("Missing review tray.");
    if (!(reviewViewport instanceof HTMLElement)) {
      throw new Error("Missing review viewport.");
    }
    expect(conversation.contains(conversationViewport)).toBe(true);
    expect(conversationViewport).not.toBe(conversation);
    Object.defineProperty(conversationViewport, "scrollHeight", {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(conversationViewport, "clientHeight", {
      configurable: true,
      value: 100,
    });
    conversationViewport.scrollTop = 41;
    reviewViewport.scrollTop = 17;
    fireEvent.scroll(conversationViewport);
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
    expect(
      screen.getByRole("region", { name: "Conversation messages" }),
    ).toBe(conversationViewport);
    expect(conversationViewport.scrollTop).toBe(41);
  });
});
