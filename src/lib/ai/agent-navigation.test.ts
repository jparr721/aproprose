// @vitest-environment happy-dom

import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

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

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

import {
  blockFingerprint,
  cardFingerprint,
  findingFingerprint,
} from "@/lib/ai/agent-context";
import {
  navigateToContextSnapshot,
  navigateToProposalChange,
} from "@/lib/ai/agent-navigation";
import type {
  AgentUIMessage,
  ContextSnapshot,
  ManuscriptPendingChange,
  OutlinePendingChange,
  SourceLocator,
} from "@/lib/ai/agent-types";
import { parseChapter } from "@/lib/latex";
import { readTextFile } from "@/lib/tauri";
import type { Block, Card, ProjectInfo } from "@/lib/types";
import {
  EMPTY_AGENT_STATE,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { useOutlineBoardStore } from "@/stores/outline-board-store";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";

const projectFixture = (): ProjectInfo => ({
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
      title: "One",
      file: "one.tex",
      wordCount: 2,
    },
    {
      id: "ch2",
      label: "II",
      title: "Two",
      file: "two.tex",
      wordCount: 3,
    },
  ],
});

const blockFixture = (id: string, text: string): Block => ({
  id,
  type: "narration",
  text,
  raw: `${text}\n`,
  dirty: false,
});

const cardFixture = (id: string, title: string): Card => ({
  id,
  title,
  intention: "Force the choice",
  characterIds: [],
  loreIds: [],
  continuityFlags: [],
});

const blockLocator = (block: Block, order: number): SourceLocator => ({
  sourceId: block.id,
  order,
  fingerprint: blockFingerprint(block),
  sourceType: block.type,
  label: "Narration block",
  exactText: block.text,
});

const snapshotFixture = (
  block: Block,
  order: number,
  chapterId: string,
): ContextSnapshot => ({
  id: "snapshot-1",
  kind: "block",
  chapterId,
  sourceId: block.id,
  order,
  sourceType: block.type,
  label: "Narration block",
  exactText: block.text,
  sourceFingerprint: blockFingerprint(block),
});

const addScrollTarget = (attribute: string, id: string): HTMLElement => {
  const element = document.createElement("div");
  element.setAttribute(attribute, id);
  document.body.append(element);
  return element;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("CSS", { escape: (value: string): string => value });
  vi.stubGlobal(
    "requestAnimationFrame",
    (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  useAgentConsoleStore.setState({
    ...EMPTY_AGENT_STATE,
    messages: [],
    hydratedProjectRoot: "/book",
  });
  useOutlineBoardStore.setState({
    openChapterId: null,
    highlightedCardId: null,
    proposal: null,
    decisions: {},
    sculptingChapterId: null,
    sculptError: null,
  } as never);
  useViewStore.setState({
    outlineOpen: false,
    focus: false,
    pending: null,
  });
  useProjectStore.setState({
    project: projectFixture(),
    activeChapterId: "ch1",
    blocks: [],
    selectedId: null,
    selectedIds: [],
    editing: false,
    editCaret: null,
    chapterDirty: false,
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
          cards: [],
        },
        ch2: {
          act: null,
          plotPoint: null,
          premise: "",
          goal: "",
          conflict: "",
          turn: "",
          characterIds: [],
          cards: [],
        },
      },
    },
  } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("navigateToContextSnapshot", () => {
  it("relocates a reminted active-chapter block by order and fingerprint", async () => {
    const frozen = blockFixture("old-id", "The same paragraph.");
    const reminted = blockFixture("new-id", "The same paragraph.");
    useProjectStore.setState({ blocks: [reminted] });
    const target = addScrollTarget("data-block-id", reminted.id);

    await expect(
      navigateToContextSnapshot(snapshotFixture(frozen, 0, "ch1")),
    ).resolves.toBe(true);

    expect(useProjectStore.getState().selectedId).toBe(reminted.id);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("routes an inactive chapter through the dirty guard and awaits selection", async () => {
    const source = "The second chapter paragraph.";
    const frozen = parseChapter(source)[0];
    vi.mocked(readTextFile).mockResolvedValue(source);
    const requestGuarded = vi.spyOn(
      useViewStore.getState(),
      "requestGuarded",
    );

    const didNavigate = await navigateToContextSnapshot(
      snapshotFixture(frozen, 0, "ch2"),
    );

    expect(didNavigate).toBe(true);
    expect(requestGuarded).toHaveBeenCalledOnce();
    expect(useProjectStore.getState().activeChapterId).toBe("ch2");
    expect(useProjectStore.getState().selectedId).toBe(
      useProjectStore.getState().blocks[0].id,
    );
  });

  it("returns false when a sent source was deleted", async () => {
    const frozen = blockFixture("deleted-id", "Deleted prose.");
    useProjectStore.setState({
      blocks: [blockFixture("other-id", "Other prose.")],
    });

    await expect(
      navigateToContextSnapshot(snapshotFixture(frozen, 0, "ch1")),
    ).resolves.toBe(false);
    expect(useProjectStore.getState().selectedId).toBeNull();
  });

  it("selects the first live linked block for a finding", async () => {
    const linked = blockFixture("linked-2", "Live linked prose.");
    useProjectStore.setState({ blocks: [linked] });
    const finding = {
      kind: "watch" as const,
      tag: "Pacing",
      text: "The middle slows.",
      blockIds: ["deleted-1", "linked-2"],
    };
    const findingMessage: AgentUIMessage = {
      id: "assistant-1",
      role: "assistant",
      metadata: {
        runId: "run-1",
        mode: "edit",
        task: { kind: "chapter-analysis", chapterId: "ch1", analysis: "critique" },
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
            items: [finding],
          },
        },
      ],
    };
    useAgentConsoleStore.setState({ messages: [findingMessage] });
    const snapshot: ContextSnapshot = {
      id: "finding-snapshot",
      kind: "finding",
      chapterId: "ch1",
      sourceId: "assistant-1:0",
      order: 0,
      sourceType: "critique",
      label: "Pacing",
      exactText: "The middle slows.",
      sourceFingerprint: findingFingerprint(finding),
    };

    await expect(navigateToContextSnapshot(snapshot)).resolves.toBe(true);
    expect(useProjectStore.getState().selectedId).toBe("linked-2");
  });
});

describe("navigateToProposalChange", () => {
  it("uses a manuscript frozen locator instead of the stale raw change id", async () => {
    const frozen = blockFixture("frozen-id", "Unchanged prose.");
    const reminted = blockFixture("reminted-id", "Unchanged prose.");
    useProjectStore.setState({ blocks: [reminted] });
    const target = addScrollTarget("data-block-id", reminted.id);
    const change: ManuscriptPendingChange = {
      id: "change-1",
      change: {
        kind: "rewrite",
        blockId: "stale-raw-id",
        afterId: null,
        type: null,
        speaker: null,
        newText: "Revised prose.",
        toIndex: null,
        reason: "Tighten",
      },
      precondition: { kind: "target", target: blockLocator(frozen, 0) },
    };

    await expect(navigateToProposalChange("ch1", change)).resolves.toBe(true);
    expect(useProjectStore.getState().selectedId).toBe("reminted-id");
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("opens the outline overview, highlights the card, and scrolls it", async () => {
    const card = cardFixture("card-1", "The turn");
    useProjectStore.setState((state) => ({
      meta: {
        ...state.meta,
        chapters: {
          ...state.meta.chapters,
          ch1: { ...state.meta.chapters.ch1, cards: [card] },
        },
      },
    }));
    useOutlineBoardStore.setState({ openChapterId: "ch1" });
    const target = addScrollTarget("data-outline-card-id", card.id);
    const locator: SourceLocator = {
      sourceId: card.id,
      order: 0,
      fingerprint: cardFingerprint(card),
      sourceType: "outline-card",
      label: card.title,
      exactText: `${card.title}\n${card.intention}`,
    };
    const change: OutlinePendingChange = {
      id: "outline-change-1",
      change: {
        kind: "rewrite",
        cardId: card.id,
        title: "The harder turn",
        intention: null,
        toIndex: null,
        reason: "Raise pressure",
      },
      precondition: { kind: "card", target: locator },
    };

    await expect(navigateToProposalChange("ch1", change)).resolves.toBe(true);

    expect(useViewStore.getState().outlineOpen).toBe(true);
    expect(useOutlineBoardStore.getState().openChapterId).toBeNull();
    expect(useOutlineBoardStore.getState().highlightedCardId).toBe(card.id);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("does not select a neighboring block when a proposal target was deleted", async () => {
    const frozen = blockFixture("deleted-id", "Deleted target.");
    useProjectStore.setState({
      blocks: [blockFixture("neighbor-id", "A neighbor.")],
      selectedId: null,
    });
    const change: ManuscriptPendingChange = {
      id: "change-1",
      change: {
        kind: "remove",
        blockId: "deleted-id",
        afterId: null,
        type: null,
        speaker: null,
        newText: null,
        toIndex: null,
        reason: "Cut repetition",
      },
      precondition: { kind: "target", target: blockLocator(frozen, 0) },
    };

    await expect(navigateToProposalChange("ch1", change)).resolves.toBe(false);
    expect(useProjectStore.getState().selectedId).toBeNull();
  });

  it("keeps guarded inactive navigation pending until the author confirms", async () => {
    const source = "Guarded chapter prose.";
    const frozen = parseChapter(source)[0];
    vi.mocked(readTextFile).mockResolvedValue(source);
    useProjectStore.setState({ chapterDirty: true });

    const didNavigate = await navigateToContextSnapshot(
      snapshotFixture(frozen, 0, "ch2"),
    );

    expect(didNavigate).toBe(true);
    expect(useProjectStore.getState().activeChapterId).toBe("ch1");
    expect(useViewStore.getState().pending).not.toBeNull();

    useViewStore.getState().confirmPending();
    await waitFor(() => {
      expect(useProjectStore.getState().activeChapterId).toBe("ch2");
      expect(useProjectStore.getState().selectedId).toBe(
        useProjectStore.getState().blocks[0].id,
      );
    });
  });
});
