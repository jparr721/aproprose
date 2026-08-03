import { describe, expect, it } from "vitest";
import {
  blockFingerprint,
  blockOrderFingerprint,
} from "@/lib/ai/agent-context";
import type {
  ManuscriptPendingChange,
  ManuscriptPendingProposal,
  SourceLocator,
} from "@/lib/ai/agent-types";
import {
  projectManuscriptReview,
  type ManuscriptReviewProjection,
} from "@/lib/ai/manuscript-review-projection";
import type { Block, BlockChange } from "@/lib/types";

function block(id: string, text: string): Block {
  return {
    id,
    type: "narration",
    text,
    raw: `${text}\n\n`,
    dirty: false,
  };
}

function locator(blocks: Block[], order: number): SourceLocator {
  const source = blocks[order];
  if (source === undefined) {
    throw new Error(`Missing frozen block at order ${order}.`);
  }
  return {
    sourceId: source.id,
    order,
    fingerprint: blockFingerprint(source),
    sourceType: source.type,
    label: `Narration block ${order + 1}`,
    exactText: source.text,
    previewText: source.text,
  };
}

function rewriteChange(
  id: string,
  blocks: Block[],
  order: number,
  newText: string,
): ManuscriptPendingChange {
  const target = locator(blocks, order);
  const change: BlockChange = {
    kind: "rewrite",
    blockId: target.sourceId,
    afterId: null,
    type: null,
    speaker: null,
    newText,
    toIndex: null,
    reason: "Rewrite the source",
  };
  return { id, change, precondition: { kind: "target", target } };
}

function insertChange(
  id: string,
  blocks: Block[],
  afterOrder: number | null,
  newText: string,
): ManuscriptPendingChange {
  const anchor = afterOrder === null ? null : locator(blocks, afterOrder);
  const expectedNext =
    afterOrder === null || blocks[afterOrder + 1] === undefined
      ? null
      : locator(blocks, afterOrder + 1);
  const change: BlockChange = {
    kind: "insert",
    blockId: null,
    afterId: anchor === null ? null : anchor.sourceId,
    type: "narration",
    speaker: null,
    newText,
    toIndex: null,
    reason: "Insert new prose",
  };
  return {
    id,
    change,
    precondition: {
      kind: "insert",
      boundary: "immediate",
      anchor,
      expectedNext,
    },
  };
}

function removeChange(
  id: string,
  blocks: Block[],
  order: number,
): ManuscriptPendingChange {
  const target = locator(blocks, order);
  const change: BlockChange = {
    kind: "remove",
    blockId: target.sourceId,
    afterId: null,
    type: null,
    speaker: null,
    newText: null,
    toIndex: null,
    reason: "Remove the source",
  };
  return { id, change, precondition: { kind: "target", target } };
}

function moveChange(
  id: string,
  blocks: Block[],
  order: number,
  toIndex: number,
): ManuscriptPendingChange {
  const target = locator(blocks, order);
  const change: BlockChange = {
    kind: "move",
    blockId: target.sourceId,
    afterId: null,
    type: null,
    speaker: null,
    newText: null,
    toIndex,
    reason: "Move the source",
  };
  return {
    id,
    change,
    precondition: {
      kind: "move",
      target,
      orderFingerprint: blockOrderFingerprint(blocks),
    },
  };
}

function proposal(changes: ManuscriptPendingChange[]): ManuscriptPendingProposal {
  return {
    id: "proposal-1",
    kind: "manuscript",
    projectRoot: "/book",
    chapterId: "chapter-1",
    summary: "Review these changes",
    createdAt: "2026-08-01T00:00:00.000Z",
    originatingMessageId: "assistant-1",
    changes,
  };
}

function rowKindsAndKeys(
  projection: ManuscriptReviewProjection,
): Array<[string, string]> {
  return projection.rows.map((row) => [row.kind, row.key]);
}

const threeBlocks = [
  block("a", "Alpha."),
  block("b", "Bravo."),
  block("c", "Charlie."),
];

describe("projectManuscriptReview single changes", () => {
  it("projects one unchanged row for every live block", () => {
    const projection = projectManuscriptReview(threeBlocks, proposal([]));

    expect(rowKindsAndKeys(projection)).toEqual([
      ["unchanged", "review:block:a"],
      ["unchanged", "review:block:b"],
      ["unchanged", "review:block:c"],
    ]);
    expect(projection.rows.map((row) => row.kind === "unchanged" && row.block))
      .toEqual(threeBlocks);
    expect(projection.navigationChangeIds).toEqual([]);
    expect(projection.staleChangeIds).toEqual(new Set<string>());
  });

  it("replaces a fresh rewrite source with its frozen-before decision row", () => {
    const change = rewriteChange("rewrite-1", threeBlocks, 1, "Edited bravo.");
    const projection = projectManuscriptReview(threeBlocks, proposal([change]));

    expect(rowKindsAndKeys(projection)).toEqual([
      ["unchanged", "review:block:a"],
      ["rewrite", "review:change:rewrite-1:rewrite"],
      ["unchanged", "review:block:c"],
    ]);
    const row = projection.rows[1];
    expect(row).toMatchObject({
      kind: "rewrite",
      changeId: "rewrite-1",
      source: threeBlocks[1],
      beforeText: "Bravo.",
    });
    if (row?.kind !== "rewrite") {
      throw new Error("Expected a rewrite row.");
    }
    expect(row.change).toBe(change);
    expect(row.change.change.newText).toBe("Edited bravo.");
    expect(projection.navigationChangeIds).toEqual(["rewrite-1"]);
  });

  it("places a fresh insert immediately after its live anchor", () => {
    const change = insertChange("insert-1", threeBlocks, 0, "Between.");
    const projection = projectManuscriptReview(threeBlocks, proposal([change]));

    expect(rowKindsAndKeys(projection)).toEqual([
      ["unchanged", "review:block:a"],
      ["insert", "review:change:insert-1:insert"],
      ["unchanged", "review:block:b"],
      ["unchanged", "review:block:c"],
    ]);
    expect(projection.rows[1]).toMatchObject({
      kind: "insert",
      changeId: "insert-1",
      afterId: "a",
      change,
    });
    expect(projection.navigationChangeIds).toEqual(["insert-1"]);
  });

  it("places a null-anchor insert at chapter end", () => {
    const change = insertChange("append-1", threeBlocks, null, "Coda.");
    const projection = projectManuscriptReview(threeBlocks, proposal([change]));

    expect(rowKindsAndKeys(projection)).toEqual([
      ["unchanged", "review:block:a"],
      ["unchanged", "review:block:b"],
      ["unchanged", "review:block:c"],
      ["insert", "review:change:append-1:insert"],
    ]);
    expect(projection.rows[3]).toMatchObject({
      kind: "insert",
      afterId: null,
    });
    expect(projection.navigationChangeIds).toEqual(["append-1"]);
  });

  it("replaces a removed source slot with a remove decision row", () => {
    const change = removeChange("remove-1", threeBlocks, 1);
    const projection = projectManuscriptReview(threeBlocks, proposal([change]));

    expect(rowKindsAndKeys(projection)).toEqual([
      ["unchanged", "review:block:a"],
      ["remove", "review:change:remove-1:remove"],
      ["unchanged", "review:block:c"],
    ]);
    expect(projection.rows[1]).toMatchObject({
      kind: "remove",
      source: threeBlocks[1],
      change,
    });
    expect(projection.navigationChangeIds).toEqual(["remove-1"]);
  });

  it("keeps a move source marker and navigates only to its clamped destination", () => {
    const change = moveChange("move-1", threeBlocks, 1, 0);
    const projection = projectManuscriptReview(threeBlocks, proposal([change]));

    expect(rowKindsAndKeys(projection)).toEqual([
      ["move-destination", "review:change:move-1:move-destination"],
      ["unchanged", "review:block:a"],
      ["move-source", "review:change:move-1:move-source"],
      ["unchanged", "review:block:c"],
    ]);
    expect(projection.rows[0]).toMatchObject({
      kind: "move-destination",
      source: threeBlocks[1],
      destinationIndex: 0,
      change,
    });
    expect(projection.rows[2]).toMatchObject({
      kind: "move-source",
      source: threeBlocks[1],
      change,
    });
    expect(projection.navigationChangeIds).toEqual(["move-1"]);
  });
});

describe("projectManuscriptReview stale changes", () => {
  it.each([
    {
      name: "rewrite",
      change: rewriteChange("stale-rewrite", threeBlocks, 1, "Edited."),
      live: [threeBlocks[0], block("b", "Live rewrite."), threeBlocks[2]],
      expectedOrder: 1,
      expectedType: "narration",
      expectedText: "Bravo.",
      expectedRows: [
        ["unchanged", "review:block:a"],
        ["unchanged", "review:block:b"],
        ["stale", "review:change:stale-rewrite:stale"],
        ["unchanged", "review:block:c"],
      ],
    },
    {
      name: "insert",
      change: insertChange("stale-insert", threeBlocks, 0, "Inserted."),
      live: [threeBlocks[0], block("b", "Live successor."), threeBlocks[2]],
      expectedOrder: 0,
      expectedType: "narration",
      expectedText: "Alpha.",
      expectedRows: [
        ["unchanged", "review:block:a"],
        ["stale", "review:change:stale-insert:stale"],
        ["unchanged", "review:block:b"],
        ["unchanged", "review:block:c"],
      ],
    },
    {
      name: "remove",
      change: removeChange("stale-remove", threeBlocks, 1),
      live: [threeBlocks[0], block("b", "Live remove."), threeBlocks[2]],
      expectedOrder: 1,
      expectedType: "narration",
      expectedText: "Bravo.",
      expectedRows: [
        ["unchanged", "review:block:a"],
        ["unchanged", "review:block:b"],
        ["stale", "review:change:stale-remove:stale"],
        ["unchanged", "review:block:c"],
      ],
    },
    {
      name: "move",
      change: moveChange("stale-move", threeBlocks, 1, 0),
      live: [threeBlocks[0], block("b", "Live move."), threeBlocks[2]],
      expectedOrder: 1,
      expectedType: "narration",
      expectedText: "Bravo.",
      expectedRows: [
        ["unchanged", "review:block:a"],
        ["unchanged", "review:block:b"],
        ["stale", "review:change:stale-move:stale"],
        ["unchanged", "review:block:c"],
      ],
    },
  ])(
    "renders a frozen $name warning after its clamped live slot without transforming content",
    ({ change, live, expectedOrder, expectedType, expectedText, expectedRows }) => {
      const projection = projectManuscriptReview(live, proposal([change]));

      expect(rowKindsAndKeys(projection)).toEqual(expectedRows);
      const stale = projection.rows.find((row) => row.kind === "stale");
      expect(stale).toMatchObject({
        kind: "stale",
        changeId: change.id,
        sourceType: expectedType,
        frozenText: expectedText,
        frozenOrder: expectedOrder,
        change,
      });
      expect(
        projection.rows
          .filter((row) => row.kind === "unchanged")
          .map((row) => row.block),
      ).toEqual(live);
      expect(projection.navigationChangeIds).toEqual([change.id]);
      expect(projection.staleChangeIds).toEqual(new Set([change.id]));
    },
  );
});

describe("projectManuscriptReview ordering", () => {
  it("keeps same-anchor inserts in proposal reading order", () => {
    const first = insertChange("insert-1", threeBlocks, 0, "First.");
    const second = insertChange("insert-2", threeBlocks, 0, "Second.");
    const projection = projectManuscriptReview(
      threeBlocks,
      proposal([first, second]),
    );

    expect(rowKindsAndKeys(projection)).toEqual([
      ["unchanged", "review:block:a"],
      ["insert", "review:change:insert-1:insert"],
      ["insert", "review:change:insert-2:insert"],
      ["unchanged", "review:block:b"],
      ["unchanged", "review:block:c"],
    ]);
    expect(projection.navigationChangeIds).toEqual(["insert-1", "insert-2"]);
  });

  it("keeps an insert after the rewritten target", () => {
    const rewrite = rewriteChange("rewrite-1", threeBlocks, 1, "Edited.");
    const insert = insertChange("insert-1", threeBlocks, 1, "After edit.");
    const projection = projectManuscriptReview(
      threeBlocks,
      proposal([rewrite, insert]),
    );

    expect(rowKindsAndKeys(projection)).toEqual([
      ["unchanged", "review:block:a"],
      ["rewrite", "review:change:rewrite-1:rewrite"],
      ["insert", "review:change:insert-1:insert"],
      ["unchanged", "review:block:c"],
    ]);
    expect(projection.navigationChangeIds).toEqual(["rewrite-1", "insert-1"]);
  });

  it("appends an insert whose anchor was removed by an earlier change", () => {
    const remove = removeChange("remove-1", threeBlocks, 1);
    const insert = insertChange("insert-1", threeBlocks, 1, "After removal.");
    const projection = projectManuscriptReview(
      threeBlocks,
      proposal([remove, insert]),
    );

    expect(rowKindsAndKeys(projection)).toEqual([
      ["unchanged", "review:block:a"],
      ["remove", "review:change:remove-1:remove"],
      ["unchanged", "review:block:c"],
      ["insert", "review:change:insert-1:insert"],
    ]);
    expect(projection.navigationChangeIds).toEqual(["remove-1", "insert-1"]);
  });

  it.each([
    {
      name: "index zero",
      toIndex: 0,
      destinationIndex: 0,
      expectedRows: [
        ["move-destination", "review:change:move-1:move-destination"],
        ["unchanged", "review:block:a"],
        ["move-source", "review:change:move-1:move-source"],
        ["unchanged", "review:block:c"],
      ],
    },
    {
      name: "past chapter end",
      toIndex: 99,
      destinationIndex: 2,
      expectedRows: [
        ["unchanged", "review:block:a"],
        ["move-source", "review:change:move-1:move-source"],
        ["unchanged", "review:block:c"],
        ["move-destination", "review:change:move-1:move-destination"],
      ],
    },
  ])(
    "clamps a move destination at $name like proposal application",
    ({ toIndex, destinationIndex, expectedRows }) => {
      const move = moveChange("move-1", threeBlocks, 1, toIndex);
      const projection = projectManuscriptReview(threeBlocks, proposal([move]));

      expect(rowKindsAndKeys(projection)).toEqual(expectedRows);
      expect(
        projection.rows.find((row) => row.kind === "move-destination"),
      ).toMatchObject({ destinationIndex });
    },
  );

  it("folds mixed changes over the evolving virtual content", () => {
    const rewrite = rewriteChange("rewrite-1", threeBlocks, 0, "Edited alpha.");
    const insert = insertChange("insert-1", threeBlocks, 0, "After alpha.");
    const remove = removeChange("remove-1", threeBlocks, 1);
    const move = moveChange("move-1", threeBlocks, 2, 0);
    const projection = projectManuscriptReview(
      threeBlocks,
      proposal([rewrite, insert, remove, move]),
    );

    expect(rowKindsAndKeys(projection)).toEqual([
      ["move-destination", "review:change:move-1:move-destination"],
      ["rewrite", "review:change:rewrite-1:rewrite"],
      ["insert", "review:change:insert-1:insert"],
      ["remove", "review:change:remove-1:remove"],
      ["move-source", "review:change:move-1:move-source"],
    ]);
    expect(projection.navigationChangeIds).toEqual([
      "move-1",
      "rewrite-1",
      "insert-1",
      "remove-1",
    ]);
  });

  it("keeps fresh rows intact when one proposal change is stale", () => {
    const rewrite = rewriteChange("rewrite-1", threeBlocks, 0, "Edited alpha.");
    const staleRemove = removeChange("stale-remove", threeBlocks, 1);
    const insert = insertChange("insert-1", threeBlocks, 2, "After charlie.");
    const live = [threeBlocks[0], block("b", "Live bravo."), threeBlocks[2]];
    const projection = projectManuscriptReview(
      live,
      proposal([rewrite, staleRemove, insert]),
    );

    expect(rowKindsAndKeys(projection)).toEqual([
      ["rewrite", "review:change:rewrite-1:rewrite"],
      ["unchanged", "review:block:b"],
      ["stale", "review:change:stale-remove:stale"],
      ["unchanged", "review:block:c"],
      ["insert", "review:change:insert-1:insert"],
    ]);
    expect(projection.navigationChangeIds).toEqual([
      "rewrite-1",
      "stale-remove",
      "insert-1",
    ]);
    expect(projection.staleChangeIds).toEqual(new Set(["stale-remove"]));
  });

  it("uses proposal materialization to resolve reminted live sources", () => {
    const rewrite = rewriteChange("rewrite-1", threeBlocks, 1, "Edited bravo.");
    const insert = insertChange("insert-1", threeBlocks, 0, "After alpha.");
    const live = [
      { ...threeBlocks[0], id: "live-a" },
      { ...threeBlocks[1], id: "live-b" },
      { ...threeBlocks[2], id: "live-c" },
    ];
    const projection = projectManuscriptReview(
      live,
      proposal([rewrite, insert]),
    );

    expect(rowKindsAndKeys(projection)).toEqual([
      ["unchanged", "review:block:live-a"],
      ["insert", "review:change:insert-1:insert"],
      ["rewrite", "review:change:rewrite-1:rewrite"],
      ["unchanged", "review:block:live-c"],
    ]);
    expect(projection.rows[1]).toMatchObject({ afterId: "live-a" });
    expect(projection.rows[2]).toMatchObject({ source: live[1] });
  });
});

describe("projectManuscriptReview purity", () => {
  it("does not mutate blocks, changes, preconditions, or proposal metadata", () => {
    const changes = [
      rewriteChange("rewrite-1", threeBlocks, 0, "Edited alpha."),
      insertChange("insert-1", threeBlocks, 0, "After alpha."),
      removeChange("remove-1", threeBlocks, 1),
      moveChange("move-1", threeBlocks, 2, 0),
    ];
    const pendingProposal = proposal(changes);
    const blocksBefore = structuredClone(threeBlocks);
    const proposalBefore = structuredClone(pendingProposal);

    projectManuscriptReview(threeBlocks, pendingProposal);

    expect(threeBlocks).toEqual(blocksBefore);
    threeBlocks.forEach((source, index) => {
      expect(source).toEqual(blocksBefore[index]);
    });
    expect(pendingProposal).toEqual(proposalBefore);
    pendingProposal.changes.forEach((change, index) => {
      expect(change).toEqual(proposalBefore.changes[index]);
      expect(change.precondition).toEqual(
        proposalBefore.changes[index]?.precondition,
      );
    });
  });

  it("returns stable view-only keys instead of persisted block IDs", () => {
    const changes = [
      rewriteChange("rewrite-1", threeBlocks, 0, "Edited alpha."),
      insertChange("insert-1", threeBlocks, 0, "After alpha."),
      removeChange("remove-1", threeBlocks, 1),
      moveChange("move-1", threeBlocks, 2, 0),
    ];
    const pendingProposal = proposal(changes);

    const first = projectManuscriptReview(threeBlocks, pendingProposal);
    const second = projectManuscriptReview(threeBlocks, pendingProposal);

    expect(first.rows.map((row) => row.key)).toEqual(
      second.rows.map((row) => row.key),
    );
    for (const row of first.rows) {
      expect(row.key).toMatch(/^review:(block|change):/);
      expect(threeBlocks.some((source) => source.id === row.key)).toBe(false);
      expect("id" in row).toBe(false);
    }
  });
});
