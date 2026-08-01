// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutlineReview } from "@/components/app/agent-console/outline-review";
import {
  cardFingerprint,
  outlineOrderFingerprint,
} from "@/lib/ai/agent-context";
import type {
  OutlinePendingChange,
  OutlinePendingProposal,
  SourceLocator,
} from "@/lib/ai/agent-types";
import type { Card } from "@/lib/types";
import { useProjectStore } from "@/stores/project-store";

const card = (id: string, title: string, intention: string): Card => ({
  id,
  title,
  intention,
  characterIds: [],
  loreIds: [],
  continuityFlags: [],
});

const frozenCards = [
  card("card-1", "Arrival", "Set the stakes"),
  card("card-2", "Second warning", "Repeat the threat"),
  card("card-3", "The choice", "Commit the hero"),
];

const locator = (
  source: Card,
  order: number,
): SourceLocator => ({
  sourceId: source.id,
  order,
  fingerprint: cardFingerprint(source),
  sourceType: "outline-card",
  label: "outline card",
  exactText: `${source.title}\n${source.intention}`,
  previewText: `${source.title}\n${source.intention}`,
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
      target: locator(frozenCards[0], 0),
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
      orderFingerprint: outlineOrderFingerprint(frozenCards),
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
      target: locator(frozenCards[1], 1),
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
      target: locator(frozenCards[2], 2),
      orderFingerprint: outlineOrderFingerprint(frozenCards),
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
          cards: frozenCards.map((item) => ({ ...item })),
        },
      },
    },
  } as never);
});

afterEach(() => cleanup());

describe("OutlineReview", () => {
  it("renders an add against a valid sparse empty outline", () => {
    useProjectStore.setState((state) => ({
      meta: { ...state.meta, chapters: {} },
    }));

    render(
      <OutlineReview
        proposal={{ ...proposal, changes: [changes[1]] }}
        staleChangeIds={new Set<string>()}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByText("New outline card")).toBeTruthy();
    expect(screen.getByText("Start of outline")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Accept" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("renders every change from live source and destination context", () => {
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
    expect(within(rewrite).getByText("Arrival")).toBeTruthy();
    expect(within(add).getByText("The warning")).toBeTruthy();
    expect(within(add).getByText("Foreshadow the cost")).toBeTruthy();
    expect(within(add).getByText("After The choice")).toBeTruthy();
    expect(within(add).getByText("Commit the hero")).toBeTruthy();
    expect(within(remove).getAllByText("Second warning")).toHaveLength(2);
    expect(within(remove).getByText("Repeat the threat")).toBeTruthy();
    expect(within(move).getAllByText("The choice")).toHaveLength(2);
    expect(within(move).getByText("Before Arrival")).toBeTruthy();
    expect(within(move).getByText("Set the stakes")).toBeTruthy();

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
    useProjectStore.setState((state) => ({
      meta: {
        ...state.meta,
        chapters: {
          ...state.meta.chapters,
          ch1: {
            ...state.meta.chapters.ch1,
            cards: [
              frozenCards[0],
              card("card-2", "Changed live warning", "Changed live threat"),
              frozenCards[2],
            ],
          },
        },
      },
    }));
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
    expect(within(stale).queryByText("Changed live warning")).toBeNull();
    expect(within(stale).queryByText("Changed live threat")).toBeNull();
    expect(
      within(stale).getByRole("button", { name: "Accept" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      within(fresh).getByRole("button", { name: "Accept" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("updates move destination labels and text from the live outline", () => {
    const liveDestination = card(
      "live-destination",
      "Live destination",
      "Turn the scene here",
    );
    const liveCards = [
      frozenCards[0],
      liveDestination,
      frozenCards[1],
      frozenCards[2],
    ];
    useProjectStore.setState((state) => ({
      meta: {
        ...state.meta,
        chapters: {
          ...state.meta.chapters,
          ch1: { ...state.meta.chapters.ch1, cards: liveCards },
        },
      },
    }));
    const liveMove: OutlinePendingChange = {
      ...changes[3],
      change: { ...changes[3].change, toIndex: 1 },
      precondition: {
        kind: "outline-move",
        target: locator(frozenCards[2], 3),
        orderFingerprint: outlineOrderFingerprint(liveCards),
      },
    };

    const { container } = render(
      <OutlineReview
        proposal={{ ...proposal, changes: [liveMove] }}
        staleChangeIds={new Set<string>()}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    const moveCard = container.querySelector('[data-agent-change-id="move-1"]');
    if (!(moveCard instanceof HTMLElement)) {
      throw new Error("Missing live outline move card.");
    }

    expect(within(moveCard).getByText("Before Live destination")).toBeTruthy();
    expect(within(moveCard).getByText("Turn the scene here")).toBeTruthy();
  });
});
