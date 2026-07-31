import { describe, expect, it } from "vitest";
import {
  blockFingerprint,
  blockOrderFingerprint,
  cardFingerprint,
  contextSnapshotToSourcePart,
  findBridgeSuccessor,
  resolveDraftSnapshots,
  resolveSnapshotBlock,
} from "@/lib/ai/agent-context";
import type {
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
});
