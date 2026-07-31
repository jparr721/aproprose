import { describe, expect, it } from "vitest";
import {
  AgentProposalError,
  buildManuscriptPendingProposal,
  buildOutlinePendingProposal,
  materializeManuscriptChanges,
  validateManuscriptChanges,
  validateOutlineChanges,
} from "@/lib/ai/agent-proposals";
import type { AgentRun, PendingProposal } from "@/lib/ai/agent-types";
import type {
  Block,
  BlockChange,
  Card,
  ManuscriptProposal,
  SculptProposal,
} from "@/lib/types";

const block = (id: string, text: string): Block => ({
  id,
  type: "narration",
  text,
  raw: "",
  dirty: false,
});

const scratchpad = (id: string, text: string): Block => ({
  ...block(id, text),
  type: "scratchpad",
});

const insert = (afterId: string | null, text: string): BlockChange => ({
  kind: "insert",
  blockId: null,
  afterId,
  type: "narration",
  speaker: null,
  newText: text,
  toIndex: null,
  reason: "bridge",
});

const run = (task: AgentRun["task"]): AgentRun => ({
  id: "run-1",
  projectRoot: "/book",
  mode: "writing",
  task,
  userMessageId: "user-1",
  attachments: [],
  startedAt: "2026-07-30T00:00:00.000Z",
});

const manuscript = (changes: BlockChange[]): ManuscriptProposal => ({
  chapterId: "ch1",
  summary: "Proposal",
  changes,
});

const cards: Card[] = [
  {
    id: "c1",
    title: "Arrival",
    intention: "Set the stakes",
    characterIds: [],
    loreIds: [],
    continuityFlags: [],
  },
];

const buildManuscript = (
  task: AgentRun["task"],
  changes: BlockChange[],
  blocks: Block[],
) =>
  buildManuscriptPendingProposal({
    run: run(task),
    raw: manuscript(changes),
    blocks,
    currentPending: null,
    originatingMessageId: "assistant-1",
    makeId: () => "generated-id",
    now: "2026-07-30T00:01:00.000Z",
  });

describe("proposal task boundaries", () => {
  it("allows a bridge insert only after the frozen anchor", () => {
    const proposal = buildManuscript(
      {
        kind: "bridge",
        chapterId: "ch1",
        anchorBlockId: "a",
        successorBlockId: "b",
      },
      [insert("a", "New bridge.")],
      [block("a", "Left."), block("b", "Right.")],
    );
    expect(proposal.changes).toHaveLength(1);
    expect(proposal.changes[0].precondition).toMatchObject({
      kind: "insert",
      expectedNext: { sourceId: "b" },
    });
  });

  it("rejects bridge rewrites and inserts outside the boundary", () => {
    const rewrite: BlockChange = {
      ...insert(null, "Changed."),
      kind: "rewrite",
      blockId: "a",
      afterId: null,
    };
    expect(() =>
      buildManuscript(
        {
          kind: "bridge",
          chapterId: "ch1",
          anchorBlockId: "a",
          successorBlockId: "b",
        },
        [rewrite, insert("b", "Too late.")],
        [block("a", "Left."), block("b", "Right.")],
      ),
    ).toThrow(AgentProposalError);
  });

  it("rejects writes from a chapter-analysis task", () => {
    expect(() =>
      buildManuscript(
        { kind: "chapter-analysis", chapterId: "ch1", analysis: "critique" },
        [insert("a", "No.")],
        [block("a", "Left.")],
      ),
    ).toThrow(/read-only/);
  });

  it("rejects an empty manuscript proposal from a read-only task", () => {
    expect(() =>
      buildManuscript(
        { kind: "chapter-analysis", chapterId: "ch1", analysis: "critique" },
        [],
        [block("a", "Left.")],
      ),
    ).toThrow(/read-only/);
  });

  it("confines selected-block edits to the frozen target ids", () => {
    const rewrite: BlockChange = {
      ...insert(null, "Changed."),
      kind: "rewrite",
      blockId: "b",
      afterId: null,
    };
    expect(() =>
      buildManuscript(
        {
          kind: "selected-block-edit",
          chapterId: "ch1",
          blockIds: ["a"],
          operation: "custom",
        },
        [rewrite],
        [block("a", "A"), block("b", "B")],
      ),
    ).toThrow(/outside the frozen block selection/);
  });

  it("allows outline writes only for an outline-sculpt task", () => {
    const raw: SculptProposal = {
      chapterId: "ch1",
      summary: "Tighten",
      changes: [
        {
          kind: "rewrite",
          cardId: "c1",
          title: "A harder arrival",
          intention: null,
          toIndex: null,
          reason: "Raise stakes",
        },
      ],
    };
    const proposal = buildOutlinePendingProposal({
      run: run({ kind: "outline-sculpt", chapterId: "ch1" }),
      raw,
      cards,
      currentPending: null,
      originatingMessageId: "assistant-1",
      makeId: () => "generated-id",
      now: "2026-07-30T00:01:00.000Z",
    });
    expect(proposal.kind).toBe("outline");
  });
});

describe("proposal preconditions", () => {
  it("marks changed text and changed insert successors stale", () => {
    const proposal = buildManuscript(
      {
        kind: "bridge",
        chapterId: "ch1",
        anchorBlockId: "a",
        successorBlockId: "b",
      },
      [insert("a", "New bridge.")],
      [block("a", "Left."), block("b", "Right.")],
    );
    expect(
      validateManuscriptChanges(proposal, [block("a", "Edited."), block("b", "Right.")]),
    ).toEqual([{ changeId: "generated-id", reason: "anchor-changed" }]);
    expect(
      validateManuscriptChanges(proposal, [block("a", "Left."), block("x", "New.")]),
    ).toEqual([{ changeId: "generated-id", reason: "successor-changed" }]);
  });

  it("marks a changed frozen prose successor stale across a scratchpad", () => {
    const proposal = buildManuscript(
      {
        kind: "bridge",
        chapterId: "ch1",
        anchorBlockId: "a",
        successorBlockId: "b",
      },
      [insert("a", "New bridge.")],
      [block("a", "Left."), scratchpad("note", "Keep."), block("b", "Right.")],
    );
    expect(proposal.changes[0].precondition).toMatchObject({
      kind: "insert",
      expectedNext: { sourceId: "b" },
    });
    expect(
      validateManuscriptChanges(proposal, [
        block("a", "Left."),
        scratchpad("note", "Keep."),
        block("b", "Edited."),
      ]),
    ).toEqual([{ changeId: "generated-id", reason: "successor-changed" }]);
  });

  it("marks a deleted frozen prose successor stale across a scratchpad", () => {
    const proposal = buildManuscript(
      {
        kind: "bridge",
        chapterId: "ch1",
        anchorBlockId: "a",
        successorBlockId: "b",
      },
      [insert("a", "New bridge.")],
      [block("a", "Left."), scratchpad("note", "Keep."), block("b", "Right.")],
    );
    expect(
      validateManuscriptChanges(proposal, [
        block("a", "Left."),
        scratchpad("note", "Keep."),
      ]),
    ).toEqual([{ changeId: "generated-id", reason: "successor-changed" }]);
  });

  it("resolves a reminted target id by frozen order and fingerprint", () => {
    const rewrite: BlockChange = {
      ...insert(null, "New text."),
      kind: "rewrite",
      blockId: "old-id",
      afterId: null,
    };
    const proposal = buildManuscript(
      { kind: "conversation", targetChapterId: "ch1" },
      [rewrite],
      [block("old-id", "Old text.")],
    );
    expect(
      materializeManuscriptChanges(proposal, ["generated-id"], [
        block("new-id", "Old text."),
      ])[0].blockId,
    ).toBe("new-id");
  });

  it("does not remap a changed original target to an ordinal match", () => {
    const rewrite: BlockChange = {
      ...insert(null, "New text."),
      kind: "rewrite",
      blockId: "old-id",
      afterId: null,
    };
    const proposal = buildManuscript(
      { kind: "conversation", targetChapterId: "ch1" },
      [rewrite],
      [block("old-id", "Old text.")],
    );
    const liveBlocks = [
      block("ordinal-match", "Old text."),
      block("old-id", "Changed by the author."),
    ];
    expect(validateManuscriptChanges(proposal, liveBlocks)).toEqual([
      { changeId: "generated-id", reason: "target-changed" },
    ]);
    expect(() =>
      materializeManuscriptChanges(proposal, ["generated-id"], liveBlocks),
    ).toThrow(/preconditions failed/);
  });

  it("does not remap a changed frozen successor to an ordinal match", () => {
    const proposal = buildManuscript(
      {
        kind: "bridge",
        chapterId: "ch1",
        anchorBlockId: "a",
        successorBlockId: "b",
      },
      [insert("a", "New bridge.")],
      [block("a", "Left."), block("b", "Right.")],
    );
    expect(
      validateManuscriptChanges(proposal, [
        block("a", "Left."),
        block("ordinal-match", "Right."),
        block("b", "Changed by the author."),
      ]),
    ).toEqual([{ changeId: "generated-id", reason: "successor-changed" }]);
  });

  it("marks changed outline ordering stale", () => {
    const raw: SculptProposal = {
      chapterId: "ch1",
      summary: "Move",
      changes: [
        {
          kind: "move",
          cardId: "c1",
          title: null,
          intention: null,
          toIndex: 0,
          reason: "Reorder",
        },
      ],
    };
    const proposal = buildOutlinePendingProposal({
      run: run({ kind: "outline-sculpt", chapterId: "ch1" }),
      raw,
      cards,
      currentPending: null,
      originatingMessageId: "assistant-1",
      makeId: () => "generated-id",
      now: "2026-07-30T00:01:00.000Z",
    });
    expect(validateOutlineChanges(proposal, [...cards, { ...cards[0], id: "c2" }]))
      .toEqual([{ changeId: "generated-id", reason: "outline-order-changed" }]);
  });

  it("requires proposal follow-up to replace the identified workspace", () => {
    const current = buildManuscript(
      { kind: "conversation", targetChapterId: "ch1" },
      [insert("a", "First.")],
      [block("a", "A")],
    );
    expect(() =>
      buildManuscriptPendingProposal({
        run: run({ kind: "proposal-follow-up", proposalId: "wrong-id" }),
        raw: manuscript([insert("a", "Replacement.")]),
        blocks: [block("a", "A")],
        currentPending: current as PendingProposal,
        originatingMessageId: "assistant-2",
        makeId: () => "replacement-id",
        now: "2026-07-30T00:02:00.000Z",
      }),
    ).toThrow(/pending proposal does not match/);
  });

  it("rejects a mismatched follow-up when every change sanitizes away", () => {
    const current = buildManuscript(
      { kind: "conversation", targetChapterId: "ch1" },
      [insert("a", "First.")],
      [block("a", "A")],
    );
    expect(() =>
      buildManuscriptPendingProposal({
        run: run({ kind: "proposal-follow-up", proposalId: "wrong-id" }),
        raw: manuscript([insert("a", " ")]),
        blocks: [block("a", "A")],
        currentPending: current as PendingProposal,
        originatingMessageId: "assistant-2",
        makeId: () => "replacement-id",
        now: "2026-07-30T00:02:00.000Z",
      }),
    ).toThrow(/pending proposal does not match/);
  });
});
