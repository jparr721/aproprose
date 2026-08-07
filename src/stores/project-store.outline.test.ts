import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { buildOutlinePendingProposal } from "@/lib/ai/agent-proposals";
import { storyOverviewFingerprint } from "@/lib/ai/agent-context";
import type { AgentRun } from "@/lib/ai/agent-types";
import { runMigrations } from "@/lib/migration";
import { writeProjectMeta } from "@/lib/tauri";
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
    currentOverview: "",
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
  vi.mocked(writeProjectMeta).mockClear();
  useProjectStore.setState({
    project: projectFixture("/book"),
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
    const m = runMigrations({ outline: { premise: "X", overview: "" }, chapters: { ch1: { act: "setup", plotPoint: null, premise: "", goal: "", conflict: "", turn: "", cards: [] } } } as never);
    expect(m.chapters.ch1.act).toBe("setup");
  });
  it("backfills characterIds on chapters that predate the field", () => {
    const m = runMigrations({ outline: { premise: "X", overview: "" }, chapters: { ch1: { act: "setup", plotPoint: null, premise: "", goal: "", conflict: "", turn: "", cards: [] } } } as never);
    expect(m.chapters.ch1.characterIds).toEqual([]);
  });
});

describe("card + chapter actions", () => {
  it("persists story overview edits", () => {
    useProjectStore.getState().setOverview("A courier exposes the crown.");

    expect(useProjectStore.getState().meta.outline.overview).toBe(
      "A courier exposes the crown.",
    );
    const persisted = JSON.parse(
      vi.mocked(writeProjectMeta).mock.calls[0][1] as string,
    ) as { outline: { premise: string; overview: string } };
    expect(writeProjectMeta).toHaveBeenCalledWith("/book", expect.any(String));
    expect(persisted.outline).toEqual({
      premise: "",
      overview: "A courier exposes the crown.",
    });
  });

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
  it("applies a selected overview change after the proposal chapter is deleted", () => {
    const proposal = {
      ...pendingOutlineFixture(),
      overviewChange: {
        id: "overview-change",
        before: "",
        after: "The courier exposes the crown.",
        reason: "Clarify the story direction",
        sourceFingerprint: storyOverviewFingerprint(""),
      },
    };
    useProjectStore.setState((state) => ({
      project: {
        ...projectFixture("/book"),
        chapters: [],
      },
      meta: {
        ...state.meta,
        chapters: {},
      },
    }));
    const before = useProjectStore.getState().meta;

    const result = useProjectStore
      .getState()
      .applyAgentOutlineProposal(proposal, [proposal.overviewChange.id]);

    expect(result.status).toBe("applied");
    if (result.status !== "applied") throw new Error("expected an applied result");
    expect(useProjectStore.getState().meta.outline.overview).toBe(
      "The courier exposes the crown.",
    );
    expect(useProjectStore.getState().meta.chapters).toEqual({});
    expect(
      useProjectStore.getState().undoAgentOutlineProposal(result.undoToken),
    ).toBe(true);
    expect(useProjectStore.getState().meta).toEqual(before);
  });

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

    expect(result).toEqual({
      status: "invalid",
      invalidChangeIds: ["unknown"],
      reason: "unknown-selection",
    });
    expect(useProjectStore.getState().meta).toEqual(before);
  });

  it("rejects a mismatched outline precondition without writing metadata", () => {
    const addProposal = buildPendingOutlineFixture(
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
    const targetProposal = pendingOutlineFixture();
    const mismatchedProposal = {
      ...addProposal,
      changes: [
        {
          ...addProposal.changes[0],
          precondition: targetProposal.changes[0].precondition,
        },
      ],
    };
    const before = useProjectStore.getState().meta;

    const result = useProjectStore
      .getState()
      .applyAgentOutlineProposal(mismatchedProposal, ["change-0"]);

    expect(result).toEqual({
      status: "invalid",
      invalidChangeIds: ["change-0"],
      reason: "mismatched-precondition",
    });
    expect(useProjectStore.getState().meta).toEqual(before);
    expect(writeProjectMeta).not.toHaveBeenCalled();
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
      ],
      [cardFixture()],
    );
    const conflictingProposal = {
      ...proposal,
      changes: [
        proposal.changes[0],
        {
          ...proposal.changes[0],
          id: "change-1",
          change: {
            ...proposal.changes[0].change,
            reason: "Remove again",
          },
        },
      ],
    };
    const before = useProjectStore.getState().meta;

    const result = useProjectStore
      .getState()
      .applyAgentOutlineProposal(
        conflictingProposal,
        conflictingProposal.changes.map((change) => change.id),
      );

    expect(result).toEqual({
      status: "invalid",
      invalidChangeIds: ["change-0", "change-1"],
      reason: "conflicting-changes",
    });
    expect(useProjectStore.getState().meta).toEqual(before);
    expect(writeProjectMeta).not.toHaveBeenCalled();
  });

  it("rejects a legacy malformed add without writing metadata", () => {
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
    const malformed = {
      ...proposal,
      changes: [
        {
          ...proposal.changes[0],
          change: { ...proposal.changes[0].change, cardId: "legacy-card-id" },
        },
      ],
    };
    const before = useProjectStore.getState().meta;

    const result = useProjectStore
      .getState()
      .applyAgentOutlineProposal(malformed, ["change-0"]);

    expect(result).toEqual({
      status: "invalid",
      invalidChangeIds: ["change-0"],
      reason: "apply-failed",
    });
    expect(useProjectStore.getState().meta).toEqual(before);
    expect(writeProjectMeta).not.toHaveBeenCalled();
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
