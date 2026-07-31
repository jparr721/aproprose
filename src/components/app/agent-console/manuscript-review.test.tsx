// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManuscriptReview } from "@/components/app/agent-console/manuscript-review";
import {
  blockFingerprint,
  blockOrderFingerprint,
} from "@/lib/ai/agent-context";
import type {
  ManuscriptPendingChange,
  ManuscriptPendingProposal,
  SourceLocator,
} from "@/lib/ai/agent-types";
import type { Block } from "@/lib/types";
import { useProjectStore } from "@/stores/project-store";

const block = (id: string, text: string): Block => ({
  id,
  type: "narration",
  text,
  raw: `${text}\n`,
  dirty: false,
});

const frozenBlocks = [
  block("block-1", "The rain fell hard."),
  block("block-2", "The door opened."),
  block("block-3", "She hid the letter."),
];

const locator = (
  source: Block,
  order: number,
): SourceLocator => ({
  sourceId: source.id,
  order,
  fingerprint: blockFingerprint(source),
  sourceType: "narration",
  label: "narration block",
  exactText: source.text,
});

const changes: ManuscriptPendingChange[] = [
  {
    id: "rewrite-1",
    change: {
      kind: "rewrite",
      blockId: "block-1",
      afterId: null,
      type: null,
      speaker: null,
      newText: "The rain fell softly.",
      toIndex: null,
      reason: "Quiet the opening",
    },
    precondition: {
      kind: "target",
      target: locator(frozenBlocks[0], 0),
    },
  },
  {
    id: "insert-1",
    change: {
      kind: "insert",
      blockId: null,
      afterId: "block-1",
      type: "narration",
      speaker: null,
      newText: "A gull crossed the harbor.",
      toIndex: null,
      reason: "Bridge the image",
    },
    precondition: {
      kind: "insert",
      anchor: locator(frozenBlocks[0], 0),
      expectedNext: locator(frozenBlocks[1], 1),
    },
  },
  {
    id: "remove-1",
    change: {
      kind: "remove",
      blockId: "block-2",
      afterId: null,
      type: null,
      speaker: null,
      newText: null,
      toIndex: null,
      reason: "Remove repetition",
    },
    precondition: {
      kind: "target",
      target: locator(frozenBlocks[1], 1),
    },
  },
  {
    id: "move-1",
    change: {
      kind: "move",
      blockId: "block-3",
      afterId: null,
      type: null,
      speaker: null,
      newText: null,
      toIndex: 1,
      reason: "Reveal this earlier",
    },
    precondition: {
      kind: "move",
      target: locator(frozenBlocks[2], 2),
      orderFingerprint: blockOrderFingerprint(frozenBlocks),
    },
  },
];

const proposal: ManuscriptPendingProposal = {
  id: "proposal-1",
  kind: "manuscript",
  projectRoot: "/book",
  chapterId: "ch1",
  summary: "Tighten the opening",
  createdAt: "2026-07-30T00:00:00.000Z",
  originatingMessageId: "assistant-1",
  changes,
};

beforeEach(() => {
  useProjectStore.setState({
    project: {
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
          wordCount: 12,
        },
      ],
    },
    activeChapterId: "ch1",
    blocks: frozenBlocks.map((item) => ({ ...item })),
  } as never);
});

afterEach(() => cleanup());

describe("ManuscriptReview", () => {
  it("renders every change from live source and destination context", () => {
    const { container } = render(
      <ManuscriptReview
        proposal={proposal}
        staleChangeIds={new Set<string>()}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    const rewrite = container.querySelector('[data-agent-change-id="rewrite-1"]');
    const insert = container.querySelector('[data-agent-change-id="insert-1"]');
    const remove = container.querySelector('[data-agent-change-id="remove-1"]');
    const move = container.querySelector('[data-agent-change-id="move-1"]');
    if (
      !(rewrite instanceof HTMLElement) ||
      !(insert instanceof HTMLElement) ||
      !(remove instanceof HTMLElement) ||
      !(move instanceof HTMLElement)
    ) {
      throw new Error("Expected every manuscript review card.");
    }

    expect(within(rewrite).getByText("hard.").tagName).toBe("DEL");
    expect(within(rewrite).getByText("softly.").tagName).toBe("INS");
    expect(within(rewrite).getByText("Narration block 1")).toBeTruthy();
    expect(within(insert).getAllByText("After Narration block 1")).toHaveLength(2);
    expect(within(insert).getByText("Before Narration block 2")).toBeTruthy();
    expect(within(insert).getByText("The rain fell hard.")).toBeTruthy();
    expect(within(insert).getByText("The door opened.")).toBeTruthy();
    expect(within(insert).getByText("A gull crossed the harbor.")).toBeTruthy();
    expect(within(remove).getByText("The door opened.")).toBeTruthy();
    expect(within(move).getByText("She hid the letter.")).toBeTruthy();
    expect(within(move).getByText("Before Narration block 2")).toBeTruthy();
    expect(within(move).getByText("The door opened.")).toBeTruthy();

    for (const card of [rewrite, insert, remove, move]) {
      expect(card.querySelector('[data-slot="card-header"]')).toBeTruthy();
      expect(card.querySelector('[data-slot="card-title"]')).toBeTruthy();
      expect(card.querySelector('[data-slot="card-content"]')).toBeTruthy();
      expect(card.querySelector('[data-slot="card-action"]')).toBeTruthy();
    }
  });

  it("renders reason and all actions for every change", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const onNavigate = vi.fn();
    const { container } = render(
      <ManuscriptReview
        proposal={proposal}
        staleChangeIds={new Set<string>()}
        onAccept={onAccept}
        onReject={onReject}
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getAllByText("Reason")).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: "Reject" })).toHaveLength(4);
    expect(
      screen.getAllByRole("button", { name: "Read in context" }),
    ).toHaveLength(4);

    const card = container.querySelector('[data-agent-change-id="insert-1"]');
    if (!(card instanceof HTMLElement)) throw new Error("Missing insert card.");
    fireEvent.click(within(card).getByRole("button", { name: "Accept" }));
    fireEvent.click(within(card).getByRole("button", { name: "Reject" }));
    fireEvent.click(
      within(card).getByRole("button", { name: "Read in context" }),
    );
    expect(onAccept).toHaveBeenCalledWith("insert-1");
    expect(onReject).toHaveBeenCalledWith("insert-1");
    expect(onNavigate).toHaveBeenCalledWith("insert-1");
  });

  it("keeps a stale frozen preview visible and disables only its Accept action", () => {
    useProjectStore.setState({
      blocks: [
        frozenBlocks[0],
        { ...frozenBlocks[1], text: "The changed live door slammed." },
        frozenBlocks[2],
      ],
    });
    const { container } = render(
      <ManuscriptReview
        proposal={proposal}
        staleChangeIds={new Set(["remove-1"])}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    const stale = container.querySelector('[data-agent-change-id="remove-1"]');
    const fresh = container.querySelector('[data-agent-change-id="rewrite-1"]');
    if (!(stale instanceof HTMLElement) || !(fresh instanceof HTMLElement)) {
      throw new Error("Missing review cards.");
    }

    expect(within(stale).getByText("Source changed - regenerate")).toBeTruthy();
    expect(within(stale).getByText("The door opened.")).toBeTruthy();
    expect(within(stale).queryByText("The changed live door slammed.")).toBeNull();
    expect(
      within(stale).getByRole("button", { name: "Accept" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      within(fresh).getByRole("button", { name: "Accept" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("updates a fresh target label and move destination from live ordering", () => {
    const liveDestination = block("live-destination", "The lantern went dark.");
    const liveBlocks = [
      frozenBlocks[1],
      liveDestination,
      frozenBlocks[0],
      frozenBlocks[2],
    ];
    useProjectStore.setState({ blocks: liveBlocks });
    const liveMove: ManuscriptPendingChange = {
      ...changes[3],
      precondition: {
        kind: "move",
        target: locator(frozenBlocks[2], 3),
        orderFingerprint: blockOrderFingerprint(liveBlocks),
      },
    };
    const liveProposal: ManuscriptPendingProposal = {
      ...proposal,
      changes: [changes[0], liveMove],
    };

    const { container } = render(
      <ManuscriptReview
        proposal={liveProposal}
        staleChangeIds={new Set<string>()}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    const rewrite = container.querySelector('[data-agent-change-id="rewrite-1"]');
    const moveCard = container.querySelector('[data-agent-change-id="move-1"]');
    if (!(rewrite instanceof HTMLElement) || !(moveCard instanceof HTMLElement)) {
      throw new Error("Missing live-context review cards.");
    }

    expect(within(rewrite).getByText("Narration block 3")).toBeTruthy();
    expect(within(moveCard).getByText("Before Narration block 2")).toBeTruthy();
    expect(within(moveCard).getByText("The lantern went dark.")).toBeTruthy();
  });
});
