import { describe, expect, it } from "vitest";
import {
  blockFingerprint,
  blockOrderFingerprint,
  cardFingerprint,
  contextSnapshotToSourcePart,
  findBridgeSuccessor,
  flattenMessageFindings,
  resolveDraftSnapshots,
  resolveSnapshotBlock,
} from "@/lib/ai/agent-context";
import type {
  AgentUIMessage,
  ContextSourceResolver,
  DraftContextRef,
} from "@/lib/ai/agent-types";
import type { Block, Card } from "@/lib/types";

const prose = (id: string, text: string): Block => ({
  id,
  type: "narration",
  text,
  raw: "ignored source",
  dirty: false,
});

const card: Card = {
  id: "card-1",
  title: "Door opens",
  intention: "Force the choice",
  characterIds: [],
  loreIds: [],
  continuityFlags: [],
};

describe("agent source fingerprints", () => {
  it("tracks semantic block content but ignores raw and dirty transport fields", () => {
    const first = prose("b1", "Rain fell.");
    expect(blockFingerprint(first)).toBe(
      blockFingerprint({ ...first, raw: "different", dirty: true }),
    );
    expect(blockFingerprint(first)).toBe(
      blockFingerprint({ ...first, id: "reminted-id" }),
    );
    expect(blockFingerprint(first)).not.toBe(
      blockFingerprint({ ...first, text: "Rain stopped." }),
    );
  });

  it("tracks card content and complete block ordering", () => {
    expect(cardFingerprint(card)).not.toBe(
      cardFingerprint({ ...card, intention: "Delay the choice" }),
    );
    expect(blockOrderFingerprint([prose("a", "A"), prose("b", "B")])).not.toBe(
      blockOrderFingerprint([prose("b", "B"), prose("a", "A")]),
    );
  });
});

describe("flattenMessageFindings", () => {
  it("assigns message-wide IDs across multiple findings parts", () => {
    const message: AgentUIMessage = {
      id: "assistant-findings",
      role: "assistant",
      metadata: {
        runId: "run-1",
        mode: "writing",
        task: { kind: "conversation", targetChapterId: "ch1" },
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
            items: [
              {
                kind: "watch",
                tag: "Pacing",
                text: "The middle stalls.",
                blockIds: ["b2"],
              },
            ],
          },
        },
        { type: "text", text: "A short note." },
        {
          type: "data-findings",
          data: {
            kind: "continuity",
            chapterId: "ch2",
            items: [
              {
                severity: "warning",
                tag: "Timeline",
                text: "The hour changed.",
                blockIds: ["b8"],
              },
              {
                severity: "info",
                tag: "Setting",
                text: "The door remains locked.",
                blockIds: [],
              },
            ],
          },
        },
      ],
    };

    expect(
      flattenMessageFindings(message).map((entry) => ({
        id: entry.id,
        partIndex: entry.partIndex,
        chapterId: entry.chapterId,
        tag: entry.finding.tag,
      })),
    ).toEqual([
      {
        id: "assistant-findings:0",
        partIndex: 0,
        chapterId: "ch1",
        tag: "Pacing",
      },
      {
        id: "assistant-findings:1",
        partIndex: 2,
        chapterId: "ch2",
        tag: "Timeline",
      },
      {
        id: "assistant-findings:2",
        partIndex: 2,
        chapterId: "ch2",
        tag: "Setting",
      },
    ]);
  });
});

describe("findBridgeSuccessor", () => {
  it("returns the next prose block after a middle anchor", () => {
    const blocks: Block[] = [
      prose("a", "A"),
      { ...prose("note", "Private"), type: "scratchpad" },
      prose("b", "B"),
    ];
    expect(findBridgeSuccessor(blocks, "a")).toBe("b");
  });

  it("returns null for the final prose block", () => {
    expect(findBridgeSuccessor([prose("a", "A")], "a")).toBeNull();
  });
});

describe("resolveDraftSnapshots", () => {
  it("freezes exact live text and maps it to a source-document attachment", () => {
    let live = prose("b1", "First version.");
    const resolver: ContextSourceResolver = {
      resolveBlock: () => ({ chapterId: "ch1", order: 2, block: live }),
      resolveOutlineCard: () => null,
      resolveFinding: () => null,
    };
    const refs: DraftContextRef[] = [
      { kind: "block", chapterId: "ch1", blockId: "b1" },
    ];

    live = { ...live, text: "Edited before send." };
    const [snapshot] = resolveDraftSnapshots(
      refs,
      {},
      resolver,
      () => "snapshot-1",
    );
    live = { ...live, text: "Edited after send." };

    expect(snapshot.exactText).toBe("Edited before send.");
    expect(snapshot.order).toBe(2);
    expect(contextSnapshotToSourcePart(snapshot)).toEqual({
      id: "snapshot-1",
      type: "source-document",
      sourceId: "b1",
      mediaType: "text/plain",
      title: "Narration block",
      filename: "Chapter ch1",
    });
  });

  it("resolves a sent snapshot by fingerprint and order after block ids remint", () => {
    const oldBlock = prose("old-id", "Same prose.");
    const resolver: ContextSourceResolver = {
      resolveBlock: () => ({ chapterId: "ch1", order: 0, block: oldBlock }),
      resolveOutlineCard: () => null,
      resolveFinding: () => null,
    };
    const [snapshot] = resolveDraftSnapshots(
      [{ kind: "block", chapterId: "ch1", blockId: "old-id" }],
      {},
      resolver,
      () => "snapshot-1",
    );
    expect(resolveSnapshotBlock(snapshot, [prose("new-id", "Same prose.")])?.id).toBe(
      "new-id",
    );
  });

  it("resolves an exact sent block id after its live text changes", () => {
    const frozen = prose("stable-id", "Original prose.");
    const live = prose("stable-id", "Revised live prose.");
    const resolver: ContextSourceResolver = {
      resolveBlock: () => ({ chapterId: "ch1", order: 0, block: frozen }),
      resolveOutlineCard: () => null,
      resolveFinding: () => null,
    };
    const [snapshot] = resolveDraftSnapshots(
      [{ kind: "block", chapterId: "ch1", blockId: frozen.id }],
      {},
      resolver,
      () => "snapshot-1",
    );

    expect(resolveSnapshotBlock(snapshot, [live])).toBe(live);
    expect(snapshot.exactText).toBe("Original prose.");
  });

  it("freezes every dialogue segment in authored order", () => {
    const dialogue: Block = {
      id: "dialogue-1",
      type: "dialogue",
      text: "You came back.",
      raw: "ignored dialogue source",
      dirty: false,
      speaker: "mara",
      tail: [
        { kind: "beat", text: "She closed the door." },
        { kind: "quote", text: "I had to." },
      ],
    };
    const resolver: ContextSourceResolver = {
      resolveBlock: () => ({ chapterId: "ch1", order: 0, block: dialogue }),
      resolveOutlineCard: () => null,
      resolveFinding: () => null,
    };

    const [snapshot] = resolveDraftSnapshots(
      [{ kind: "block", chapterId: "ch1", blockId: "dialogue-1" }],
      {},
      resolver,
      () => "snapshot-dialogue",
    );

    expect(snapshot.exactText).toBe(
      "You came back.\nShe closed the door.\nI had to.",
    );
  });

  it("freezes a titled block with its title before its body", () => {
    const lore: Block = {
      id: "lore-1",
      type: "lore",
      title: "The sealed door",
      text: "No one has opened it.",
      raw: "ignored lore source",
      dirty: false,
    };
    const resolver: ContextSourceResolver = {
      resolveBlock: () => ({ chapterId: "ch1", order: 1, block: lore }),
      resolveOutlineCard: () => null,
      resolveFinding: () => null,
    };

    const [snapshot] = resolveDraftSnapshots(
      [{ kind: "block", chapterId: "ch1", blockId: "lore-1" }],
      {},
      resolver,
      () => "snapshot-lore",
    );

    expect(snapshot.exactText).toBe(
      "The sealed door\nNo one has opened it.",
    );
  });

  it("freezes outline title and intention without normalizing boundary whitespace", () => {
    const spacedCard: Card = {
      ...card,
      title: "  Door opens ",
      intention: " Force the choice  ",
    };
    const resolver: ContextSourceResolver = {
      resolveBlock: () => null,
      resolveOutlineCard: () => ({
        chapterId: "ch1",
        order: 0,
        card: spacedCard,
      }),
      resolveFinding: () => null,
    };

    const [snapshot] = resolveDraftSnapshots(
      [{ kind: "outline-card", chapterId: "ch1", cardId: "card-1" }],
      {},
      resolver,
      () => "snapshot-outline",
    );

    expect(snapshot.exactText).toBe("  Door opens \n Force the choice  ");
  });
});
