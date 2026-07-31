import { beforeEach, describe, expect, it } from "vitest";
import { buildOutlinePendingProposal } from "@/lib/ai/agent-proposals";
import type { AgentRun } from "@/lib/ai/agent-types";
import { runMigrations } from "@/lib/migration";
import { useProjectStore } from "@/stores/project-store";
import type {
  Card,
  ProjectInfo,
  SculptChange,
  SculptProposal,
} from "@/lib/types";

const cardFixture = (): Card => ({
  id: "card-1",
  title: "Arrival",
  intention: "Set the stakes",
  characterIds: [],
  loreIds: [],
  continuityFlags: [],
});

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
      file: "chapter-one.tex",
      wordCount: 0,
    },
  ],
});

const buildPendingOutlineFixture = (
  changes: SculptChange[],
  cards: Card[],
) => {
  const raw: SculptProposal = {
    chapterId: "ch1",
    summary: "Strengthen the arrival",
    changes,
  };
  return buildOutlinePendingProposal({
    run: {
      id: "run-1",
      projectRoot: "/book",
      mode: "edit",
      task: { kind: "outline-sculpt", chapterId: "ch1" },
      userMessageId: "user-1",
      attachments: [],
      startedAt: "2026-07-30T00:00:00.000Z",
    } satisfies AgentRun,
    raw,
    cards,
    currentPending: null,
    originatingMessageId: "assistant-1",
    makeId: (() => {
      let index = -1;
      return () => {
        index += 1;
        return index === 0 ? "proposal-1" : `change-${index - 1}`;
      };
    })(),
    now: "2026-07-30T00:01:00.000Z",
  });
};

const pendingOutlineFixture = () =>
  buildPendingOutlineFixture(
    [
      {
        kind: "rewrite",
        cardId: "card-1",
        title: "Hard arrival",
        intention: null,
        toIndex: null,
        reason: "Raise the stakes",
      },
    ],
    [cardFixture()],
  );

beforeEach(() => {
  useProjectStore.setState({
    project: projectFixture("/book"),
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
          cards: [cardFixture()],
        },
      },
    },
  } as never);
});

describe("runMigrations", () => {
  it("migrates a legacy blob and keeps premise", () => {
    const m = runMigrations({
      outline: { premise: "P", acts: [{ kind: "setup", beats: [
        { title: "b", intention: "i", chapterIds: ["ch1"], type: "inciting" },
      ] }] },
      chapterBeats: { ch1: { goal: "g", conflict: "", turn: "" } },
    } as never);
    expect(m.outline.premise).toBe("P");
    expect(m.chapters.ch1.cards[0].title).toBe("b");
    expect(m.chapters.ch1.goal).toBe("g");
  });
  it("passes a new-shape blob through", () => {
    const m = runMigrations({ outline: { premise: "X" }, chapters: { ch1: { act: "setup", plotPoint: null, premise: "", goal: "", conflict: "", turn: "", cards: [] } } } as never);
    expect(m.chapters.ch1.act).toBe("setup");
  });
  it("backfills characterIds on chapters that predate the field", () => {
    const m = runMigrations({ outline: { premise: "X" }, chapters: { ch1: { act: "setup", plotPoint: null, premise: "", goal: "", conflict: "", turn: "", cards: [] } } } as never);
    expect(m.chapters.ch1.characterIds).toEqual([]);
  });
});

describe("card + chapter actions", () => {
  it("adds and edits a card", () => {
    const id = useProjectStore.getState().addCard("ch1");
    useProjectStore.getState().editCard("ch1", id, { title: "Hello" });
    expect(
      useProjectStore
        .getState()
        .meta.chapters.ch1.cards.find((card) => card.id === id)?.title,
    ).toBe("Hello");
  });
  it("moves a card between chapters", () => {
    const id = useProjectStore.getState().addCard("ch1");
    useProjectStore.getState().moveCardToChapter("ch1", "ch2", id, 0);
    expect(useProjectStore.getState().meta.chapters.ch2.cards.map((c) => c.id)).toEqual([id]);
  });
  it("sets a chapter act and field", () => {
    useProjectStore.getState().setChapterAct("ch1", "confrontation");
    useProjectStore.getState().setChapterField("ch1", { goal: "win" });
    const ch = useProjectStore.getState().meta.chapters.ch1;
    expect(ch).toMatchObject({ act: "confrontation", goal: "win" });
  });
  it("assigns and unassigns a chapter cast", () => {
    useProjectStore.getState().addCharacterToChapter("ch1", "c1");
    useProjectStore.getState().addCharacterToChapter("ch1", "c2");
    expect(useProjectStore.getState().meta.chapters.ch1.characterIds).toEqual(["c1", "c2"]);
    useProjectStore.getState().removeCharacterFromChapter("ch1", "c1");
    expect(useProjectStore.getState().meta.chapters.ch1.characterIds).toEqual(["c2"]);
  });
});

describe("agent outline proposals", () => {
  it("applies selected changes in one metadata write and returns one undo token", () => {
    const proposal = pendingOutlineFixture();
    const before = useProjectStore.getState().meta;

    const result = useProjectStore
      .getState()
      .applyAgentOutlineProposal(
        proposal,
        proposal.changes.map((change) => change.id),
      );

    expect(result.status).toBe("applied");
    if (result.status !== "applied") throw new Error("expected an applied result");
    expect(useProjectStore.getState().meta.chapters.ch1.cards[0].title).toBe(
      "Hard arrival",
    );
    expect(
      useProjectStore.getState().undoAgentOutlineProposal(result.undoToken),
    ).toBe(true);
    expect(useProjectStore.getState().meta).toEqual(before);
  });

  it("refuses undo after a later outline mutation", () => {
    const proposal = pendingOutlineFixture();
    const result = useProjectStore
      .getState()
      .applyAgentOutlineProposal(
        proposal,
        proposal.changes.map((change) => change.id),
      );
    if (result.status !== "applied") throw new Error("expected an applied result");
    useProjectStore.getState().setChapterField("ch1", { goal: "Changed later" });
    expect(
      useProjectStore.getState().undoAgentOutlineProposal(result.undoToken),
    ).toBe(false);
  });

  it("rejects an unknown selected change id before applying known changes", () => {
    const proposal = pendingOutlineFixture();
    const before = useProjectStore.getState().meta;

    const result = useProjectStore
      .getState()
      .applyAgentOutlineProposal(proposal, ["change-0", "unknown"]);

    expect(result).toEqual({ status: "stale", staleChangeIds: ["unknown"] });
    expect(useProjectStore.getState().meta).toEqual(before);
  });

  it("rejects conflicting selected targets without a partial mutation", () => {
    const proposal = buildPendingOutlineFixture(
      [
        {
          kind: "remove",
          cardId: "card-1",
          title: null,
          intention: null,
          toIndex: null,
          reason: "Remove",
        },
        {
          kind: "remove",
          cardId: "card-1",
          title: null,
          intention: null,
          toIndex: null,
          reason: "Remove again",
        },
      ],
      [cardFixture()],
    );
    const before = useProjectStore.getState().meta;

    const result = useProjectStore
      .getState()
      .applyAgentOutlineProposal(
        proposal,
        proposal.changes.map((change) => change.id),
      );

    expect(result).toEqual({
      status: "stale",
      staleChangeIds: ["change-0", "change-1"],
    });
    expect(useProjectStore.getState().meta).toEqual(before);
  });

  it("rejects an add-only proposal after its chapter is deleted", () => {
    const proposal = buildPendingOutlineFixture(
      [
        {
          kind: "add",
          cardId: null,
          title: "New beat",
          intention: "Escalate",
          toIndex: null,
          reason: "Add pressure",
        },
      ],
      [cardFixture()],
    );
    useProjectStore.setState({
      project: { ...projectFixture("/book"), chapters: [] },
    } as never);
    const before = useProjectStore.getState().meta;

    const result = useProjectStore
      .getState()
      .applyAgentOutlineProposal(
        proposal,
        proposal.changes.map((change) => change.id),
      );

    expect(result).toEqual({
      status: "stale",
      staleChangeIds: ["change-0"],
    });
    expect(useProjectStore.getState().meta).toEqual(before);
  });
});
