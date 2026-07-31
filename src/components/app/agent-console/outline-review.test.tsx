// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutlineReview } from "@/components/app/agent-console/outline-review";
import type {
  OutlinePendingChange,
  OutlinePendingProposal,
  SourceLocator,
} from "@/lib/ai/agent-types";

const locator = (
  sourceId: string,
  order: number,
  title: string,
  intention: string,
): SourceLocator => ({
  sourceId,
  order,
  fingerprint: `fingerprint-${sourceId}`,
  sourceType: "outline-card",
  label: title,
  exactText: `${title}\n${intention}`,
});

const changes: OutlinePendingChange[] = [
  {
    id: "rewrite-1",
    change: {
      kind: "rewrite",
      cardId: "card-1",
      title: "A harder arrival",
      intention: "Raise immediate stakes",
      toIndex: null,
      reason: "Start under pressure",
    },
    precondition: {
      kind: "card",
      target: locator("card-1", 0, "Arrival", "Set the stakes"),
    },
  },
  {
    id: "add-1",
    change: {
      kind: "add",
      cardId: null,
      title: "The warning",
      intention: "Foreshadow the cost",
      toIndex: null,
      reason: "Plant the threat",
    },
    precondition: {
      kind: "outline-order",
      orderFingerprint: "order-1",
    },
  },
  {
    id: "remove-1",
    change: {
      kind: "remove",
      cardId: "card-2",
      title: null,
      intention: null,
      toIndex: null,
      reason: "Remove repetition",
    },
    precondition: {
      kind: "card",
      target: locator("card-2", 1, "Second warning", "Repeat the threat"),
    },
  },
  {
    id: "move-1",
    change: {
      kind: "move",
      cardId: "card-3",
      title: null,
      intention: null,
      toIndex: 0,
      reason: "Reveal this first",
    },
    precondition: {
      kind: "outline-move",
      target: locator("card-3", 2, "The choice", "Commit the hero"),
      orderFingerprint: "order-1",
    },
  },
];

const proposal: OutlinePendingProposal = {
  id: "proposal-1",
  kind: "outline",
  projectRoot: "/book",
  chapterId: "ch1",
  summary: "Strengthen the opening beats",
  createdAt: "2026-07-30T00:00:00.000Z",
  originatingMessageId: "assistant-1",
  changes,
};

afterEach(() => cleanup());

describe("OutlineReview", () => {
  it("renders rewrite, add, remove, and move previews from frozen sources", () => {
    const { container } = render(
      <OutlineReview
        proposal={proposal}
        staleChangeIds={new Set<string>()}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    const rewrite = container.querySelector('[data-agent-change-id="rewrite-1"]');
    const add = container.querySelector('[data-agent-change-id="add-1"]');
    const remove = container.querySelector('[data-agent-change-id="remove-1"]');
    const move = container.querySelector('[data-agent-change-id="move-1"]');
    if (
      !(rewrite instanceof HTMLElement) ||
      !(add instanceof HTMLElement) ||
      !(remove instanceof HTMLElement) ||
      !(move instanceof HTMLElement)
    ) {
      throw new Error("Expected every outline review card.");
    }

    expect(rewrite.querySelector("del")?.textContent).toContain("Arrival");
    expect(rewrite.querySelector("ins")?.textContent).toContain(
      "A harder arrival",
    );
    expect(within(add).getByText("The warning")).toBeTruthy();
    expect(within(add).getByText("Foreshadow the cost")).toBeTruthy();
    expect(within(remove).getAllByText("Second warning")).toHaveLength(2);
    expect(within(remove).getByText("Repeat the threat")).toBeTruthy();
    expect(within(move).getAllByText("The choice")).toHaveLength(2);
    expect(within(move).getByText("Move to position 1")).toBeTruthy();

    for (const card of [rewrite, add, remove, move]) {
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
      <OutlineReview
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

    const card = container.querySelector('[data-agent-change-id="add-1"]');
    if (!(card instanceof HTMLElement)) throw new Error("Missing add card.");
    fireEvent.click(within(card).getByRole("button", { name: "Accept" }));
    fireEvent.click(within(card).getByRole("button", { name: "Reject" }));
    fireEvent.click(
      within(card).getByRole("button", { name: "Read in context" }),
    );
    expect(onAccept).toHaveBeenCalledWith("add-1");
    expect(onReject).toHaveBeenCalledWith("add-1");
    expect(onNavigate).toHaveBeenCalledWith("add-1");
  });

  it("keeps a stale frozen preview visible and disables only its Accept action", () => {
    const { container } = render(
      <OutlineReview
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
    expect(within(stale).getAllByText("Second warning")).toHaveLength(2);
    expect(
      within(stale).getByRole("button", { name: "Accept" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      within(fresh).getByRole("button", { name: "Accept" }).hasAttribute("disabled"),
    ).toBe(false);
  });
});
