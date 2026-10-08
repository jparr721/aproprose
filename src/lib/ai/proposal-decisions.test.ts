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
import { buildContinuationIntent } from "@/lib/ai/agent-continuation";
import {
  buildManuscriptPendingProposal,
  buildOutlinePendingProposal,
} from "@/lib/ai/agent-proposals";
import {
  acceptAllProposalChanges,
  acceptProposalChange,
  proposalStaleChangeIds,
  proposalRequiresSourceNavigation,
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
import { emptyProjectKnowledge } from "@/lib/story-knowledge/model";
import { applyProposal } from "@/lib/blocks/proposal";
import { projectManuscriptReview } from "@/lib/ai/manuscript-review-projection";
import { fromAgentSnapshot, toAgentSnapshot } from "@/stores/agent-persistence";
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
    currentOverview: "",
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
    currentOverview: "",
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

const outlineAdd = (title: string): SculptChange => ({
  kind: "add",
  cardId: null,
  title,
  intention: "Advance the story",
  toIndex: null,
  reason: "Develop the outline",
});

const manuscriptInsert = (afterId: string | null, newText: string): BlockChange => ({
  kind: "insert",
  blockId: null,
  afterId,
  type: "narration",
  speaker: null,
  newText,
  toIndex: null,
  reason: "Develop the scene",
});

const initialBlocks = (): Block[] => [
  blockFixture("block-1", "The rain fell."),
  blockFixture("block-2", "The door opened."),
];

const initialCards = (): Card[] => [cardFixture("card-1", "Arrival")];

const insertionAnchors: Array<string | null> = ["block-1", "block-2", null];
const approvalBatches: number[][][] = [
  [[0], [1], [2]], [[0], [2], [1]], [[1], [0], [2]],
  [[1], [2], [0]], [[2], [0], [1]], [[2], [1], [0]],
  [[0, 1], [2]], [[0, 2], [1]], [[1, 2], [0]],
  [[0], [1, 2]], [[1], [0, 2]], [[2], [0, 1]],
];
const insertionApprovalCases = insertionAnchors.flatMap((first) =>
  insertionAnchors.flatMap((second) => insertionAnchors.flatMap((third) =>
    approvalBatches.map((batches) => ({ anchors: [first, second, third], batches })),
  )),
);

const bridgePrefixes: Array<{ label: string; blocks: Block[] }> = [
  { label: "scene", blocks: [{ ...blockFixture("scene", "Kitchen"), type: "chapter", level: "scene" }] },
  { label: "scratchpad", blocks: [{ ...blockFixture("notes", "Scene notes"), type: "scratchpad" }] },
  { label: "latex", blocks: [{ ...blockFixture("literal", "Literal source"), type: "latex" }] },
  {
    label: "mixed",
    blocks: [
      { ...blockFixture("scene", "Kitchen"), type: "chapter", level: "scene" },
      { ...blockFixture("notes", "Scene notes"), type: "scratchpad" },
      { ...blockFixture("literal", "Literal source"), type: "latex" },
    ],
  },
];
const bridgeApprovalCases = bridgePrefixes.flatMap((prefix) => approvalBatches.flatMap((batches) =>
  [false, true].map((reopen) => ({ ...prefix, batches, reopen })),
));

const setPending = (proposal: PendingProposal): void => {
  useAgentConsoleStore.setState({
    proposalRecords: [{ proposal, source: { kind: "legacy" }, decisions: {}, replacedByProposalId: null }],
    currentProposalId: proposal.id,
    pendingProposal: proposal,
  });
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
          cards,
        },
      },
      knowledge: emptyProjectKnowledge(),
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
  it("does not refresh an end boundary removed by the author before another approval", () => {
    const proposal = manuscriptProposal(initialBlocks(), [
      manuscriptInsert("block-1", "Middle"), rewrite("block-1", "Revised opening", "Revise"),
      manuscriptInsert(null, "End"),
    ]);
    setPending(proposal);
    acceptProposalChange(proposal, "change-0");
    useProjectStore.getState().deleteBlock("block-2");
    acceptProposalChange(proposal, "change-1");
    const pending = useAgentConsoleStore.getState().pendingProposal;
    if (pending === null) throw new Error("Expected stale end insertion");
    expect(proposalStaleChangeIds(pending)).toEqual(new Set(["change-2"]));
    acceptAllProposalChanges(pending);
    expect(useProjectStore.getState().blocks.map((block) => block.text)).toEqual(["Revised opening", "Middle"]);
  });

  it.each(["remove", "move", "rewrite"] satisfies BlockChange["kind"][])(
    "keeps end insertions valid after their own %s changes the captured tail", (kind) => {
      const changes: BlockChange[] = [
        manuscriptInsert("block-1", "Middle"),
        { ...rewrite("block-2", "Revised tail", "Revise"), kind, toIndex: kind === "move" ? 0 : null },
        manuscriptInsert(null, "End first"), manuscriptInsert(null, "End second"),
      ];
      const expected = applyProposal(initialBlocks(), changes, () => undefined).blocks.map((block) => block.text);
      const proposal = manuscriptProposal(initialBlocks(), changes);
      setPending(proposal);
      acceptProposalChange(proposal, "change-0");
      acceptProposalChange(proposal, "change-1");
      const pending = useAgentConsoleStore.getState().pendingProposal;
      if (pending === null) throw new Error("Expected end insertions after changing the tail");
      expect(proposalStaleChangeIds(pending)).toEqual(new Set());
      acceptAllProposalChanges(pending);
      expect(useProjectStore.getState().blocks.map((block) => block.text)).toEqual(expected);
    },
  );

  it("restores mixed end boundaries before applying the remaining insertion groups", async () => {
    const proposal = manuscriptProposal(initialBlocks(), [
      manuscriptInsert("block-2", "Anchored"), manuscriptInsert(null, "End first"),
      manuscriptInsert(null, "End second"), manuscriptInsert(null, "End third"),
    ]);
    setPending(proposal);
    acceptProposalChange(proposal, "change-2");
    const snapshot = await toAgentSnapshot();
    useAgentConsoleStore.getState().hydrate("/book", await fromAgentSnapshot("/book", snapshot));
    acceptProposalChange(proposal, "change-0");
    const pending = useAgentConsoleStore.getState().pendingProposal;
    if (pending === null) throw new Error("Expected restored end insertions");
    expect(proposalStaleChangeIds(pending)).toEqual(new Set());
    acceptAllProposalChanges(pending);
    expect(useProjectStore.getState().blocks.map((block) => block.text)).toEqual([
      "The rain fell.", "The door opened.", "Anchored", "End first", "End second", "End third",
    ]);
    expect(useAgentConsoleStore.getState().proposalRecords[0].proposal).toEqual(proposal);
  });

  it.each(insertionApprovalCases)("preserves mixed insertion boundaries for $anchors with batches $batches", ({ anchors, batches }) => {
    const original = initialBlocks();
    const changes = anchors.map((anchor, index) => manuscriptInsert(anchor, `Passage ${index}`));
    const expected = applyProposal(original, changes, () => undefined).blocks.map((block) => block.text);
    const proposal = manuscriptProposal(original, changes);
    setPending(proposal);
    for (const batch of batches) {
      const pending = useAgentConsoleStore.getState().pendingProposal;
      if (pending === null || pending.kind !== "manuscript") throw new Error("Expected pending manuscript insertions");
      expect(proposalStaleChangeIds(pending)).toEqual(new Set());
      const preview = projectManuscriptReview(useProjectStore.getState().blocks, pending);
      expect(preview.rows.map((row) => {
        if (row.kind === "unchanged") return row.block.text;
        if (row.kind === "insert") return row.change.change.newText;
        throw new Error(`Unexpected insertion review row: ${row.kind}`);
      })).toEqual(expected);
      const selected = new Set(batch.map((index) => `change-${index}`));
      acceptAllProposalChanges({ ...pending, changes: pending.changes.filter((item) => selected.has(item.id)) });
    }
    expect(useProjectStore.getState().blocks.map((block) => block.text)).toEqual(expected);
    expect(useAgentConsoleStore.getState().proposalRecords[0].proposal).toEqual(proposal);
  });

  it.each(bridgeApprovalCases)("keeps the $label prefix before opening bridge prose for batches $batches with reopen $reopen", async ({ blocks, batches, reopen }) => {
    useProjectStore.setState({ blocks });
    const intent = buildContinuationIntent("ch1", blocks, []);
    expect(intent.task).toEqual({ kind: "bridge", chapterId: "ch1", anchorBlockId: null, successorBlockId: null });
    const proposal = buildManuscriptPendingProposal({
      run: runFixture(intent.task),
      raw: { chapterId: "ch1", summary: "Write the opening", changes: ["First", "Second", "Third"].map((text) => manuscriptInsert(null, text)) },
      blocks,
      currentPending: null,
      originatingMessageId: "assistant-1",
      makeId: idFactory(),
      currentOverview: "",
      now: "2026-10-08T00:00:00.000Z",
    });
    const immutableOriginal = structuredClone(proposal);
    const expected = [...blocks.map((block) => block.text), "First", "Second", "Third"];
    setPending(proposal);
    for (const batch of batches) {
      const pending = useAgentConsoleStore.getState().pendingProposal;
      if (pending === null || pending.kind !== "manuscript") throw new Error("Expected pending opening bridge insertions");
      expect(proposalStaleChangeIds(pending)).toEqual(new Set());
      const preview = projectManuscriptReview(useProjectStore.getState().blocks, pending);
      expect(preview.rows.map((row) => {
        if (row.kind === "unchanged") return row.block.text;
        if (row.kind === "insert") return row.change.change.newText;
        throw new Error(`Unexpected bridge review row: ${row.kind}`);
      })).toEqual(expected);
      const selected = new Set(batch.map((index) => `change-${index}`));
      acceptAllProposalChanges({ ...pending, changes: pending.changes.filter((item) => selected.has(item.id)) });
      if (reopen) {
        const snapshot = await toAgentSnapshot();
        useAgentConsoleStore.getState().hydrate("/book", await fromAgentSnapshot("/book", JSON.parse(JSON.stringify(snapshot))));
      }
      expect(useAgentConsoleStore.getState().proposalRecords[0].proposal).toEqual(immutableOriginal);
    }
    expect(useProjectStore.getState().blocks.map((block) => block.text)).toEqual(expected);
  });

  it("keeps sibling outline additions reviewable after accepting one", () => {
    const proposal = outlineProposal(initialCards(), [
      outlineAdd("First beat"), outlineAdd("Second beat"), outlineAdd("Third beat"),
    ]);
    setPending(proposal);

    acceptProposalChange(proposal, "change-0");
    const pending = useAgentConsoleStore.getState().pendingProposal;
    if (pending === null) throw new Error("Expected remaining outline additions");
    expect(proposalStaleChangeIds(pending)).toEqual(new Set());
    expect(useAgentConsoleStore.getState().proposalRecords[0].proposal).toEqual(proposal);

    acceptProposalChange(pending, "change-1");
    acceptProposalChange(proposal, "change-2");

    expect(useProjectStore.getState().meta.chapters.ch1.cards.map((card) => card.title))
      .toEqual(["Arrival", "First beat", "Second beat", "Third beat"]);
    expect(useAgentConsoleStore.getState().pendingProposal).toBeNull();
  });

  it("does not refresh an outline order already changed by the author", () => {
    const proposal = outlineProposal(initialCards(), [outlineRewrite(), outlineAdd("Draft beat")]);
    setPending(proposal);
    const authorCardId = useProjectStore.getState().addCard("ch1");
    useProjectStore.getState().editCard("ch1", authorCardId, { title: "Author beat", intention: "Manual change" });

    acceptProposalChange(proposal, "change-0");
    const pending = useAgentConsoleStore.getState().pendingProposal;
    if (pending === null) throw new Error("Expected stale outline addition");
    expect(proposalStaleChangeIds(pending)).toEqual(new Set(["change-1"]));
    acceptProposalChange(pending, "change-1");
    expect(useProjectStore.getState().meta.chapters.ch1.cards.map((card) => card.title))
      .toEqual(["Hard arrival", "Author beat"]);
  });

  it("keeps later author outline edits stale after accepting a sibling", () => {
    const proposal = outlineProposal(initialCards(), [outlineAdd("First beat"), outlineAdd("Second beat")]);
    setPending(proposal);
    acceptProposalChange(proposal, "change-0");
    const authorCardId = useProjectStore.getState().addCard("ch1");
    useProjectStore.getState().editCard("ch1", authorCardId, { title: "Author beat", intention: "Manual change" });

    const pending = useAgentConsoleStore.getState().pendingProposal;
    if (pending === null) throw new Error("Expected stale outline addition");
    expect(proposalStaleChangeIds(pending)).toEqual(new Set(["change-1"]));
    acceptProposalChange(pending, "change-1");
    expect(useProjectStore.getState().meta.chapters.ch1.cards.map((card) => card.title))
      .toEqual(["Arrival", "First beat", "Author beat"]);
  });

  it("keeps sibling manuscript insertions in proposal reading order", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      manuscriptInsert("block-1", "First passage"), manuscriptInsert("block-1", "Second passage"),
    ]);
    setPending(proposal);

    acceptProposalChange(proposal, "change-0");
    const pending = useAgentConsoleStore.getState().pendingProposal;
    if (pending === null) throw new Error("Expected remaining manuscript insertion");
    expect(proposalStaleChangeIds(pending)).toEqual(new Set());
    acceptProposalChange(pending, "change-1");

    expect(useProjectStore.getState().blocks.map((block) => block.text))
      .toEqual(["The rain fell.", "First passage", "Second passage", "The door opened."]);
    expect(useAgentConsoleStore.getState().proposalRecords[0].proposal).toEqual(proposal);
  });

  it("does not refresh a manuscript successor changed by the author", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      rewrite("block-1", "Revised anchor", "Revise"), manuscriptInsert("block-1", "Draft passage"),
    ]);
    setPending(proposal);
    useProjectStore.getState().insertAfter("block-1", { text: "Author passage" });

    acceptProposalChange(proposal, "change-0");
    const pending = useAgentConsoleStore.getState().pendingProposal;
    if (pending === null) throw new Error("Expected stale manuscript insertion");
    expect(proposalStaleChangeIds(pending)).toEqual(new Set(["change-1"]));
    acceptProposalChange(pending, "change-1");
    expect(useProjectStore.getState().blocks.map((block) => block.text))
      .toEqual(["Revised anchor", "Author passage", "The door opened."]);
  });

  it.each(["rewrite", "move", "remove"] satisfies SculptChange["kind"][])(
    "advances fresh outline order guards after its own %s", (kind) => {
      const cards = [cardFixture("card-1", "Arrival"), cardFixture("card-2", "Reversal")];
      useProjectStore.setState((state) => ({ meta: { ...state.meta, chapters: { ch1: { ...state.meta.chapters.ch1, cards } } } }));
      const first: SculptChange = { ...outlineRewrite(), kind, toIndex: kind === "move" ? 1 : null };
      const proposal = outlineProposal(cards, [first, outlineAdd("New turn")]);
      setPending(proposal);

      acceptProposalChange(proposal, "change-0");
      const pending = useAgentConsoleStore.getState().pendingProposal;
      if (pending === null) throw new Error("Expected pending outline addition");
      expect(proposalStaleChangeIds(pending)).toEqual(new Set());
      acceptAllProposalChanges(pending);
      expect(useProjectStore.getState().meta.chapters.ch1.cards.at(-1)?.title).toBe("New turn");
    },
  );

  it.each(["rewrite", "insert", "remove"] satisfies BlockChange["kind"][])(
    "advances fresh manuscript move guards after its own %s", (kind) => {
      const first: BlockChange = kind === "insert"
        ? manuscriptInsert("block-1", "Middle passage")
        : { ...rewrite("block-1", "Revised opening", "Revise"), kind };
      const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
        first, { ...rewrite("block-2", "", "Move"), kind: "move", newText: null, toIndex: 0 },
      ]);
      setPending(proposal);

      acceptProposalChange(proposal, "change-0");
      const pending = useAgentConsoleStore.getState().pendingProposal;
      if (pending === null) throw new Error("Expected pending manuscript move");
      expect(proposalStaleChangeIds(pending)).toEqual(new Set());
      acceptAllProposalChanges(pending);
      expect(useProjectStore.getState().blocks[0].text).toBe("The door opened.");
    },
  );

  it.each([
    { order: [2, 1, 0], remainingBatch: false },
    { order: [1], remainingBatch: true },
    { order: [1, 0, 2], remainingBatch: false },
  ])("preserves insertion reading order for approvals $order", ({ order, remainingBatch }) => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      manuscriptInsert("block-1", "First passage"), manuscriptInsert("block-1", "Second passage"),
      manuscriptInsert("block-1", "Third passage"),
    ]);
    setPending(proposal);
    for (const index of order) acceptProposalChange(proposal, `change-${index}`);
    if (remainingBatch) {
      const pending = useAgentConsoleStore.getState().pendingProposal;
      if (pending === null) throw new Error("Expected remaining manuscript insertions");
      acceptAllProposalChanges(pending);
    }
    expect(useProjectStore.getState().blocks.map((block) => block.text))
      .toEqual(["The rain fell.", "First passage", "Second passage", "Third passage", "The door opened."]);
  });

  it("keeps dismissed sibling additions reviewable when restored after an approval", () => {
    const proposal = outlineProposal(initialCards(), [outlineAdd("First beat"), outlineAdd("Second beat")]);
    setPending(proposal);
    rejectProposalChange(proposal, "change-1");
    acceptProposalChange(proposal, "change-0");
    useAgentConsoleStore.getState().restoreProposalChanges(proposal.id, ["change-1"]);
    const restored = useAgentConsoleStore.getState().pendingProposal;
    if (restored === null) throw new Error("Expected restored outline addition");
    expect(proposalStaleChangeIds(restored)).toEqual(new Set());
    acceptAllProposalChanges(restored);
    expect(useProjectStore.getState().meta.chapters.ch1.cards.map((card) => card.title))
      .toEqual(["Arrival", "First beat", "Second beat"]);
  });

  it("does not advance another retained proposal after accepting its sibling draft", () => {
    const older = outlineProposal(initialCards(), [outlineAdd("Older beat")]);
    const newer = { ...outlineProposal(initialCards(), [outlineAdd("Newer beat"), outlineAdd("Last beat")]), id: "newer" };
    setPending(older);
    useAgentConsoleStore.getState().stageProposal(newer, { kind: "legacy" });
    acceptProposalChange(newer, "change-0");
    expect(proposalStaleChangeIds(older)).toEqual(new Set(["change-0"]));
    acceptAllProposalChanges(older);
    expect(useProjectStore.getState().meta.chapters.ch1.cards.map((card) => card.title))
      .toEqual(["Arrival", "Newer beat"]);
  });

  it("does not accept an advanced manuscript guard after undoing its applied sibling", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      manuscriptInsert("block-1", "First passage"), manuscriptInsert("block-1", "Second passage"),
    ]);
    setPending(proposal);
    acceptProposalChange(proposal, "change-0");
    useProjectStore.getState().undo();
    const pending = useAgentConsoleStore.getState().pendingProposal;
    if (pending === null) throw new Error("Expected pending manuscript insertion");
    expect(proposalStaleChangeIds(pending)).toEqual(new Set(["change-1"]));
    acceptProposalChange(pending, "change-1");
    expect(useProjectStore.getState().blocks.map((block) => block.text))
      .toEqual(["The rain fell.", "The door opened."]);
  });

  it("keeps duplicate insertion receipts associated with their original anchors", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      manuscriptInsert("block-2", "Same passage"), manuscriptInsert("block-1", "Same passage"),
      manuscriptInsert("block-2", "Second anchor tail"), manuscriptInsert("block-1", "First anchor tail"),
    ]);
    setPending(proposal);
    acceptAllProposalChanges({ ...proposal, changes: proposal.changes.slice(0, 2) });
    acceptProposalChange(proposal, "change-3");
    acceptProposalChange(proposal, "change-2");
    expect(useProjectStore.getState().blocks.map((block) => block.text)).toEqual([
      "The rain fell.", "Same passage", "First anchor tail",
      "The door opened.", "Same passage", "Second anchor tail",
    ]);
  });

  it.each([0, 1, 2])("preserves unanchored insertion order in an empty chapter after approving $0 first", (first) => {
    useProjectStore.setState({ blocks: [] });
    const proposal = manuscriptProposal([], [
      manuscriptInsert(null, "First passage"), manuscriptInsert(null, "Second passage"), manuscriptInsert(null, "Third passage"),
    ]);
    setPending(proposal);
    acceptProposalChange(proposal, `change-${first}`);
    const pending = useAgentConsoleStore.getState().pendingProposal;
    if (pending === null) throw new Error("Expected remaining opening passages");
    expect(proposalStaleChangeIds(pending)).toEqual(new Set());
    acceptAllProposalChanges(pending);
    expect(useProjectStore.getState().blocks.map((block) => block.text))
      .toEqual(["First passage", "Second passage", "Third passage"]);
  });

  it("restores an earlier dismissed insertion before its applied sibling", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      manuscriptInsert("block-1", "First passage"), manuscriptInsert("block-1", "Second passage"),
    ]);
    setPending(proposal);
    rejectProposalChange(proposal, "change-0");
    acceptProposalChange(proposal, "change-1");
    useAgentConsoleStore.getState().restoreProposalChanges(proposal.id, ["change-0"]);
    const restored = useAgentConsoleStore.getState().pendingProposal;
    if (restored === null) throw new Error("Expected restored earlier insertion");
    expect(proposalStaleChangeIds(restored)).toEqual(new Set());
    acceptAllProposalChanges(restored);
    expect(useProjectStore.getState().blocks.map((block) => block.text))
      .toEqual(["The rain fell.", "First passage", "Second passage", "The door opened."]);
  });

  it("keeps a subscriber edit stale instead of capturing it as an applied proposal change", () => {
    const proposal = outlineProposal(initialCards(), [outlineAdd("First beat"), outlineAdd("Second beat")]);
    setPending(proposal);
    let edited = false;
    const unsubscribe = useProjectStore.subscribe((state) => {
      if (!edited && state.meta.chapters.ch1.cards.length === 2) {
        edited = true;
        state.editCard("ch1", "card-1", { title: "Author revision" });
      }
    });
    try {
      acceptProposalChange(proposal, "change-0");
    } finally {
      unsubscribe();
    }
    const pending = useAgentConsoleStore.getState().pendingProposal;
    if (pending === null) throw new Error("Expected stale outline addition");
    expect(proposalStaleChangeIds(pending)).toEqual(new Set(["change-1"]));
    acceptProposalChange(pending, "change-1");
    expect(useProjectStore.getState().meta.chapters.ch1.cards.map((card) => card.title))
      .toEqual(["Author revision", "First beat"]);
  });

  it("does not retarget an insertion to identical text after removing its source boundary", () => {
    const blocks = ["first", "second", "third", "fourth"].map((id) => blockFixture(id, "Same text"));
    useProjectStore.setState({ blocks });
    const proposal = manuscriptProposal(blocks, [
      { ...rewrite("first", "", "Remove"), kind: "remove", newText: null },
      { ...rewrite("second", "", "Remove"), kind: "remove", newText: null },
      manuscriptInsert("first", "Draft passage"),
    ]);
    setPending(proposal);
    acceptAllProposalChanges({ ...proposal, changes: proposal.changes.slice(0, 2) });
    const pending = useAgentConsoleStore.getState().pendingProposal;
    if (pending === null) throw new Error("Expected stale insertion after source removal");
    expect(proposalStaleChangeIds(pending)).toEqual(new Set(["change-2"]));
    acceptProposalChange(pending, "change-2");
    expect(useProjectStore.getState().blocks.map((block) => block.id)).toEqual(["third", "fourth"]);
  });

  it("does not expand a captured batch when another change is restored", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      rewrite("block-1", "First draft", "Revise"), rewrite("block-2", "Second draft", "Revise"),
    ]);
    setPending(proposal);
    rejectProposalChange(proposal, "change-0");
    const captured = useAgentConsoleStore.getState().pendingProposal;
    if (captured === null) throw new Error("Expected a pending batch");
    useAgentConsoleStore.getState().restoreProposalChanges(proposal.id, ["change-0"]);
    acceptAllProposalChanges(captured);
    expect(useProjectStore.getState().blocks.map((block) => block.text)).toEqual(["The rain fell.", "Second draft"]);
    expect(useAgentConsoleStore.getState().pendingProposal).toMatchObject({ changes: [{ id: "change-0" }] });
  });

  it("refuses a captured batch if any selected change was already decided", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      rewrite("block-1", "First draft", "Revise"), rewrite("block-2", "Second draft", "Revise"),
    ]);
    setPending(proposal);
    rejectProposalChange(proposal, "change-0");
    expect(() => acceptAllProposalChanges(proposal)).toThrow("Pending proposal change not found: change-0");
    expect(useProjectStore.getState().past).toHaveLength(0);
  });

  it("applies an older retained draft by exact identity without retargeting chat", () => {
    const older = manuscriptProposal(useProjectStore.getState().blocks, [rewrite("block-1", "Older draft", "Revise")]);
    const newer = { ...manuscriptProposal(useProjectStore.getState().blocks, [rewrite("block-2", "Newer draft", "Revise")]), id: "newer" };
    setPending(older);
    useAgentConsoleStore.getState().stageProposal(newer, { kind: "legacy" });
    acceptAllProposalChanges(older);
    expect(useProjectStore.getState().blocks[0].text).toBe("Older draft");
    expect(useAgentConsoleStore.getState().currentProposalId).toBe("newer");
    expect(useAgentConsoleStore.getState().proposalRecords[0].decisions["change-0"].status).toBe("applied");
    expect(() => acceptAllProposalChanges(older)).toThrow();
    expect(useProjectStore.getState().past).toHaveLength(1);
  });

  it("retains dismissed content and restores it without restoring applied changes", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      rewrite("block-1", "Applied text", "Revise"), rewrite("block-2", "Dismissed text", "Revise"),
    ]);
    setPending(proposal);
    acceptProposalChange(proposal, "change-0");
    rejectProposalChange(proposal, "change-1");
    expect(useAgentConsoleStore.getState().proposalRecords[0].proposal).toEqual(proposal);
    useAgentConsoleStore.getState().restoreProposalChanges(proposal.id, ["change-1"]);
    expect(useAgentConsoleStore.getState().pendingProposal).toMatchObject({ changes: [{ id: "change-1" }] });
    expect(useAgentConsoleStore.getState().proposalRecords[0].decisions["change-0"].status).toBe("applied");
  });

  it("requires explicit source navigation before off-chapter Apply", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [rewrite("block-1", "Draft", "Revise")]);
    setPending(proposal);
    useProjectStore.setState({ activeChapterId: "ch2" });
    expect(proposalRequiresSourceNavigation(proposal)).toBe(true);
    acceptAllProposalChanges(proposal);
    expect(useProjectStore.getState().past).toHaveLength(0);
    expect(useAgentConsoleStore.getState().proposalRecords[0].decisions).toEqual({});
    expect(toast.error).toHaveBeenCalledWith("Open the source chapter before applying this draft");
  });

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

  it("applies outline and overview changes in one reviewed metadata write", () => {
    const proposal = buildOutlinePendingProposal({
      run: runFixture({ kind: "outline-sculpt", chapterId: "ch1" }),
      raw: {
        chapterId: "ch1",
        summary: "Change the turn and stakes",
        changes: [outlineRewrite()],
      },
      cards: initialCards(),
      currentPending: null,
      originatingMessageId: "assistant-1",
      makeId: idFactory(),
      now: "2026-08-04T00:00:00.000Z",
      currentOverview: "Mara arrives.",
      overviewReplacement: "Mara arrives and risks her brother to expose the conspiracy.",
    });
    useProjectStore.setState((state) => ({
      meta: {
        ...state.meta,
        outline: { ...state.meta.outline, overview: "Mara arrives." },
      },
    }));
    setPending(proposal);

    acceptAllProposalChanges(proposal);

    expect(useProjectStore.getState().meta).toMatchObject({
      outline: {
        overview: "Mara arrives and risks her brother to expose the conspiracy.",
      },
      chapters: {
        ch1: { cards: [expect.objectContaining({ title: "Hard arrival" })] },
      },
    });
    expect(writeProjectMeta).toHaveBeenCalledTimes(1);
    expect(useAgentConsoleStore.getState().pendingProposal).toBeNull();
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
    expect(toast.error).toHaveBeenCalledWith("Proposal source changed", expect.objectContaining({ action: expect.objectContaining({ label: "View notification" }) }));
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
    expect(toast.error).toHaveBeenCalledWith("Proposal could not be applied", expect.objectContaining({ action: expect.objectContaining({ label: "View notification" }) }));
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

    acceptAllProposalChanges({ ...callbackProposal, changes: [callbackProposal.changes[1]] });

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

    rejectAllProposalChanges({ ...callbackProposal, changes: [callbackProposal.changes[1]] });

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

  it("leaves off-chapter manuscript source unchecked until explicit navigation", () => {
    const proposal = manuscriptProposal(useProjectStore.getState().blocks, [
      rewrite("block-1", "Rain whispered.", "Quiet the opening"),
      rewrite("block-2", "The door eased open.", "Slow the reveal"),
    ]);
    useProjectStore.setState({ activeChapterId: "ch2" });

    expect(proposalStaleChangeIds(proposal)).toEqual(new Set());
    expect(proposalRequiresSourceNavigation(proposal)).toBe(true);
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

  it("marks only the overview replacement stale when its source changed", () => {
    const proposal = buildOutlinePendingProposal({
      run: runFixture({ kind: "outline-sculpt", chapterId: "ch1" }),
      raw: {
        chapterId: "ch1",
        summary: "Update the overview",
        changes: [outlineRewrite()],
      },
      cards: initialCards(),
      currentPending: null,
      originatingMessageId: "assistant-1",
      makeId: idFactory(),
      now: "2026-08-04T00:00:00.000Z",
      currentOverview: "Before",
      overviewReplacement: "After",
    });
    useProjectStore.setState((state) => ({
      meta: {
        ...state.meta,
        outline: { ...state.meta.outline, overview: "Author edit" },
      },
    }));

    expect(proposalStaleChangeIds(proposal)).toEqual(
      new Set([proposal.overviewChange?.id]),
    );
  });
});
