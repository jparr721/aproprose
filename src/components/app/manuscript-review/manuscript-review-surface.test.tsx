// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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

vi.mock("@/lib/ai/agent-controller", () => ({
  recordProposalEvent: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { ManuscriptReviewSurface } from "@/components/app/manuscript-review/manuscript-review-surface";
import {
  blockFingerprint,
  blockOrderFingerprint,
} from "@/lib/ai/agent-context";
import type {
  ManuscriptPendingChange,
  ManuscriptPendingProposal,
  SourceLocator,
} from "@/lib/ai/agent-types";
import type { Block, Character, ProjectInfo, ProjectMeta } from "@/lib/types";
import {
  emptyCharacterProfile,
  emptyProjectKnowledge,
} from "@/lib/story-knowledge/model";
import { useAgentConsoleStore } from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";

const ROOT = "/book";
const CHAPTER_ID = "chapter-1";

const characters: Character[] = [
  {
    id: "character-mara",
    name: "Mara",
    color: "#336699",
    role: "Lead",
    profile: emptyCharacterProfile(),
  },
];

function narration(id: string, text: string): Block {
  return { id, type: "narration", text, raw: `${text}\n\n`, dirty: false };
}

const frozenBlocks: Block[] = [
  narration("alpha", "The harbor slept under rain."),
  narration("bravo", "The bell rang twice."),
  narration("charlie", "Mara hid the iron key."),
  {
    id: "dialogue",
    type: "dialogue",
    text: "I kept the key.",
    raw: "I kept the key.\n\n",
    dirty: false,
    speaker: "character-mara",
    tail: [
      { kind: "beat", text: "She closed her hand." },
      { kind: "quote", text: "No one followed." },
    ],
  },
  {
    id: "scene",
    type: "chapter",
    text: "Nightfall",
    raw: "Nightfall\n\n",
    dirty: false,
    level: "scene",
  },
];

function locator(blocks: Block[], order: number): SourceLocator {
  const source = blocks[order];
  if (source === undefined) {
    throw new Error(`Missing fixture block at order ${order}.`);
  }
  return {
    sourceId: source.id,
    order,
    fingerprint: blockFingerprint(source),
    sourceType: source.type,
    label: `${source.type} block ${order + 1}`,
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
  return {
    id,
    change: {
      kind: "rewrite",
      blockId: target.sourceId,
      afterId: null,
      type: null,
      speaker: null,
      newText,
      toIndex: null,
      reason: "Sharpen the image",
    },
    precondition: { kind: "target", target },
  };
}

function insertChange(
  id: string,
  blocks: Block[],
  afterOrder: number,
  newText: string,
  type: "narration" | "dialogue",
  speaker: string | null,
): ManuscriptPendingChange {
  const anchor = locator(blocks, afterOrder);
  const next = blocks[afterOrder + 1];
  return {
    id,
    change: {
      kind: "insert",
      blockId: null,
      afterId: anchor.sourceId,
      type,
      speaker,
      newText,
      toIndex: null,
      reason: "Bridge the moment",
    },
    precondition: {
      kind: "insert",
      boundary: "immediate",
      anchor,
      expectedNext: next === undefined ? null : locator(blocks, afterOrder + 1),
    },
  };
}

function removeChange(
  id: string,
  blocks: Block[],
  order: number,
): ManuscriptPendingChange {
  const target = locator(blocks, order);
  return {
    id,
    change: {
      kind: "remove",
      blockId: target.sourceId,
      afterId: null,
      type: null,
      speaker: null,
      newText: null,
      toIndex: null,
      reason: "Remove repetition",
    },
    precondition: { kind: "target", target },
  };
}

function moveChange(
  id: string,
  blocks: Block[],
  order: number,
  toIndex: number,
): ManuscriptPendingChange {
  const target = locator(blocks, order);
  return {
    id,
    change: {
      kind: "move",
      blockId: target.sourceId,
      afterId: null,
      type: null,
      speaker: null,
      newText: null,
      toIndex,
      reason: "Reveal this sooner",
    },
    precondition: {
      kind: "move",
      target,
      orderFingerprint: blockOrderFingerprint(blocks),
    },
  };
}

function proposal(
  id: string,
  changes: ManuscriptPendingChange[],
): ManuscriptPendingProposal {
  return {
    id,
    kind: "manuscript",
    projectRoot: ROOT,
    chapterId: CHAPTER_ID,
    summary: "Tighten the harbor opening",
    createdAt: "2026-08-01T00:00:00.000Z",
    originatingMessageId: "assistant-1",
    changes,
  };
}

function mixedProposal(): ManuscriptPendingProposal {
  return proposal("proposal-mixed", [
    rewriteChange(
      "rewrite-1",
      frozenBlocks,
      0,
      "The harbor waited under rain.",
    ),
    insertChange(
      "insert-1",
      frozenBlocks,
      0,
      "A gull crossed the dark water.",
      "narration",
      null,
    ),
    removeChange("remove-1", frozenBlocks, 1),
    moveChange("move-1", frozenBlocks, 2, 0),
  ]);
}

function projectFixture(): ProjectInfo {
  return {
    root: ROOT,
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
        id: CHAPTER_ID,
        label: "I",
        title: "Chapter One",
        file: "one.tex",
        wordCount: 22,
      },
    ],
  };
}

function metaFixture(): ProjectMeta {
  return {
    version: 2,
    characters,
    lore: [],
    statuses: {},
    outline: { premise: "", overview: "" },
    chapters: {},
    knowledge: emptyProjectKnowledge(),
  };
}

function renderProposal(current: ManuscriptPendingProposal) {
  useAgentConsoleStore.setState({ pendingProposal: current });
  useViewStore.getState().openManuscriptReview(current.id);
  return render(<ManuscriptReviewSurface proposal={current} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState(useProjectStore.getInitialState(), true);
  useAgentConsoleStore.setState(useAgentConsoleStore.getInitialState(), true);
  useViewStore.setState(useViewStore.getInitialState(), true);
  useProjectStore.setState({
    status: "ready",
    project: projectFixture(),
    meta: metaFixture(),
    activeChapterId: CHAPTER_ID,
    blocks: frozenBlocks.map((block) => structuredClone(block)),
    chapterDirty: false,
    past: [],
    future: [],
  });
  useAgentConsoleStore.setState({
    requestedProjectRoot: ROOT,
    activeProjectRoot: ROOT,
    hydratedProjectRoot: ROOT,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ManuscriptReviewSurface header", () => {
  it("renders compact controls and navigates rendered decision rows without wrapping", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const current = mixedProposal();
    const { container } = renderProposal(current);

    expect(screen.getByText("Tighten the harbor opening")).toBeTruthy();
    expect(screen.getByText("4 changes")).toBeTruthy();
    const previous = screen.getByRole("button", { name: "Previous change" });
    const next = screen.getByRole("button", { name: "Next change" });
    expect(screen.getByRole("button", { name: "Accept All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close Review" })).toBeTruthy();
    expect(previous).toHaveProperty("disabled", true);
    expect(next).toHaveProperty("disabled", false);

    const card = container.querySelector('[data-slot="card"]');
    expect(card?.classList.contains("sticky")).toBe(true);
    expect(card?.querySelector('[data-slot="card-header"]')).toBeTruthy();
    expect(card?.querySelector('[data-slot="card-content"]')).toBeTruthy();

    const decisionRows = container.querySelectorAll(
      "[data-agent-decision-change-id]",
    );
    expect(decisionRows).toHaveLength(4);
    expect(decisionRows[0]?.getAttribute("data-active-review-change")).toBe(
      "true",
    );

    fireEvent.click(next);

    expect(decisionRows[0]?.hasAttribute("data-active-review-change")).toBe(
      false,
    );
    expect(decisionRows[1]?.getAttribute("data-active-review-change")).toBe(
      "true",
    );
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      behavior: "smooth",
      block: "center",
    });

    fireEvent.click(next);
    fireEvent.click(next);

    expect(decisionRows[3]?.getAttribute("data-active-review-change")).toBe(
      "true",
    );
    expect(next).toHaveProperty("disabled", true);
    expect(scrollIntoView).toHaveBeenCalledTimes(3);

    fireEvent.click(next);

    expect(decisionRows[3]?.getAttribute("data-active-review-change")).toBe(
      "true",
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(3);

    fireEvent.click(previous);

    expect(decisionRows[2]?.getAttribute("data-active-review-change")).toBe(
      "true",
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(4);
    expect(
      container
        .querySelector('[data-review-row-kind="move-source"]')
        ?.hasAttribute("data-active-review-change"),
    ).toBe(false);
  });
});

describe("ManuscriptReviewSurface rows", () => {
  it("shows a frozen rewrite diff and a read-only inserted proposal", () => {
    const { container } = renderProposal(mixedProposal());

    const deletion = screen.getByText("slept");
    const addition = screen.getByText("waited");
    expect(deletion.tagName).toBe("DEL");
    expect(addition.tagName).toBe("INS");
    expect(container.querySelector("textarea")).toBeNull();
    expect(screen.getByText("A gull crossed the dark water.")).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Edit proposal" }),
    ).toHaveLength(2);
  });

  it("renders type-aware unchanged prose and every projected change kind in place", () => {
    const { container } = renderProposal(mixedProposal());

    const unchangedRows = container.querySelectorAll(
      '[data-review-row-kind="unchanged"]',
    );
    expect(unchangedRows).toHaveLength(2);
    expect(screen.getByText("Mara").tagName).toBe("SPAN");
    expect(screen.getByText("I kept the key.").tagName).toBe("P");
    expect(screen.getByText("She closed her hand.").tagName).toBe("P");
    expect(screen.getByText("No one followed.").tagName).toBe("P");
    expect(screen.getByText("Nightfall").tagName).toBe("H2");

    expect(
      container.querySelectorAll('[data-review-row-kind="rewrite"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-review-row-kind="insert"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-review-row-kind="remove"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-review-row-kind="move-source"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll(
        '[data-review-row-kind="move-destination"]',
      ),
    ).toHaveLength(1);

    const rewrite = container.querySelector(
      '[data-review-row-kind="rewrite"]',
    );
    expect(rewrite).toBeInstanceOf(HTMLElement);
    if (!(rewrite instanceof HTMLElement)) return;
    expect(within(rewrite).getByText("Rewrite").tagName).toBe("SPAN");
    expect(within(rewrite).getByText("narration block 1").tagName).toBe("P");
    expect(within(rewrite).getByText("Sharpen the image").tagName).toBe("P");

    expect(rewrite.classList.contains("bg-success/10")).toBe(true);
    expect(rewrite.className).not.toContain("text-success");
    const remove = container.querySelector(
      '[data-review-row-kind="remove"]',
    );
    expect(remove?.classList.contains("bg-destructive/10")).toBe(true);
  });

  it("places decisions only on decision rows and omits authoring controls", () => {
    const { container } = renderProposal(mixedProposal());

    expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: "Reject" })).toHaveLength(4);
    const moveSource = container.querySelector(
      '[data-review-row-kind="move-source"]',
    );
    expect(moveSource).toBeInstanceOf(HTMLElement);
    if (!(moveSource instanceof HTMLElement)) return;
    expect(within(moveSource).queryByRole("button", { name: "Accept" })).toBeNull();
    expect(within(moveSource).queryByRole("button", { name: "Reject" })).toBeNull();
    expect(moveSource.hasAttribute("data-agent-decision-change-id")).toBe(false);

    for (const row of container.querySelectorAll(
      '[data-agent-decision-change-id]',
    )) {
      expect(within(row as HTMLElement).getByRole("button", { name: "Accept" })).toBeTruthy();
      expect(within(row as HTMLElement).getByRole("button", { name: "Reject" })).toBeTruthy();
    }
    for (const row of container.querySelectorAll(
      '[data-review-row-kind="unchanged"]',
    )) {
      expect(row.querySelector("textarea")).toBeNull();
    }
    expect(screen.queryByRole("button", { name: "Drag to reorder block" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Isolate selection as its own block" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Narration" })).toBeNull();
    expect(container.querySelector("[data-block-id]")).toBeNull();
    expect(container.querySelector("[data-prose-body]")).toBeNull();
  });

  it("wraps removed manuscript content in deletion semantics", () => {
    const { container } = renderProposal(mixedProposal());
    const remove = container.querySelector(
      '[data-review-row-kind="remove"]',
    );
    const deletion = remove?.querySelector("del");

    expect(deletion?.tagName).toBe("DEL");
    expect(deletion?.textContent).toContain("The bell rang twice.");
  });
});

describe("ManuscriptReviewSurface rewrite editing", () => {
  function rewriteOnly(): ManuscriptPendingProposal {
    return proposal("proposal-rewrite", [
      rewriteChange(
        "rewrite-only",
        frozenBlocks,
        0,
        "The harbor waited under rain.",
      ),
    ]);
  }

  it("replaces the decisions with save and discard and tints the editing row", () => {
    const { container } = renderProposal(rewriteOnly());
    const row = container.querySelector('[data-review-row-kind="rewrite"]');
    expect(row).toBeInstanceOf(HTMLElement);
    if (!(row instanceof HTMLElement)) return;
    expect(row.className).toContain("bg-success/10");

    fireEvent.click(screen.getByRole("button", { name: "Edit proposal" }));

    const textbox = screen.getByRole("textbox", {
      name: "Edit proposed rewrite",
    });
    expect(textbox).toHaveProperty("value", "The harbor waited under rain.");
    expect(textbox.closest("[data-capture-keyboard]")).toBeInstanceOf(
      HTMLElement,
    );
    expect(textbox.hasAttribute("data-prose-body")).toBe(false);
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit proposal" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
    expect(row.className).toContain("bg-accent-ink/15");
    expect(row.className).not.toContain("bg-success/10");
  });

  it("stays in edit mode when the textarea loses focus", () => {
    renderProposal(rewriteOnly());
    fireEvent.click(screen.getByRole("button", { name: "Edit proposal" }));
    const textbox = screen.getByRole("textbox", {
      name: "Edit proposed rewrite",
    });

    fireEvent.blur(textbox);

    expect(
      screen.getByRole("textbox", { name: "Edit proposed rewrite" }),
    ).toBe(textbox);
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("diffs the draft live and only commits the proposal text on save", () => {
    renderProposal(rewriteOnly());
    const projectBefore = useProjectStore.getState();
    fireEvent.click(screen.getByRole("button", { name: "Edit proposal" }));

    fireEvent.change(
      screen.getByRole("textbox", { name: "Edit proposed rewrite" }),
      { target: { value: "The harbor gleamed under rain." } },
    );

    expect(screen.getByText("gleamed").tagName).toBe("INS");
    expect(screen.getByText("slept").tagName).toBe("DEL");
    const staged = useAgentConsoleStore.getState().pendingProposal;
    expect(staged?.kind).toBe("manuscript");
    if (staged?.kind !== "manuscript") return;
    expect(staged.changes[0]?.change.newText).toBe(
      "The harbor waited under rain.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const pending = useAgentConsoleStore.getState().pendingProposal;
    expect(pending?.kind).toBe("manuscript");
    if (pending?.kind !== "manuscript") return;
    expect(pending.changes[0]?.change.newText).toBe(
      "The harbor gleamed under rain.",
    );
    expect(
      screen.queryByRole("textbox", { name: "Edit proposed rewrite" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(screen.getByText("gleamed").tagName).toBe("INS");
    const projectAfter = useProjectStore.getState();
    expect(projectAfter.blocks).toBe(projectBefore.blocks);
    expect(projectAfter.chapterDirty).toBe(projectBefore.chapterDirty);
    expect(projectAfter.past).toBe(projectBefore.past);
    expect(projectAfter.future).toBe(projectBefore.future);
  });

  it("throws the draft away on discard and reopens from the staged text", () => {
    renderProposal(rewriteOnly());
    fireEvent.click(screen.getByRole("button", { name: "Edit proposal" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Edit proposed rewrite" }),
      { target: { value: "The harbor burned." } },
    );

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    const pending = useAgentConsoleStore.getState().pendingProposal;
    expect(pending?.kind).toBe("manuscript");
    if (pending?.kind !== "manuscript") return;
    expect(pending.changes[0]?.change.newText).toBe(
      "The harbor waited under rain.",
    );
    expect(
      screen.queryByRole("textbox", { name: "Edit proposed rewrite" }),
    ).toBeNull();
    expect(screen.getByText("waited").tagName).toBe("INS");

    fireEvent.click(screen.getByRole("button", { name: "Edit proposal" }));

    expect(
      screen.getByRole("textbox", { name: "Edit proposed rewrite" }),
    ).toHaveProperty("value", "The harbor waited under rain.");
  });

  it("saves on the platform enter chord and discards on escape", () => {
    renderProposal(rewriteOnly());
    fireEvent.click(screen.getByRole("button", { name: "Edit proposal" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Edit proposed rewrite" }),
      { target: { value: "The harbor gleamed under rain." } },
    );

    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "Edit proposed rewrite" }),
      { key: "Enter", metaKey: true },
    );

    const saved = useAgentConsoleStore.getState().pendingProposal;
    expect(saved?.kind).toBe("manuscript");
    if (saved?.kind !== "manuscript") return;
    expect(saved.changes[0]?.change.newText).toBe(
      "The harbor gleamed under rain.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit proposal" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Edit proposed rewrite" }),
      { target: { value: "The harbor burned." } },
    );
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "Edit proposed rewrite" }),
      { key: "Escape" },
    );

    const pending = useAgentConsoleStore.getState().pendingProposal;
    expect(pending?.kind).toBe("manuscript");
    if (pending?.kind !== "manuscript") return;
    expect(pending.changes[0]?.change.newText).toBe(
      "The harbor gleamed under rain.",
    );
    expect(
      screen.queryByRole("textbox", { name: "Edit proposed rewrite" }),
    ).toBeNull();
  });

  it("renders the diff in manuscript prose type in both modes", () => {
    renderProposal(rewriteOnly());
    const preview = screen.getByText("waited").closest("p");
    expect(preview?.className).toContain(
      "text-[length:var(--prose-size,17.5px)]",
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit proposal" }));

    expect(screen.getByText("waited").closest("p")?.className).toContain(
      "text-[length:var(--prose-size,17.5px)]",
    );
  });

  it("keeps a stale rewrite frozen, compact, and disables edit and acceptance", () => {
    const current = proposal("proposal-stale-rewrite", [
      rewriteChange(
        "stale-rewrite",
        frozenBlocks,
        0,
        "The harbor waited under rain.",
      ),
    ]);
    useProjectStore.setState({
      blocks: frozenBlocks.map((block, index) =>
        index === 0
          ? narration("alpha", "The live harbor changed.")
          : structuredClone(block),
      ),
    });
    renderProposal(current);

    expect(screen.getByText("Stale rewrite")).toBeTruthy();
    const frozenText = screen.getByText("The harbor slept under rain.");
    const proposedText = screen.getByText("The harbor waited under rain.");
    expect(frozenText.className).not.toContain(
      "[&:not(:first-child)]:mt-6",
    );
    expect(proposedText.className).not.toContain(
      "[&:not(:first-child)]:mt-6",
    );
    expect(screen.getByText("Source changed - regenerate")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit proposal" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Accept" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Reject" })).toHaveProperty(
      "disabled",
      false,
    );
  });
});

describe("ManuscriptReviewSurface insert editing", () => {
  it("keeps narration insert typing canonical and accepts an empty staged value", () => {
    const current = proposal("proposal-insert", [
      insertChange(
        "insert-only",
        frozenBlocks,
        0,
        "A gull crossed the dark water.",
        "narration",
        null,
      ),
    ]);
    const { container } = renderProposal(current);
    const projectBefore = useProjectStore.getState();
    const row = container.querySelector('[data-review-row-kind="insert"]');
    expect(row).toBeInstanceOf(HTMLElement);
    if (!(row instanceof HTMLElement)) return;
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen.getByText("A gull crossed the dark water.").className,
    ).toContain("text-[length:var(--prose-size,17.5px)]");

    fireEvent.click(screen.getByRole("button", { name: "Edit proposal" }));

    const textbox = screen.getByRole("textbox", {
      name: "Edit proposed insert",
    });
    expect(textbox).toHaveProperty("value", "A gull crossed the dark water.");
    expect(textbox.closest("[data-capture-keyboard]")).toBeTruthy();
    expect(textbox.hasAttribute("data-prose-body")).toBe(false);
    expect(row.className).toContain("bg-accent-ink/15");

    fireEvent.change(textbox, { target: { value: "" } });

    expect(textbox).toHaveProperty("value", "");
    const staged = useAgentConsoleStore.getState().pendingProposal;
    expect(staged?.kind).toBe("manuscript");
    if (staged?.kind !== "manuscript") return;
    expect(staged.changes[0]?.change.newText).toBe(
      "A gull crossed the dark water.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const pending = useAgentConsoleStore.getState().pendingProposal;
    expect(pending?.kind).toBe("manuscript");
    if (pending?.kind !== "manuscript") return;
    expect(pending.changes[0]?.change.newText).toBe("");
    expect(screen.queryByRole("textbox")).toBeNull();
    const projectAfter = useProjectStore.getState();
    expect(projectAfter.blocks).toBe(projectBefore.blocks);
    expect(projectAfter.chapterDirty).toBe(projectBefore.chapterDirty);
    expect(projectAfter.past).toBe(projectBefore.past);
    expect(projectAfter.future).toBe(projectBefore.future);
  });

  it("edits only dialogue primary text while speaker and tail stay read-only and compact", () => {
    const base = insertChange(
      "dialogue-insert",
      frozenBlocks,
      0,
      "The tide is turning.",
      "dialogue",
      "Mara",
    );
    const dialogueChange: ManuscriptPendingChange = Object.assign({}, base, {
      change: Object.assign({}, base.change, {
        segments: [
          { kind: "beat", text: "She watched the channel." },
          { kind: "quote", text: "We leave at dawn." },
        ],
      }),
    });
    const { container } = renderProposal(
      proposal("proposal-dialogue-insert", [dialogueChange]),
    );
    const insertRow = container.querySelector(
      '[data-review-row-kind="insert"]',
    );
    expect(insertRow).toBeInstanceOf(HTMLElement);
    if (!(insertRow instanceof HTMLElement)) return;

    expect(within(insertRow).getByText("Mara")).toBeTruthy();
    const beat = within(insertRow).getByText("She watched the channel.");
    const quote = within(insertRow).getByText("We leave at dawn.");
    expect(beat.className).toContain("leading-[1.6]");
    expect(beat.className).not.toContain("[&:not(:first-child)]:mt-6");
    expect(quote.className).not.toContain("[&:not(:first-child)]:mt-6");
    expect(screen.queryByRole("textbox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit proposal" }));

    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    const textbox = screen.getByRole("textbox", {
      name: "Edit proposed insert",
    });

    fireEvent.change(textbox, {
      target: { value: "The tide has turned." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const pending = useAgentConsoleStore.getState().pendingProposal;
    expect(pending?.kind).toBe("manuscript");
    if (pending?.kind !== "manuscript") return;
    expect(pending.changes[0]?.change).toMatchObject({
      newText: "The tide has turned.",
      speaker: "Mara",
      segments: [
        { kind: "beat", text: "She watched the channel." },
        { kind: "quote", text: "We leave at dawn." },
      ],
    });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(within(insertRow).getByText("The tide has turned.")).toBeTruthy();
    expect(within(insertRow).getByText("Mara")).toBeTruthy();
  });

  it("renders a stale insert proposal read-only and disables acceptance", () => {
    const current = proposal("proposal-stale-insert", [
      insertChange(
        "stale-insert",
        frozenBlocks,
        0,
        "A gull crossed the dark water.",
        "narration",
        null,
      ),
    ]);
    useProjectStore.setState({
      blocks: frozenBlocks.map((block, index) =>
        index === 0
          ? narration("alpha", "The live harbor changed.")
          : structuredClone(block),
      ),
    });
    renderProposal(current);

    expect(screen.getByText("Stale insert")).toBeTruthy();
    expect(screen.getByText("A gull crossed the dark water.")).toBeTruthy();
    expect(
      screen.queryByRole("textbox", { name: "Edit proposed insert" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Edit proposal" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Accept" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Reject" })).toHaveProperty(
      "disabled",
      false,
    );
  });
});

describe("ManuscriptReviewSurface decisions and lifecycle", () => {
  it("accepts the latest edited value and keeps only the other change pending", () => {
    const current = proposal("proposal-accept-one", [
      rewriteChange(
        "rewrite-alpha",
        frozenBlocks,
        0,
        "The harbor waited under rain.",
      ),
      rewriteChange(
        "rewrite-bravo",
        frozenBlocks,
        1,
        "The bell answered twice.",
      ),
    ]);
    const { container } = renderProposal(current);
    const alphaRow = container.querySelector(
      '[data-agent-decision-change-id="rewrite-alpha"]',
    );
    expect(alphaRow).toBeInstanceOf(HTMLElement);
    if (!(alphaRow instanceof HTMLElement)) return;
    fireEvent.click(
      within(alphaRow).getByRole("button", { name: "Edit proposal" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Edit proposed rewrite" }),
      { target: { value: "The harbor gleamed under rain." } },
    );
    fireEvent.click(within(alphaRow).getByRole("button", { name: "Save" }));

    fireEvent.click(within(alphaRow).getByRole("button", { name: "Accept" }));

    expect(useProjectStore.getState().blocks[0]?.text).toBe(
      "The harbor gleamed under rain.",
    );
    expect(useProjectStore.getState().blocks[1]?.text).toBe(
      "The bell rang twice.",
    );
    expect(useProjectStore.getState().past).toHaveLength(1);
    const pending = useAgentConsoleStore.getState().pendingProposal;
    expect(pending?.kind).toBe("manuscript");
    if (pending?.kind !== "manuscript") return;
    expect(pending.changes.map((change) => change.id)).toEqual([
      "rewrite-bravo",
    ]);
    const remaining = container.querySelector(
      '[data-agent-decision-change-id="rewrite-bravo"]',
    );
    expect(remaining?.getAttribute("data-active-review-change")).toBe("true");
  });

  it("rejects one change without touching manuscript state", () => {
    const current = proposal("proposal-reject-one", [
      rewriteChange(
        "rewrite-alpha",
        frozenBlocks,
        0,
        "The harbor waited under rain.",
      ),
      removeChange("remove-bravo", frozenBlocks, 1),
    ]);
    const { container } = renderProposal(current);
    const projectBefore = useProjectStore.getState();
    const rejectRow = container.querySelector(
      '[data-agent-decision-change-id="rewrite-alpha"]',
    );
    expect(rejectRow).toBeInstanceOf(HTMLElement);
    if (!(rejectRow instanceof HTMLElement)) return;

    fireEvent.click(
      within(rejectRow).getByRole("button", { name: "Reject" }),
    );

    const projectAfter = useProjectStore.getState();
    expect(projectAfter.blocks).toBe(projectBefore.blocks);
    expect(projectAfter.chapterDirty).toBe(projectBefore.chapterDirty);
    expect(projectAfter.past).toBe(projectBefore.past);
    expect(projectAfter.future).toBe(projectBefore.future);
    const pending = useAgentConsoleStore.getState().pendingProposal;
    expect(pending?.kind).toBe("manuscript");
    if (pending?.kind !== "manuscript") return;
    expect(pending.changes.map((change) => change.id)).toEqual([
      "remove-bravo",
    ]);
  });

  it("reprojects a dependent move as stale after accepting a removal", () => {
    const current = proposal("proposal-dependent", [
      removeChange("remove-bravo", frozenBlocks, 1),
      moveChange("move-charlie", frozenBlocks, 2, 0),
    ]);
    const { container } = renderProposal(current);
    const removeRow = container.querySelector(
      '[data-agent-decision-change-id="remove-bravo"]',
    );
    expect(removeRow).toBeInstanceOf(HTMLElement);
    if (!(removeRow instanceof HTMLElement)) return;

    fireEvent.click(
      within(removeRow).getByRole("button", { name: "Accept" }),
    );

    expect(
      useProjectStore.getState().blocks.some((block) => block.id === "bravo"),
    ).toBe(false);
    expect(
      container.querySelector(
        '[data-review-row-kind="stale"][data-agent-change-id="move-charlie"]',
      ),
    ).toBeTruthy();
    expect(screen.getByText("Source changed - regenerate")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept All" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Reject All" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("accepts all fresh changes and removes the exhausted surface", () => {
    const current = proposal("proposal-accept-all", [
      rewriteChange(
        "rewrite-alpha",
        frozenBlocks,
        0,
        "The harbor waited under rain.",
      ),
      rewriteChange(
        "rewrite-bravo",
        frozenBlocks,
        1,
        "The bell answered twice.",
      ),
    ]);
    const { container } = renderProposal(current);

    fireEvent.click(screen.getByRole("button", { name: "Accept All" }));

    expect(
      useProjectStore.getState().blocks.slice(0, 2).map((block) => block.text),
    ).toEqual([
      "The harbor waited under rain.",
      "The bell answered twice.",
    ]);
    expect(useAgentConsoleStore.getState().pendingProposal).toBeNull();
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
    expect(container.querySelector('[data-slot="card"]')).toBeNull();
  });

  it("rejects all stale changes while preserving manuscript state", () => {
    const current = proposal("proposal-reject-all", [
      rewriteChange(
        "stale-rewrite",
        frozenBlocks,
        0,
        "The harbor waited under rain.",
      ),
    ]);
    const liveBlocks = frozenBlocks.map((block, index) =>
      index === 0
        ? narration("alpha", "The live harbor changed.")
        : structuredClone(block),
    );
    useProjectStore.setState({ blocks: liveBlocks });
    const { container } = renderProposal(current);

    fireEvent.click(screen.getByRole("button", { name: "Reject All" }));

    expect(useProjectStore.getState().blocks).toBe(liveBlocks);
    expect(useAgentConsoleStore.getState().pendingProposal).toBeNull();
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
    expect(container.querySelector('[data-slot="card"]')).toBeNull();
  });

  it("disables editing and every decision when ownership becomes unavailable", () => {
    const current = proposal("proposal-disabled", [
      rewriteChange(
        "rewrite-alpha",
        frozenBlocks,
        0,
        "The harbor waited under rain.",
      ),
      insertChange(
        "insert-alpha",
        frozenBlocks,
        0,
        "A gull crossed the water.",
        "narration",
        null,
      ),
    ]);
    renderProposal(current);

    act(() => {
      useAgentConsoleStore.setState({ hydratedProjectRoot: null });
    });

    expect(screen.getByRole("button", { name: "Accept All" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Reject All" })).toHaveProperty(
      "disabled",
      true,
    );
    for (const button of screen.getAllByRole("button", { name: "Accept" })) {
      expect(button).toHaveProperty("disabled", true);
    }
    for (const button of screen.getAllByRole("button", { name: "Reject" })) {
      expect(button).toHaveProperty("disabled", true);
    }
    for (const button of screen.getAllByRole("button", {
      name: "Edit proposal",
    })) {
      expect(button).toHaveProperty("disabled", true);
    }
    expect(screen.getByRole("button", { name: "Close Review" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("closes only view state and preserves the complete proposal", () => {
    const current = mixedProposal();
    renderProposal(current);
    const pendingBefore = useAgentConsoleStore.getState().pendingProposal;

    fireEvent.click(screen.getByRole("button", { name: "Close Review" }));

    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
    expect(useAgentConsoleStore.getState().pendingProposal).toBe(pendingBefore);
    expect(useAgentConsoleStore.getState().pendingProposal).toEqual(current);
  });

  it.each(["Accept", "Reject"] as const)(
    "%s on the final change exhausts the proposal and removes the surface",
    (decision) => {
      const current = proposal(`proposal-final-${decision.toLowerCase()}`, [
        rewriteChange(
          "rewrite-final",
          frozenBlocks,
          0,
          "The harbor waited under rain.",
        ),
      ]);
      const { container } = renderProposal(current);

      fireEvent.click(screen.getByRole("button", { name: decision }));

      expect(useAgentConsoleStore.getState().pendingProposal).toBeNull();
      expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
      expect(container.querySelector('[data-slot="card"]')).toBeNull();
      expect(useProjectStore.getState().blocks[0]?.text).toBe(
        decision === "Accept"
          ? "The harbor waited under rain."
          : "The harbor slept under rain.",
      );
    },
  );

  it("resets rewrite editing and navigation for a replacement proposal", () => {
    const current = mixedProposal();
    const { container, rerender } = renderProposal(current);
    fireEvent.click(screen.getByRole("button", { name: "Next change" }));
    const rewriteRow = container.querySelector(
      '[data-agent-decision-change-id="rewrite-1"]',
    );
    expect(rewriteRow).toBeInstanceOf(HTMLElement);
    if (!(rewriteRow instanceof HTMLElement)) return;
    fireEvent.click(
      within(rewriteRow).getByRole("button", { name: "Edit proposal" }),
    );
    expect(
      screen.getByRole("textbox", { name: "Edit proposed rewrite" }),
    ).toBeTruthy();

    const replacement = proposal("proposal-replacement", [
      rewriteChange(
        "replacement-rewrite",
        frozenBlocks,
        1,
        "The bell answered twice.",
      ),
      insertChange(
        "replacement-insert",
        frozenBlocks,
        1,
        "Footsteps crossed the quay.",
        "narration",
        null,
      ),
    ]);
    act(() => {
      useAgentConsoleStore.setState({ pendingProposal: replacement });
      useViewStore.getState().openManuscriptReview(replacement.id);
    });
    rerender(<ManuscriptReviewSurface proposal={replacement} />);

    expect(
      screen.queryByRole("textbox", { name: "Edit proposed rewrite" }),
    ).toBeNull();
    const first = container.querySelector("[data-agent-decision-change-id]");
    expect(first?.getAttribute("data-agent-decision-change-id")).toBe(
      "replacement-rewrite",
    );
    expect(first?.getAttribute("data-active-review-change")).toBe("true");
    expect(screen.getByRole("button", { name: "Previous change" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
