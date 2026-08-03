import { describe, expect, it } from "vitest";
import {
  AgentProposalError,
  buildManuscriptPendingProposal,
  buildOutlinePendingProposal,
  invalidProposalCorrelationIds,
  materializeManuscriptChanges,
  validateManuscriptChanges,
  validateOutlineChanges,
} from "@/lib/ai/agent-proposals";
import type {
  AgentRun,
  ManuscriptPrecondition,
  OutlinePrecondition,
  PendingProposal,
  SourceLocator,
} from "@/lib/ai/agent-types";
import type {
  Block,
  BlockChange,
  Card,
  ManuscriptProposal,
  SculptChange,
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

const locator: SourceLocator = {
  sourceId: "source-1",
  order: 0,
  fingerprint: "source-fingerprint",
  sourceType: "narration",
  label: "Narration block",
  exactText: "Frozen source.",
  previewText: "Frozen source.",
};

describe("proposal change correlation", () => {
  it("audits every manuscript change and precondition pair", () => {
    const changeCases: Array<{
      change: BlockChange;
      expected: ManuscriptPrecondition["kind"];
    }> = [
      {
        change: {
          kind: "rewrite",
          blockId: "source-1",
          afterId: null,
          type: null,
          speaker: null,
          newText: "Rewritten.",
          toIndex: null,
          reason: "Rewrite",
        },
        expected: "target",
      },
      {
        change: insert(null, "Inserted."),
        expected: "insert",
      },
      {
        change: {
          kind: "remove",
          blockId: "source-1",
          afterId: null,
          type: null,
          speaker: null,
          newText: null,
          toIndex: null,
          reason: "Remove",
        },
        expected: "target",
      },
      {
        change: {
          kind: "move",
          blockId: "source-1",
          afterId: null,
          type: null,
          speaker: null,
          newText: null,
          toIndex: 0,
          reason: "Move",
        },
        expected: "move",
      },
    ];
    const preconditions: ManuscriptPrecondition[] = [
      { kind: "target", target: locator },
      {
        kind: "insert",
        boundary: "immediate",
        anchor: null,
        expectedNext: null,
      },
      { kind: "move", target: locator, orderFingerprint: "block-order" },
    ];
    const changes = changeCases.flatMap(({ change, expected }) =>
      preconditions.map((precondition) => ({
        id: `${change.kind}:${precondition.kind}`,
        change,
        precondition,
        expected,
      })),
    );
    const proposal: PendingProposal = {
      id: "proposal-correlation",
      kind: "manuscript",
      projectRoot: "/book",
      chapterId: "ch1",
      summary: "Audit manuscript pairs",
      createdAt: "2026-07-30T00:01:00.000Z",
      originatingMessageId: "assistant-1",
      changes,
    };

    expect(invalidProposalCorrelationIds(proposal)).toEqual(
      changes
        .filter((item) => item.precondition.kind !== item.expected)
        .map((item) => item.id),
    );
  });

  it("audits every outline change and precondition pair", () => {
    const changeCases: Array<{
      change: SculptChange;
      expected: OutlinePrecondition["kind"];
    }> = [
      {
        change: {
          kind: "rewrite",
          cardId: "source-1",
          title: "Rewritten",
          intention: null,
          toIndex: null,
          reason: "Rewrite",
        },
        expected: "card",
      },
      {
        change: {
          kind: "add",
          cardId: null,
          title: "Added",
          intention: "Escalate",
          toIndex: null,
          reason: "Add",
        },
        expected: "outline-order",
      },
      {
        change: {
          kind: "move",
          cardId: "source-1",
          title: null,
          intention: null,
          toIndex: 0,
          reason: "Move",
        },
        expected: "outline-move",
      },
      {
        change: {
          kind: "remove",
          cardId: "source-1",
          title: null,
          intention: null,
          toIndex: null,
          reason: "Remove",
        },
        expected: "card",
      },
    ];
    const preconditions: OutlinePrecondition[] = [
      { kind: "card", target: locator },
      { kind: "outline-order", orderFingerprint: "outline-order" },
      {
        kind: "outline-move",
        target: locator,
        orderFingerprint: "outline-order",
      },
    ];
    const changes = changeCases.flatMap(({ change, expected }) =>
      preconditions.map((precondition) => ({
        id: `${change.kind}:${precondition.kind}`,
        change,
        precondition,
        expected,
      })),
    );
    const proposal: PendingProposal = {
      id: "proposal-correlation",
      kind: "outline",
      projectRoot: "/book",
      chapterId: "ch1",
      summary: "Audit outline pairs",
      createdAt: "2026-07-30T00:01:00.000Z",
      originatingMessageId: "assistant-1",
      changes,
    };

    expect(invalidProposalCorrelationIds(proposal)).toEqual(
      changes
        .filter((item) => item.precondition.kind !== item.expected)
        .map((item) => item.id),
    );
  });
});

describe("proposal task boundaries", () => {
  it("rejects duplicate manuscript targets before creating pending changes", () => {
    const rewrite: BlockChange = {
      kind: "rewrite",
      blockId: "a",
      afterId: null,
      type: null,
      speaker: null,
      newText: "Revised once.",
      toIndex: null,
      reason: "Tighten",
    };
    const remove: BlockChange = {
      ...rewrite,
      kind: "remove",
      newText: null,
      reason: "Remove instead",
    };

    expect(() =>
      buildManuscript(
        { kind: "conversation", targetChapterId: "ch1" },
        [rewrite, remove],
        [block("a", "Original.")],
      ),
    ).toThrow(/same manuscript source/);
  });

  it("rejects a malformed outline add before creating a pending proposal", () => {
    const raw: SculptProposal = {
      chapterId: "ch1",
      summary: "Add a turn",
      changes: [
        {
          kind: "add",
          cardId: "legacy-card-id",
          title: "The turn",
          intention: "Force the choice",
          toIndex: null,
          reason: "Complete the arc",
        },
      ],
    };

    expect(() =>
      buildOutlinePendingProposal({
        run: run({ kind: "outline-sculpt", chapterId: "ch1" }),
        raw,
        cards,
        currentPending: null,
        originatingMessageId: "assistant-1",
        makeId: () => "generated-id",
        now: "2026-07-30T00:01:00.000Z",
      }),
    ).toThrow(/invalid outline change/);
  });

  it("rejects duplicate outline targets before creating a pending proposal", () => {
    const raw: SculptProposal = {
      chapterId: "ch1",
      summary: "Conflicting card changes",
      changes: [
        {
          kind: "rewrite",
          cardId: "c1",
          title: "Hard arrival",
          intention: null,
          toIndex: null,
          reason: "Raise stakes",
        },
        {
          kind: "remove",
          cardId: "c1",
          title: null,
          intention: null,
          toIndex: null,
          reason: "Remove instead",
        },
      ],
    };

    expect(() =>
      buildOutlinePendingProposal({
        run: run({ kind: "outline-sculpt", chapterId: "ch1" }),
        raw,
        cards,
        currentPending: null,
        originatingMessageId: "assistant-1",
        makeId: () => "generated-id",
        now: "2026-07-30T00:01:00.000Z",
      }),
    ).toThrow(/same outline card/);
  });

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
  it("separates mutable locator text from complete frozen manuscript previews", () => {
    const dialogue: Block = {
      id: "dialogue-1",
      type: "dialogue",
      text: "The bell rang hard.",
      raw: "The bell rang hard.\n",
      dirty: false,
      tail: [
        { kind: "beat", text: "She gripped the rope." },
        { kind: "quote", text: "We leave now." },
      ],
    };
    const lore: Block = {
      id: "lore-1",
      type: "lore",
      title: "Harbor law",
      text: "The tide was mild.",
      raw: "% lore\n",
      dirty: false,
    };
    const remove = (source: Block): BlockChange => ({
      kind: "remove",
      blockId: source.id,
      afterId: null,
      type: null,
      speaker: null,
      newText: null,
      toIndex: null,
      reason: "Remove the source",
    });
    const proposal = buildManuscript(
      { kind: "conversation", targetChapterId: "ch1" },
      [remove(dialogue), remove(lore)],
      [dialogue, lore],
    );
    const targets = proposal.changes.map((item) => {
      if (item.precondition.kind !== "target") {
        throw new Error("Expected target precondition.");
      }
      return item.precondition.target;
    });

    expect(targets[0]).toMatchObject({
      exactText: "The bell rang hard.",
      previewText: "The bell rang hard.\nShe gripped the rope.\nWe leave now.",
    });
    expect(targets[1]).toMatchObject({
      exactText: "The tide was mild.",
      previewText: "Harbor law\nThe tide was mild.",
    });
    expect(
      validateManuscriptChanges(proposal, [
        {
          ...dialogue,
          tail: [{ kind: "beat", text: "She released the rope." }],
        },
        { ...lore, title: "Revised law" },
      ]),
    ).toEqual([
      { changeId: "generated-id", reason: "target-changed" },
      { changeId: "generated-id", reason: "target-changed" },
    ]);
  });

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

  it("keeps ordinary insert boundaries immediate while bridges skip non-prose", () => {
    const frozen = [block("a", "Left."), block("b", "Right.")];
    const changed = [
      block("a", "Left."),
      scratchpad("note", "Inserted note."),
      block("b", "Right."),
    ];
    const ordinary = buildManuscript(
      { kind: "conversation", targetChapterId: "ch1" },
      [insert("a", "Ordinary insertion.")],
      frozen,
    );
    const bridge = buildManuscript(
      {
        kind: "bridge",
        chapterId: "ch1",
        anchorBlockId: "a",
        successorBlockId: "b",
      },
      [insert("a", "Bridge insertion.")],
      frozen,
    );

    expect(ordinary.changes[0].precondition).toMatchObject({
      kind: "insert",
      boundary: "immediate",
      expectedNext: { sourceId: "b" },
    });
    expect(bridge.changes[0].precondition).toMatchObject({
      kind: "insert",
      boundary: "next-prose",
      expectedNext: { sourceId: "b" },
    });
    expect(validateManuscriptChanges(ordinary, changed)).toEqual([
      { changeId: "generated-id", reason: "successor-changed" },
    ]);
    expect(validateManuscriptChanges(bridge, changed)).toEqual([]);
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
