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
  recordProposalEvent: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { recordProposalEvent } from "@/lib/ai/agent-controller";
import {
  buildManuscriptPendingProposal,
  buildOutlinePendingProposal,
} from "@/lib/ai/agent-proposals";
import {
  acceptAllProposalChanges,
  acceptProposalChange,
  proposalStaleChangeIds,
  rejectAllProposalChanges,
  rejectProposalChange,
} from "@/lib/ai/proposal-decisions";
import type {
  AgentRun,
  ManuscriptPendingProposal,
  OutlinePendingProposal,
  PendingProposal,
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
  AgentConsoleOwnershipError,
  EMPTY_AGENT_STATE,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import { toast } from "sonner";

const projectFixture = (root: string): ProjectInfo => ({
  root,
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

const runFixture = (task: AgentRun["task"]): AgentRun => ({
  id: "run-1",
  projectRoot: "/book",
  mode: "edit",
  task,
  userMessageId: "user-1",
  attachments: [],
  startedAt: "2026-07-30T00:00:00.000Z",
});

const manuscriptProposal = (
  blocks: Block[],
  changes: BlockChange[],
): ManuscriptPendingProposal =>
  buildManuscriptPendingProposal({
    run: runFixture({ kind: "conversation", targetChapterId: "ch1" }),
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
    run: runFixture({ kind: "outline-sculpt", chapterId: "ch1" }),
    raw: { chapterId: "ch1", summary: "Strengthen the outline", changes },
    cards,
    currentPending: null,
    originatingMessageId: "assistant-1",
    makeId: idFactory(),
    now: "2026-07-30T00:01:00.000Z",
  });

const outlineRewrite = (): SculptChange => ({
  kind: "rewrite",
  cardId: "card-1",
  title: "Hard arrival",
  intention: null,
  toIndex: null,
  reason: "Raise the stakes",
});

const initialBlocks = (): Block[] => [
  blockFixture("block-1", "The rain fell."),
  blockFixture("block-2", "The door opened."),
];

const initialCards = (): Card[] => [cardFixture("card-1", "Arrival")];

const setPending = (proposal: PendingProposal): void => {
  useAgentConsoleStore.setState({ pendingProposal: proposal });
};

beforeEach(() => {
  vi.clearAllMocks();
  const blocks = initialBlocks();
  const cards = initialCards();
  useProjectStore.setState({
    project: projectFixture("/book"),
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
  });
  useAgentConsoleStore.setState({
    ...EMPTY_AGENT_STATE,
    requestedProjectRoot: "/book",
    activeProjectRoot: "/book",
    hydratedProjectRoot: "/book",
  });
  useViewStore.setState(useViewStore.getInitialState(), true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("proposal decisions", () => {
  it("applies only one manuscript change before removing and recording it", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
      rewrite("block-2", "The door eased open.", "Slow the reveal"),
    ]);
    setPending(proposal);
    useViewStore.getState().openManuscriptReview(proposal.id);

    acceptProposalChange(proposal, "change-0");

    expect(useProjectStore.getState().blocks.map((block) => block.text)).toEqual([
      "Rain whispered.",
      "The door opened.",
    ]);
    expect(useProjectStore.getState().past).toHaveLength(1);
    expect(useAgentConsoleStore.getState().pendingProposal).toMatchObject({
      id: proposal.id,
      changes: [{ id: "change-1" }],
    });
    expect(useViewStore.getState().manuscriptReviewProposalId).toBe(proposal.id);
    expect(recordProposalEvent).toHaveBeenCalledWith({
      proposalId: proposal.id,
      action: "accepted",
      changeCount: 1,
      text: "Accepted one manuscript change.",
    });
  });

  it("applies all manuscript changes atomically before clearing and recording", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
      rewrite("block-2", "The door eased open.", "Slow the reveal"),
    ]);
    setPending(proposal);
    useViewStore.getState().openManuscriptReview(proposal.id);

    acceptAllProposalChanges(proposal);

    expect(useProjectStore.getState().blocks.map((block) => block.text)).toEqual([
      "Rain whispered.",
      "The door eased open.",
    ]);
    expect(useProjectStore.getState().past).toHaveLength(1);
    expect(useAgentConsoleStore.getState().pendingProposal).toBeNull();
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
    expect(recordProposalEvent).toHaveBeenCalledWith({
      proposalId: proposal.id,
      action: "accepted-all",
      changeCount: 2,
      text: "Accepted all 2 manuscript changes.",
    });
  });

  it("rejects one change without writing project state", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
      rewrite("block-2", "The door eased open.", "Slow the reveal"),
    ]);
    const beforeBlocks = structuredClone(useProjectStore.getState().blocks);
    const beforeMeta = structuredClone(useProjectStore.getState().meta);
    setPending(proposal);
    useViewStore.getState().openManuscriptReview(proposal.id);

    rejectProposalChange(proposal, "change-0");

    expect(useProjectStore.getState().blocks).toEqual(beforeBlocks);
    expect(useProjectStore.getState().meta).toEqual(beforeMeta);
    expect(writeProjectMeta).not.toHaveBeenCalled();
    expect(useAgentConsoleStore.getState().pendingProposal).toMatchObject({
      id: proposal.id,
      changes: [{ id: "change-1" }],
    });
    expect(useViewStore.getState().manuscriptReviewProposalId).toBe(proposal.id);
    expect(recordProposalEvent).toHaveBeenCalledWith({
      proposalId: proposal.id,
      action: "rejected",
      changeCount: 1,
      text: "Rejected one manuscript change.",
    });
  });

  it("rejects all changes without writing project state", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
      rewrite("block-2", "The door eased open.", "Slow the reveal"),
    ]);
    const beforeBlocks = structuredClone(useProjectStore.getState().blocks);
    const beforeMeta = structuredClone(useProjectStore.getState().meta);
    setPending(proposal);
    useViewStore.getState().openManuscriptReview(proposal.id);

    rejectAllProposalChanges(proposal);

    expect(useProjectStore.getState().blocks).toEqual(beforeBlocks);
    expect(useProjectStore.getState().meta).toEqual(beforeMeta);
    expect(writeProjectMeta).not.toHaveBeenCalled();
    expect(useAgentConsoleStore.getState().pendingProposal).toBeNull();
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
    expect(recordProposalEvent).toHaveBeenCalledWith({
      proposalId: proposal.id,
      action: "rejected-all",
      changeCount: 2,
      text: "Rejected all 2 manuscript changes.",
    });
  });

  it("closes review after accepting the final manuscript change", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
    ]);
    setPending(proposal);
    useViewStore.getState().openManuscriptReview(proposal.id);

    acceptProposalChange(proposal, "change-0");

    expect(useAgentConsoleStore.getState().pendingProposal).toBeNull();
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
  });

  it("closes review after rejecting the final manuscript change", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
    ]);
    setPending(proposal);
    useViewStore.getState().openManuscriptReview(proposal.id);

    rejectProposalChange(proposal, "change-0");

    expect(useAgentConsoleStore.getState().pendingProposal).toBeNull();
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
  });

  it("keeps a stale manuscript proposal open with regeneration guidance", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
    ]);
    vi.spyOn(
      useProjectStore.getState(),
      "applyAgentManuscriptProposal",
    ).mockReturnValue({ status: "stale", staleChangeIds: ["change-0"] });
    setPending(proposal);

    acceptProposalChange(proposal, "change-0");

    expect(useAgentConsoleStore.getState().pendingProposal).toEqual(proposal);
    expect(recordProposalEvent).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Proposal source changed", {
      description: "Keep this proposal open and ask the agent to regenerate it.",
    });
  });

  it("keeps an invalid outline proposal open with replacement guidance", () => {
    const proposal = outlineProposal(initialCards(), [outlineRewrite()]);
    vi.spyOn(
      useProjectStore.getState(),
      "applyAgentOutlineProposal",
    ).mockReturnValue({
      status: "invalid",
      invalidChangeIds: ["change-0"],
      reason: "conflicting-changes",
    });
    setPending(proposal);

    acceptAllProposalChanges(proposal);

    expect(useAgentConsoleStore.getState().pendingProposal).toEqual(proposal);
    expect(recordProposalEvent).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Proposal couldn't be applied", {
      description: "Keep this proposal open and ask the agent to replace it.",
    });
  });

  it.each([
    {
      name: "accept",
      decide: (proposal: PendingProposal) =>
        acceptProposalChange(proposal, "missing-change"),
    },
    {
      name: "reject",
      decide: (proposal: PendingProposal) =>
        rejectProposalChange(proposal, "missing-change"),
    },
  ])("raises for an unknown change before $name writes", ({ decide }) => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
    ]);
    const beforeBlocks = structuredClone(useProjectStore.getState().blocks);
    const beforeMeta = structuredClone(useProjectStore.getState().meta);
    setPending(proposal);

    expect(() => decide(proposal)).toThrow(
      "Pending proposal change not found: missing-change",
    );
    expect(useProjectStore.getState().blocks).toEqual(beforeBlocks);
    expect(useProjectStore.getState().meta).toEqual(beforeMeta);
    expect(useProjectStore.getState().past).toHaveLength(0);
    expect(useAgentConsoleStore.getState().pendingProposal).toEqual(proposal);
    expect(recordProposalEvent).not.toHaveBeenCalled();
    expect(writeProjectMeta).not.toHaveBeenCalled();
  });

  it("offers Undo through the existing outline success toast", () => {
    const proposal = outlineProposal(initialCards(), [outlineRewrite()]);
    const undo = vi.spyOn(
      useProjectStore.getState(),
      "undoAgentOutlineProposal",
    );
    setPending(proposal);

    acceptAllProposalChanges(proposal);

    expect(useProjectStore.getState().meta.chapters.ch1.cards[0].title).toBe(
      "Hard arrival",
    );
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
    expect(recordProposalEvent).toHaveBeenCalledWith({
      proposalId: proposal.id,
      action: "accepted-all",
      changeCount: 1,
      text: "Accepted all 1 outline changes.",
    });
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

    expect(undo).toHaveBeenCalledWith(
      expect.objectContaining({ projectRoot: "/book" }),
    );
    expect(useProjectStore.getState().meta.chapters.ch1.cards[0].title).toBe(
      "Arrival",
    );
  });

  it.each([
    {
      name: "accept one",
      decide: (proposal: PendingProposal) =>
        acceptProposalChange(proposal, "missing-change"),
    },
    {
      name: "accept all",
      decide: (proposal: PendingProposal) => acceptAllProposalChanges(proposal),
    },
    {
      name: "reject one",
      decide: (proposal: PendingProposal) =>
        rejectProposalChange(proposal, "missing-change"),
    },
    {
      name: "reject all",
      decide: (proposal: PendingProposal) => rejectAllProposalChanges(proposal),
    },
  ])("validates ownership before $name", ({ decide }) => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
    ]);
    const apply = vi.spyOn(
      useProjectStore.getState(),
      "applyAgentManuscriptProposal",
    );
    setPending(proposal);
    useAgentConsoleStore.setState({ hydratedProjectRoot: null });

    expect(() => decide(proposal)).toThrow(AgentConsoleOwnershipError);
    expect(apply).not.toHaveBeenCalled();
    expect(useAgentConsoleStore.getState().pendingProposal).toEqual(proposal);
    expect(recordProposalEvent).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "accept one",
      kind: "outline",
      decide: (proposal: PendingProposal) =>
        acceptProposalChange(proposal, "change-0"),
    },
    {
      name: "accept all",
      kind: "outline",
      decide: (proposal: PendingProposal) => acceptAllProposalChanges(proposal),
    },
    {
      name: "reject one",
      kind: "manuscript",
      decide: (proposal: PendingProposal) =>
        rejectProposalChange(proposal, "change-0"),
    },
    {
      name: "reject all",
      kind: "manuscript",
      decide: (proposal: PendingProposal) => rejectAllProposalChanges(proposal),
    },
  ])(
    "refuses to $name from a callback after another proposal replaces it",
    ({ decide, kind }) => {
      const callbackProposal: PendingProposal =
        kind === "outline"
          ? outlineProposal(initialCards(), [outlineRewrite()])
          : manuscriptProposal(useProjectStore.getState().blocks, [
              rewrite("block-1", "Rain whispered.", "Quiet the opening"),
              rewrite("block-2", "The door eased open.", "Slow the reveal"),
            ]);
      const replacement: PendingProposal =
        kind === "outline"
          ? {
              ...outlineProposal(initialCards(), [
                {
                  ...outlineRewrite(),
                  title: "Quiet arrival",
                  reason: "Lower the tension",
                },
              ]),
              id: "replacement-proposal",
            }
          : {
              ...manuscriptProposal(useProjectStore.getState().blocks, [
                rewrite("block-1", "Rain hammered.", "Intensify the opening"),
                rewrite("block-2", "The door burst open.", "Speed the reveal"),
              ]),
              id: "replacement-proposal",
            };
      const beforeBlocks = structuredClone(useProjectStore.getState().blocks);
      const beforeMeta = structuredClone(useProjectStore.getState().meta);
      setPending(replacement);
      useViewStore.getState().openManuscriptReview(callbackProposal.id);

      expect(() => decide(callbackProposal)).toThrow(
        `Cannot decide proposal proposal-1 (${kind}): current pending proposal is replacement-proposal (${kind}). Refresh and retry.`,
      );

      expect(useProjectStore.getState().blocks).toEqual(beforeBlocks);
      expect(useProjectStore.getState().meta).toEqual(beforeMeta);
      expect(useProjectStore.getState().past).toHaveLength(0);
      expect(useProjectStore.getState().chapterDirty).toBe(false);
      expect(useAgentConsoleStore.getState().pendingProposal).toBe(replacement);
      expect(useViewStore.getState().manuscriptReviewProposalId).toBe(
        callbackProposal.id,
      );
      expect(writeProjectMeta).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      expect(recordProposalEvent).not.toHaveBeenCalled();
    },
  );

  it("refuses a same-ID callback when the current proposal kind differs", () => {
    const callbackProposal = manuscriptProposal(
      useProjectStore.getState().blocks,
      [rewrite("block-1", "Rain whispered.", "Quiet the opening")],
    );
    const replacement = {
      ...outlineProposal(initialCards(), [outlineRewrite()]),
      id: callbackProposal.id,
    };
    const beforeBlocks = structuredClone(useProjectStore.getState().blocks);
    const beforeMeta = structuredClone(useProjectStore.getState().meta);
    setPending(replacement);
    useViewStore.getState().openManuscriptReview(callbackProposal.id);

    expect(() => acceptAllProposalChanges(callbackProposal)).toThrow(
      "Cannot decide proposal proposal-1 (manuscript): current pending proposal is proposal-1 (outline). Refresh and retry.",
    );

    expect(useProjectStore.getState().blocks).toEqual(beforeBlocks);
    expect(useProjectStore.getState().meta).toEqual(beforeMeta);
    expect(useProjectStore.getState().past).toHaveLength(0);
    expect(useAgentConsoleStore.getState().pendingProposal).toBe(replacement);
    expect(useViewStore.getState().manuscriptReviewProposalId).toBe(
      callbackProposal.id,
    );
    expect(writeProjectMeta).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(recordProposalEvent).not.toHaveBeenCalled();
  });

  it("accepts one change with canonical same-ID edited text", () => {
    const callbackProposal = manuscriptProposal(
      useProjectStore.getState().blocks,
      [
        rewrite("block-1", "Rain whispered.", "Quiet the opening"),
        rewrite("block-2", "The door eased open.", "Slow the reveal"),
      ],
    );
    setPending(callbackProposal);
    useAgentConsoleStore.getState().updatePendingManuscriptText({
      proposalId: callbackProposal.id,
      changeId: "change-0",
      newText: "Rain sang against the glass.",
    });

    acceptProposalChange(callbackProposal, "change-0");

    expect(useProjectStore.getState().blocks.map((block) => block.text)).toEqual([
      "Rain sang against the glass.",
      "The door opened.",
    ]);
    expect(useProjectStore.getState().past).toHaveLength(1);
    expect(useAgentConsoleStore.getState().pendingProposal).toMatchObject({
      id: callbackProposal.id,
      changes: [{ id: "change-1" }],
    });
    expect(recordProposalEvent).toHaveBeenCalledWith({
      proposalId: callbackProposal.id,
      action: "accepted",
      changeCount: 1,
      text: "Accepted one manuscript change.",
    });
  });

  it("accepts all using canonical same-ID changes, edited text, and count", () => {
    const callbackProposal = manuscriptProposal(
      useProjectStore.getState().blocks,
      [
        rewrite("block-1", "Rain whispered.", "Quiet the opening"),
        rewrite("block-2", "The door eased open.", "Slow the reveal"),
      ],
    );
    setPending(callbackProposal);
    useAgentConsoleStore.getState().updatePendingManuscriptText({
      proposalId: callbackProposal.id,
      changeId: "change-1",
      newText: "The door opened without a sound.",
    });
    const editedProposal = useAgentConsoleStore.getState().pendingProposal;
    if (editedProposal === null || editedProposal.kind !== "manuscript") {
      throw new Error("Expected the edited manuscript proposal.");
    }
    setPending({ ...editedProposal, changes: [editedProposal.changes[1]] });

    acceptAllProposalChanges(callbackProposal);

    expect(useProjectStore.getState().blocks.map((block) => block.text)).toEqual([
      "The rain fell.",
      "The door opened without a sound.",
    ]);
    expect(useProjectStore.getState().past).toHaveLength(1);
    expect(useAgentConsoleStore.getState().pendingProposal).toBeNull();
    expect(recordProposalEvent).toHaveBeenCalledWith({
      proposalId: callbackProposal.id,
      action: "accepted-all",
      changeCount: 1,
      text: "Accepted all 1 manuscript changes.",
    });
  });

  it.each([
    {
      name: "accept",
      decide: (proposal: PendingProposal) =>
        acceptProposalChange(proposal, "change-0"),
    },
    {
      name: "reject",
      decide: (proposal: PendingProposal) =>
        rejectProposalChange(proposal, "change-0"),
    },
  ])("uses canonical same-ID change lookup before $name", ({ decide }) => {
    const callbackProposal = manuscriptProposal(
      useProjectStore.getState().blocks,
      [
        rewrite("block-1", "Rain whispered.", "Quiet the opening"),
        rewrite("block-2", "The door eased open.", "Slow the reveal"),
      ],
    );
    const currentProposal = {
      ...callbackProposal,
      changes: [callbackProposal.changes[1]],
    };
    const beforeBlocks = structuredClone(useProjectStore.getState().blocks);
    setPending(currentProposal);

    expect(() => decide(callbackProposal)).toThrow(
      "Pending proposal change not found: change-0",
    );
    expect(useProjectStore.getState().blocks).toEqual(beforeBlocks);
    expect(useProjectStore.getState().past).toHaveLength(0);
    expect(useAgentConsoleStore.getState().pendingProposal).toBe(
      currentProposal,
    );
    expect(recordProposalEvent).not.toHaveBeenCalled();
  });

  it("rejects all using the canonical same-ID count and event data", () => {
    const callbackProposal = manuscriptProposal(
      useProjectStore.getState().blocks,
      [
        rewrite("block-1", "Rain whispered.", "Quiet the opening"),
        rewrite("block-2", "The door eased open.", "Slow the reveal"),
      ],
    );
    const currentProposal = {
      ...callbackProposal,
      changes: [callbackProposal.changes[1]],
    };
    setPending(currentProposal);

    rejectAllProposalChanges(callbackProposal);

    expect(useAgentConsoleStore.getState().pendingProposal).toBeNull();
    expect(recordProposalEvent).toHaveBeenCalledWith({
      proposalId: callbackProposal.id,
      action: "rejected-all",
      changeCount: 1,
      text: "Rejected all 1 manuscript changes.",
    });
  });
});

describe("proposalStaleChangeIds", () => {
  it("marks every change stale when no project is open", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
      rewrite("block-2", "The door eased open.", "Slow the reveal"),
    ]);
    useProjectStore.setState({ project: null });

    expect(proposalStaleChangeIds(proposal)).toEqual(
      new Set(["change-0", "change-1"]),
    );
  });

  it("marks every change stale when the project root differs", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
      rewrite("block-2", "The door eased open.", "Slow the reveal"),
    ]);
    useProjectStore.setState({ project: projectFixture("/another-book") });

    expect(proposalStaleChangeIds(proposal)).toEqual(
      new Set(["change-0", "change-1"]),
    );
  });

  it("marks every manuscript change stale outside its active chapter", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
      rewrite("block-2", "The door eased open.", "Slow the reveal"),
    ]);
    useProjectStore.setState({ activeChapterId: "ch2" });

    expect(proposalStaleChangeIds(proposal)).toEqual(
      new Set(["change-0", "change-1"]),
    );
  });

  it("marks only manuscript changes whose source changed as stale", () => {
    const blocks = useProjectStore.getState().blocks;
    const proposal = manuscriptProposal(blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
      rewrite("block-2", "The door eased open.", "Slow the reveal"),
    ]);
    useProjectStore.setState({
      blocks: [{ ...blocks[0], text: "The source changed." }, blocks[1]],
    });

    expect(proposalStaleChangeIds(proposal)).toEqual(new Set(["change-0"]));
  });

  it("marks outline changes whose source changed as stale", () => {
    const cards = initialCards();
    const proposal = outlineProposal(cards, [outlineRewrite()]);
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

    expect(proposalStaleChangeIds(proposal)).toEqual(new Set(["change-0"]));
  });
});
