import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  readTextFile: vi.fn(),
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, generateText: mocks.generateText };
});

vi.mock("@/lib/tauri", () => ({
  compileProject: vi.fn(),
  createProject: vi.fn(),
  deleteChapterCmd: vi.fn(),
  getAiConfig: vi.fn().mockResolvedValue({ apiKey: "test-key" }),
  migrateToManaged: vi.fn(),
  openProject: vi.fn(),
  pickProjectDir: vi.fn(),
  readAppData: vi.fn().mockResolvedValue(null),
  readPdf: vi.fn().mockResolvedValue(null),
  readProjectMeta: vi.fn().mockResolvedValue(null),
  readTextFile: mocks.readTextFile,
  writeAppData: vi.fn().mockResolvedValue(undefined),
  writeProjectMeta: vi.fn().mockResolvedValue(undefined),
  writeSkeleton: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

import {
  createAgentController,
  stopAgentRun as stopProductionAgentRun,
  submitAgentRequest as submitProductionAgentRequest,
  type AgentControllerDependencies,
} from "@/lib/ai/agent-controller";
import {
  blockFingerprint,
  draftContextRefKey,
} from "@/lib/ai/agent-context";
import { modelContextWindow } from "@/lib/ai/agent-compaction";
import type {
  StreamAgentRunInput,
  StreamAgentRunResult,
} from "@/lib/ai/agent-runtime";
import type {
  AgentIntent,
  AgentMessageMetadata,
  AgentRun,
  AgentTask,
  AgentUIMessage,
  ContextSnapshot,
  DraftContextRef,
  PendingProposal,
  PersistedAgentState,
  PersistedUsage,
} from "@/lib/ai/agent-types";
import { parseChapter } from "@/lib/latex";
import { EMPTY_META } from "@/lib/migration";
import type {
  Block,
  ChapterOutline,
  ProjectInfo,
  ProjectMeta,
} from "@/lib/types";
import {
  EMPTY_AGENT_STATE,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useViewStore } from "@/stores/view-store";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

type StreamImplementation = (
  input: StreamAgentRunInput,
) => Promise<StreamAgentRunResult>;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function block(id: string, text: string, type: Block["type"]): Block {
  return { id, type, text, raw: text, dirty: true };
}

const activeBlocks: Block[] = [
  block("b1", "First live paragraph.", "narration"),
  block("note", "Private note.", "lore"),
  block("b2", "Middle live paragraph.", "narration"),
  block("b3", "Final live paragraph.", "narration"),
];

const chapters = [
  {
    id: "ch1",
    label: "1",
    title: "Chapter One",
    file: "chapters/one.tex",
    wordCount: 10,
  },
  {
    id: "ch2",
    label: "2",
    title: "Chapter Two",
    file: "chapters/two.tex",
    wordCount: 8,
  },
];

const project: ProjectInfo = {
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
  chapters,
};

const outlineChapter: ChapterOutline = {
  act: "setup",
  plotPoint: null,
  premise: "The door is locked.",
  goal: "Escape",
  conflict: "The key is missing",
  turn: "The window opens",
  characterIds: [],
  cards: [
    {
      id: "card-1",
      title: "Locked room",
      intention: "Establish the trap",
      characterIds: [],
      loreIds: [],
      continuityFlags: [],
    },
  ],
};

function projectMeta(): ProjectMeta {
  return {
    ...EMPTY_META,
    outline: { premise: "A detective is trapped." },
    chapters: { ch1: outlineChapter },
    lore: [
      {
        id: "lore-1",
        title: "The House",
        description: "No door opens twice.",
        characterIds: [],
        tags: ["setting"],
      },
    ],
  };
}

const usage: PersistedUsage = {
  modelId: "gpt-4.1",
  inputTokens: 20,
  outputTokens: 4,
  totalTokens: 24,
  contextWindow: 1_047_576,
  raw: {
    inputTokens: 20,
    inputTokenDetails: {
      noCacheTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    outputTokens: 4,
    outputTokenDetails: { textTokens: 4, reasoningTokens: 0 },
    totalTokens: 24,
  },
};

const compactingUsage: PersistedUsage = {
  ...usage,
  modelId: "gpt-3.5-turbo",
  inputTokens: 14_000,
  outputTokens: 100,
  totalTokens: 14_100,
  contextWindow: 16_385,
  raw: {
    ...usage.raw,
    inputTokens: 14_000,
    outputTokens: 100,
    totalTokens: 14_100,
  },
};

function metadata(
  run: AgentRun,
  state: AgentMessageMetadata["state"],
  retryOf: string | null,
): AgentMessageMetadata {
  return {
    runId: run.id,
    mode: run.mode,
    task: run.task,
    state,
    createdAt: run.startedAt,
    error: null,
    errorCode: null,
    retryOf,
    usage: null,
  };
}

function assistantMessage(
  input: StreamAgentRunInput,
  state: "streaming" | "complete",
  text: string,
): AgentUIMessage {
  return {
    id: input.generateMessageId(),
    role: "assistant",
    metadata: metadata(input.run, state, null),
    parts: [{ type: "text", text, state: state === "complete" ? "done" : "streaming" }],
  };
}

function successfulResult(
  input: StreamAgentRunInput,
  text: string,
): StreamAgentRunResult {
  return { message: assistantMessage(input, "complete", text), usage };
}

function makeDependencies(
  streamImplementation: StreamImplementation | null,
): AgentControllerDependencies & {
  stream: ReturnType<typeof vi.fn<(
    input: StreamAgentRunInput,
  ) => Promise<StreamAgentRunResult>>>;
} {
  let nextId = 0;
  const stream = vi.fn(
    streamImplementation ??
      (async (input: StreamAgentRunInput) => {
        input.onMessage(assistantMessage(input, "streaming", "Draft"));
        return successfulResult(input, "Draft response");
      }),
  );
  return {
    now: () => "2026-07-30T12:00:00.000Z",
    id: () => `agent-${++nextId}`,
    getModel: async () => new MockLanguageModelV3(),
    getContextWindow: async (_provider, modelId) => {
      const contextWindow = modelContextWindow(modelId, null);
      if (contextWindow === null) {
        throw new Error(`Missing test context metadata: ${modelId}`);
      }
      return contextWindow;
    },
    summarize: async () => "Compacted history",
    stream,
  };
}

function blockRef(blockId: string, chapterId: string): DraftContextRef {
  return { kind: "block", chapterId, blockId };
}

function conversationTask(chapterId: string): AgentTask {
  return { kind: "conversation", targetChapterId: chapterId };
}

function manuscriptProposalFixture(
  id: string,
  projectRoot: string,
  chapterId: string,
): PendingProposal {
  return {
    id,
    kind: "manuscript",
    projectRoot,
    chapterId,
    summary: `Manuscript proposal ${id}`,
    createdAt: "2026-07-30T12:00:00.000Z",
    originatingMessageId: "assistant-1",
    changes: [],
  };
}

function outlineProposalFixture(
  id: string,
  projectRoot: string,
  chapterId: string,
): PendingProposal {
  return {
    id,
    kind: "outline",
    projectRoot,
    chapterId,
    summary: `Outline proposal ${id}`,
    createdAt: "2026-07-30T12:00:00.000Z",
    originatingMessageId: "assistant-1",
    changes: [],
  };
}

interface CapturedToolRun {
  input: StreamAgentRunInput;
  finish: () => Promise<void>;
}

async function captureToolRun(): Promise<CapturedToolRun> {
  const pending = deferred<StreamAgentRunResult>();
  let captured: StreamAgentRunInput | null = null;
  const dependencies = makeDependencies(async (input) => {
    captured = input;
    return pending.promise;
  });
  const controller = createAgentController(dependencies);
  const submission = controller.submitAgentRequest({
    kind: "run",
    mode: "writing",
    text: "Stage a proposal.",
    refs: [],
    task: conversationTask("ch1"),
  });
  await vi.waitFor(() => expect(captured).not.toBeNull());
  if (captured === null) throw new Error("Expected captured stream input");
  const input = captured;
  return {
    input,
    finish: async () => {
      pending.resolve(successfulResult(input, "Proposal staged"));
      await submission;
    },
  };
}

function originalTurn(
  snapshots: ContextSnapshot[],
): { run: AgentRun; messages: AgentUIMessage[] } {
  const run: AgentRun = {
    id: "original-run",
    projectRoot: "/book",
    mode: "writing",
    task: {
      kind: "bridge",
      chapterId: "ch1",
      anchorBlockId: "b2",
      successorBlockId: "b3",
    },
    userMessageId: "original-user",
    attachments: snapshots,
    startedAt: "2026-07-29T12:00:00.000Z",
  };
  return {
    run,
    messages: [
      {
        id: run.userMessageId,
        role: "user",
        metadata: metadata(run, "complete", null),
        parts: [
          { type: "text", text: "Bridge these paragraphs." },
          { type: "data-context", data: { snapshots } },
        ],
      },
      {
        id: "original-assistant",
        role: "assistant",
        metadata: {
          ...metadata(run, "error", null),
          error: "Transport failed",
          errorCode: "transport",
        },
        parts: [{ type: "text", text: "Partial" }],
      },
    ],
  };
}

function persistedState(messages: AgentUIMessage[]): PersistedAgentState {
  return {
    v: 3,
    mode: "edit",
    messages,
    summary: null,
    draftText: "New project draft",
    draftContextRefs: [],
    draftSourceLocators: {},
    pendingProposal: null,
    lastUsage: null,
    interruptedRun: null,
  };
}

function compactionMessages(payloadLength: number): AgentUIMessage[] {
  const task = conversationTask("ch1");
  return Array.from({ length: 7 }, (_, index) => {
    const run: AgentRun = {
      id: `history-run-${index}`,
      projectRoot: "/book",
      mode: "writing",
      task,
      userMessageId: `history-user-${index}`,
      attachments: [],
      startedAt: "2026-07-28T12:00:00.000Z",
    };
    return [
      {
        id: run.userMessageId,
        role: "user" as const,
        metadata: metadata(run, "complete", null),
        parts: [
          {
            type: "text" as const,
            text: `Question ${index} ${"x".repeat(payloadLength)}`,
          },
        ],
      },
      {
        id: `history-assistant-${index}`,
        role: "assistant" as const,
        metadata: metadata(run, "complete", null),
        parts: [
          {
            type: "text" as const,
            text: `Answer ${index} ${"y".repeat(payloadLength)}`,
          },
        ],
      },
    ];
  }).flat();
}

beforeEach(() => {
  mocks.generateText.mockReset().mockResolvedValue({ text: "Compacted history" });
  mocks.readTextFile.mockReset().mockImplementation(async (_root, path) => {
    if (path === "chapters/two.tex") {
      return "Inactive first.\n\nInactive target.\n";
    }
    return "Disk first.\n\nDisk middle.\n\nDisk final.\n";
  });
  useAgentConsoleStore.setState({
    ...EMPTY_AGENT_STATE,
    messages: [],
    draftContextRefs: [],
    draftContextSources: {},
    draftSourceLocators: {},
    requestedProjectRoot: "/book",
    activeProjectRoot: "/book",
    hydratedProjectRoot: "/book",
  });
  useProjectStore.setState({
    status: "ready",
    project,
    meta: projectMeta(),
    activeChapterId: "ch1",
    blocks: activeBlocks,
    selectedId: "b2",
    selectedIds: [],
    chapterDirty: true,
  });
  useSettingsStore.setState({
    aiProvider: "openai",
    aiModel: "gpt-4.1",
    styleGuide: "Keep the clipped voice.",
    editingRules: "Preserve intentional fragments.",
  });
  useViewStore.setState(useViewStore.getInitialState(), true);
  useViewStore.setState({ aiOpen: false });
});

describe("dispatchAgentIntent", () => {
  it("opens the console and resolves add-context without starting a run", async () => {
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);

    await controller.dispatchAgentIntent({
      kind: "add-context",
      refs: [blockRef("b1", "ch1")],
    });

    expect(useViewStore.getState()).toMatchObject({
      aiOpen: true,
      focus: false,
    });
    expect(dependencies.stream).not.toHaveBeenCalled();
    expect(useAgentConsoleStore.getState().draftContextRefs).toEqual([
      blockRef("b1", "ch1"),
    ]);
    expect(
      useAgentConsoleStore.getState().draftContextSources["block:ch1:b1"],
    ).toMatchObject({
      available: true,
      preview: "First live paragraph.",
    });
  });

  it("freezes a new active ref before an earlier inactive ref finishes loading", async () => {
    const inactiveSource = "Inactive first.\n\nInactive target.\n";
    const inactiveBlocks = parseChapter(inactiveSource);
    const inactiveRef = blockRef("stale-inactive", "ch2");
    const delayedRead = deferred<string>();
    mocks.readTextFile.mockImplementationOnce(async () => delayedRead.promise);
    const controller = createAgentController(makeDependencies(null));
    const store = useAgentConsoleStore.getState();
    store.setDraftContextRefs([inactiveRef]);
    useAgentConsoleStore.setState({
      draftSourceLocators: {
        [draftContextRefKey(inactiveRef)]: {
          order: 1,
          sourceFingerprint: blockFingerprint(inactiveBlocks[1]),
        },
      },
    });

    const activeRef = blockRef("b1", "ch1");
    const adding = controller.dispatchAgentIntent({
      kind: "add-context",
      refs: [activeRef],
    });
    await vi.waitFor(() => expect(mocks.readTextFile).toHaveBeenCalled());
    if (activeRef.kind !== "block") {
      throw new Error("Expected an active block reference");
    }
    activeRef.blockId = "b2";
    useProjectStore.setState({
      activeChapterId: "ch2",
      blocks: parseChapter(inactiveSource),
    });
    delayedRead.resolve(inactiveSource);
    await adding;

    const state = useAgentConsoleStore.getState();
    expect(state.draftContextRefs).toHaveLength(2);
    const relocatedInactiveRef = state.draftContextRefs[0];
    expect(relocatedInactiveRef).toMatchObject({
      kind: "block",
      chapterId: "ch2",
    });
    expect(state.draftContextRefs[1]).toEqual(blockRef("b1", "ch1"));
    expect(
      state.draftContextSources[draftContextRefKey(relocatedInactiveRef)],
    ).toMatchObject({
      available: true,
      preview: "Inactive target.",
      resolved: { chapterId: "ch2", order: 1 },
    });
    expect(state.draftContextSources["block:ch1:b1"]).toMatchObject({
      available: true,
      preview: "First live paragraph.",
      resolved: {
        chapterId: "ch1",
        sourceId: "b1",
        order: 0,
      },
    });
    expect(state.draftSourceLocators).toMatchObject({
      [draftContextRefKey(relocatedInactiveRef)]: {
        order: 1,
        sourceFingerprint: blockFingerprint(inactiveBlocks[1]),
      },
      "block:ch1:b1": {
        order: 0,
        sourceFingerprint: blockFingerprint(activeBlocks[0]),
      },
    });
  });

  it("returns visible typed feedback instead of resolving context during a cross-root transition", async () => {
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);
    const store = useAgentConsoleStore.getState();
    store.resetProject();
    const transition = store.beginPersistenceTransition("/book", "load");

    const dispatching = controller.dispatchAgentIntent({
      kind: "add-context",
      refs: [blockRef("b1", "ch1")],
    });
    useAgentConsoleStore.getState().finishPersistenceTransition(transition);
    await dispatching;

    expect(useAgentConsoleStore.getState()).toMatchObject({
      draftContextRefs: [],
      draftContextSources: {},
      runError: {
        code: "transition",
        message: expect.stringContaining("loading"),
      },
    });
    expect(mocks.readTextFile).not.toHaveBeenCalled();
    expect(dependencies.stream).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "focus",
      intent: { kind: "focus", mode: "edit" } as const,
    },
    {
      name: "add-context",
      intent: {
        kind: "add-context",
        refs: [blockRef("b2", "ch1")],
      } as const,
    },
    {
      name: "prefill",
      intent: {
        kind: "prefill",
        mode: "edit",
        text: "Rejected prefill",
        refs: [blockRef("b2", "ch1")],
      } as const,
    },
  ])("rejects $name author mutations during a same-root transition", async ({ intent }) => {
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);
    const store = useAgentConsoleStore.getState();
    store.setDraftText("Owned draft");
    store.addDraftContextRefs([blockRef("b1", "ch1")]);
    store.beginPersistenceTransition("/book", "load");

    await controller.dispatchAgentIntent(intent);

    expect(useAgentConsoleStore.getState()).toMatchObject({
      mode: "writing",
      draftText: "Owned draft",
      draftContextRefs: [blockRef("b1", "ch1")],
      runError: {
        code: "transition",
        message: expect.stringContaining("loading"),
      },
    });
    expect(dependencies.stream).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "Add to Chat",
      intent: {
        kind: "add-context",
        refs: [blockRef("inactive", "ch2")],
      } as const,
    },
    {
      name: "prefill",
      intent: {
        kind: "prefill",
        mode: "edit",
        text: "Review the inactive passage.",
        refs: [blockRef("inactive", "ch2")],
      } as const,
    },
  ])("replaces a stale run error when a later $name fails", async ({ intent }) => {
    mocks.readTextFile.mockRejectedValueOnce(
      new Error("Current context resolution failed"),
    );
    useAgentConsoleStore.setState({
      runError: { code: "transport", message: "Stale run failure" },
    });
    const controller = createAgentController(makeDependencies(null));

    await controller.dispatchAgentIntent(intent);

    expect(useAgentConsoleStore.getState().runError).toEqual({
      code: "unknown",
      message: "Current context resolution failed",
    });
  });

  it("resolves a message-wide finding index across multiple findings parts", async () => {
    const run: AgentRun = {
      id: "findings-run",
      projectRoot: "/book",
      mode: "writing",
      task: { kind: "chapter-analysis", chapterId: "ch1", analysis: "critique" },
      userMessageId: "findings-user",
      attachments: [],
      startedAt: "2026-07-30T12:00:00.000Z",
    };
    const findingsMessage: AgentUIMessage = {
      id: "assistant-findings",
      role: "assistant",
      metadata: metadata(run, "complete", null),
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
        {
          type: "data-findings",
          data: {
            kind: "critique",
            chapterId: "ch1",
            items: [
              {
                kind: "strength",
                tag: "Voice",
                text: "The restraint lands.",
                blockIds: [],
              },
            ],
          },
        },
      ],
    };
    useAgentConsoleStore.setState({ messages: [findingsMessage] });
    const controller = createAgentController(makeDependencies(null));

    await controller.dispatchAgentIntent({
      kind: "add-context",
      refs: [
        {
          kind: "finding",
          chapterId: "ch1",
          findingId: "assistant-findings:1",
        },
      ],
    });

    expect(
      useAgentConsoleStore.getState().draftContextSources[
        "finding:ch1:assistant-findings:1"
      ],
    ).toMatchObject({
      available: true,
      label: "Voice",
      preview: "The restraint lands.",
    });
  });

  it("prefills or focuses without submitting", async () => {
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);
    await controller.dispatchAgentIntent({
      kind: "add-context",
      refs: [blockRef("b1", "ch1")],
    });

    await controller.dispatchAgentIntent({
      kind: "prefill",
      mode: "edit",
      text: "Tighten this.",
      refs: [blockRef("b2", "ch1")],
    });
    expect(useAgentConsoleStore.getState()).toMatchObject({
      mode: "edit",
      draftText: "Tighten this.",
      draftContextRefs: [blockRef("b2", "ch1")],
    });
    expect(
      Object.keys(useAgentConsoleStore.getState().draftContextSources),
    ).toEqual(["block:ch1:b2"]);

    await controller.dispatchAgentIntent({ kind: "focus", mode: "writing" });
    expect(useAgentConsoleStore.getState().mode).toBe("writing");
    expect(dependencies.stream).not.toHaveBeenCalled();
  });

  it("refreshes attached block and outline sources when live project data changes", async () => {
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);
    const cardRef: DraftContextRef = {
      kind: "outline-card",
      chapterId: "ch1",
      cardId: "card-1",
    };
    await controller.dispatchAgentIntent({
      kind: "add-context",
      refs: [blockRef("b1", "ch1"), cardRef],
    });

    const changedMeta = structuredClone(useProjectStore.getState().meta);
    changedMeta.chapters.ch1.cards[0] = {
      ...changedMeta.chapters.ch1.cards[0],
      intention: "Reveal the trap",
    };
    useProjectStore.setState({
      blocks: [
        block("b1", "Edited live paragraph.", "narration"),
        ...activeBlocks.slice(1),
      ],
      meta: changedMeta,
    });

    await vi.waitFor(() => {
      expect(
        useAgentConsoleStore.getState().draftContextSources["block:ch1:b1"]
          .preview,
      ).toBe("Edited live paragraph.");
      expect(
        useAgentConsoleStore.getState().draftContextSources[
          "outline-card:ch1:card-1"
        ].preview,
      ).toContain("Reveal the trap");
    });
  });

  it("refreshes retained composer sources after an immediate run settles", async () => {
    const pending = deferred<StreamAgentRunResult>();
    let captured: StreamAgentRunInput | null = null;
    const dependencies = makeDependencies(async (input) => {
      captured = input;
      return pending.promise;
    });
    const controller = createAgentController(dependencies);
    await controller.dispatchAgentIntent({
      kind: "add-context",
      refs: [blockRef("b1", "ch1")],
    });

    const submission = controller.submitAgentRequest({
      kind: "run",
      mode: "writing",
      text: "Continue.",
      refs: [],
      task: conversationTask("ch1"),
    });
    await vi.waitFor(() => expect(captured).not.toBeNull());
    useProjectStore.setState({
      blocks: [
        block("b1", "Edited while streaming.", "narration"),
        ...activeBlocks.slice(1),
      ],
    });

    if (captured === null) throw new Error("Expected captured stream input");
    pending.resolve(successfulResult(captured, "Finished"));
    await submission;

    await vi.waitFor(() => {
      expect(
        useAgentConsoleStore.getState().draftContextSources["block:ch1:b1"]
          .preview,
      ).toBe("Edited while streaming.");
    });
  });

  it("preserves an unrelated composer draft during an immediate run", async () => {
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);
    useAgentConsoleStore.getState().setDraftText("Unsent composer text");
    useAgentConsoleStore.getState().addDraftContextRefs([blockRef("b1", "ch1")]);

    await controller.dispatchAgentIntent({
      kind: "run",
      mode: "edit",
      text: "Critique the middle.",
      refs: [blockRef("b2", "ch1")],
      task: conversationTask("ch1"),
    });

    expect(useAgentConsoleStore.getState()).toMatchObject({
      draftText: "Unsent composer text",
      draftContextRefs: [blockRef("b1", "ch1")],
      mode: "edit",
    });
    expect(dependencies.stream).toHaveBeenCalledOnce();
  });

  it("resolves product run failures without erasing their typed error", async () => {
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    useSettingsStore.setState({ aiModel: null });

    await controller.dispatchAgentIntent({
      kind: "run",
      mode: "writing",
      text: "Continue.",
      refs: [],
      task: conversationTask("ch1"),
    });

    expect(useAgentConsoleStore.getState()).toMatchObject({
      runStatus: "idle",
      runError: {
        code: "configuration",
        message: "Select an AI model in Settings before using AI features.",
      },
      messages: [],
    });
    expect(dependencies.stream).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "Agent run failed",
      expect.objectContaining({
        code: "configuration",
        message: "Select an AI model in Settings before using AI features.",
        phase: "configuration",
        projectRoot: "/book",
      }),
    );
    consoleError.mockRestore();
  });

  it("does not report model metadata transport failures as missing configuration", async () => {
    const dependencies = makeDependencies(null);
    dependencies.getContextWindow = async () => {
      const error = new Error("Model metadata service unavailable") as Error & {
        status: number;
      };
      error.status = 503;
      throw error;
    };
    const controller = createAgentController(dependencies);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await controller.dispatchAgentIntent({
      kind: "run",
      mode: "writing",
      text: "Continue.",
      refs: [],
      task: conversationTask("ch1"),
    });

    expect(useAgentConsoleStore.getState().runError).toEqual({
      code: "transport",
      message: "HTTP 503 - Model metadata service unavailable",
    });
    expect(dependencies.stream).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "Agent run failed",
      expect.objectContaining({
        code: "transport",
        message: "HTTP 503 - Model metadata service unavailable",
        phase: null,
      }),
    );
    consoleError.mockRestore();
  });
});

describe("frozen run preflight", () => {
  it("freezes root, mode, task, attachments, and dispatched bridge successor", async () => {
    let chapterRead: Awaited<
      ReturnType<StreamAgentRunInput["environment"]["readChapter"]>
    > | null = null;
    const dependencies = makeDependencies(async (input) => {
      chapterRead = await input.environment.readChapter("ch1");
      return successfulResult(input, "Bridge ready");
    });
    const controller = createAgentController(dependencies);

    await controller.dispatchAgentIntent({
      kind: "run",
      mode: "writing",
      text: "Bridge the scene.",
      refs: [blockRef("b1", "ch1")],
      task: {
        kind: "bridge",
        chapterId: "ch1",
        anchorBlockId: "b2",
        successorBlockId: "b3",
      },
    });

    const input = dependencies.stream.mock.calls[0][0];
    expect(input.run).toMatchObject({
      projectRoot: "/book",
      mode: "writing",
      task: {
        kind: "bridge",
        chapterId: "ch1",
        anchorBlockId: "b2",
        successorBlockId: "b3",
      },
    });
    expect(input.run.attachments).toHaveLength(1);
    expect(input.run.attachments[0]).toMatchObject({
      sourceId: "b1",
      exactText: "First live paragraph.",
    });
    expect(chapterRead?.blocks.map((current) => current.id)).toEqual([
      "b1",
      "note",
      "b2",
      "b3",
    ]);
    expect(input.instructions).toContain("APROPROSE WRITING MODE");
    expect(input.instructions).toContain("Keep the clipped voice.");
  });

  it.each(["critique", "continuity"] as const)(
    "freezes the outer and nested %s model and preferences across preflight races",
    async (analysis) => {
      const source = deferred<string>();
      mocks.readTextFile.mockImplementationOnce(async () => source.promise);
      mocks.generateText.mockResolvedValue(
        analysis === "critique"
          ? { output: { notes: [] } }
          : { output: { flags: [] } },
      );
      const frozenModel = new MockLanguageModelV3();
      const dependencies = makeDependencies(async (input) => {
        useSettingsStore.setState({
          aiProvider: "openrouter",
          aiModel: "gpt-5-mini",
          styleGuide: "Changed immediately before analysis.",
          editingRules: "Changed nested editing rules.",
        });
        if (analysis === "critique") {
          await input.environment.runCritique("ch2", null, input.signal);
        } else {
          await input.environment.runContinuity("ch2", null, input.signal);
        }
        return successfulResult(input, "Analysis complete");
      });
      const getModel = vi.fn(async (_modelId?: string) => frozenModel);
      dependencies.getModel = getModel;
      const controller = createAgentController(dependencies);

      const submission = controller.submitAgentRequest({
        kind: "run",
        mode: "edit",
        text: `Run ${analysis}.`,
        refs: [],
        task: { kind: "chapter-analysis", chapterId: "ch2", analysis },
      });
      await vi.waitFor(() => expect(mocks.readTextFile).toHaveBeenCalledOnce());
      useSettingsStore.setState({
        aiProvider: "openrouter",
        aiModel: "gpt-5",
        styleGuide: "Changed during preflight.",
        editingRules: "Changed preflight editing rules.",
      });
      source.resolve("Frozen first.\n\nFrozen target.\n");
      await submission;

      expect(getModel).toHaveBeenCalledExactlyOnceWith("openai", "gpt-4.1");
      const input = dependencies.stream.mock.calls[0][0];
      expect(input.model).toBe(frozenModel);
      expect(input.modelId).toBe("gpt-4.1");
      expect(input.contextWindow).toBe(1_047_576);
      expect(input.instructions).toContain("Keep the clipped voice.");
      expect(input.instructions).toContain("Preserve intentional fragments.");
      expect(input.instructions).not.toContain("Changed during preflight.");
      expect(input.instructions).not.toContain(
        "Changed immediately before analysis.",
      );
      const generation = mocks.generateText.mock.calls[0][0] as unknown as {
        model: unknown;
        system: string;
      };
      expect(generation.model).toBe(frozenModel);
      expect(generation.system).toContain("Keep the clipped voice.");
      expect(generation.system).not.toContain("Changed during preflight.");
      expect(generation.system).not.toContain(
        "Changed immediately before analysis.",
      );
    },
  );

  it("freezes retry model and preferences before deferred model construction", async () => {
    const frozenModel = new MockLanguageModelV3();
    const model = deferred<MockLanguageModelV3>();
    const turn = originalTurn([]);
    useAgentConsoleStore.setState({ messages: turn.messages });
    useSettingsStore.setState({
      aiProvider: "openai",
      aiModel: "gpt-4.1",
      styleGuide: "Retry captured voice.",
      editingRules: "Retry captured editing rules.",
    });
    const dependencies = makeDependencies(null);
    const getModel = vi.fn(async (_modelId?: string) => model.promise);
    dependencies.getModel = getModel;
    const controller = createAgentController(dependencies);

    const retrying = controller.retryAgentTurn("original-user");
    await vi.waitFor(() => expect(getModel).toHaveBeenCalled());
    useSettingsStore.setState({
      aiProvider: "openrouter",
      aiModel: "gpt-5",
      styleGuide: "Changed retry voice.",
      editingRules: "Changed retry editing rules.",
    });
    model.resolve(frozenModel);
    await retrying;

    expect(getModel).toHaveBeenCalledExactlyOnceWith("openai", "gpt-4.1");
    const input = dependencies.stream.mock.calls[0][0];
    expect(input.model).toBe(frozenModel);
    expect(input.modelId).toBe("gpt-4.1");
    expect(input.instructions).toContain("Retry captured voice.");
    expect(input.instructions).toContain("Retry captured editing rules.");
    expect(input.instructions).not.toContain("Changed retry voice.");
    expect(input.instructions).not.toContain("Changed retry editing rules.");
  });

  it("captures a composer click before text typed for the next turn", async () => {
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);
    const store = useAgentConsoleStore.getState();
    store.setDraftText("Captured request");

    const submission = controller.submitAgentDraft(conversationTask("ch1"));
    store.setDraftText("Next request");
    await submission;

    const input = dependencies.stream.mock.calls[0][0];
    expect(input.messages.at(-1)?.parts[0]).toEqual({
      type: "text",
      text: "Captured request",
    });
    expect(useAgentConsoleStore.getState().draftText).toBe("Next request");
  });

  it("clones every external request input before the first await", async () => {
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);
    const request: Extract<AgentIntent, { kind: "run" }> = {
      kind: "run",
      mode: "writing",
      text: "Use the opening.",
      refs: [blockRef("b1", "ch1")],
      task: conversationTask("ch1"),
    };

    const submission = controller.submitAgentRequest(request);
    request.mode = "edit";
    request.text = "Mutated request";
    const mutableRef = request.refs[0];
    if (mutableRef.kind !== "block") {
      throw new Error("Expected a block request reference");
    }
    mutableRef.blockId = "b2";
    if (request.task.kind !== "conversation") {
      throw new Error("Expected a conversation request task");
    }
    request.task.targetChapterId = "ch2";
    await submission;

    const input = dependencies.stream.mock.calls[0][0];
    expect(input.run).toMatchObject({
      mode: "writing",
      task: conversationTask("ch1"),
      attachments: [expect.objectContaining({ sourceId: "b1" })],
    });
    expect(input.messages.at(-1)?.parts[0]).toEqual({
      type: "text",
      text: "Use the opening.",
    });
  });

  it.each([
    {
      name: "Suggest",
      request: {
        kind: "run",
        mode: "writing",
        text: "Suggest from here.",
        refs: [blockRef("b1", "ch1")],
        task: conversationTask("ch1"),
      },
      sourceId: "b1",
      exactText: "First live paragraph.",
      order: 0,
    },
    {
      name: "Clean",
      request: {
        kind: "run",
        mode: "edit",
        text: "Clean this.",
        refs: [blockRef("b2", "ch1")],
        task: {
          kind: "selected-block-edit",
          chapterId: "ch1",
          blockIds: ["b2"],
          operation: "clean",
        },
      },
      sourceId: "b2",
      exactText: "Middle live paragraph.",
      order: 2,
    },
    {
      name: "Pick Up with a successor",
      request: {
        kind: "run",
        mode: "writing",
        text: "Bridge this.",
        refs: [blockRef("b2", "ch1")],
        task: {
          kind: "bridge",
          chapterId: "ch1",
          anchorBlockId: "b2",
          successorBlockId: "b3",
        },
      },
      sourceId: "b2",
      exactText: "Middle live paragraph.",
      order: 2,
    },
    {
      name: "Pick Up with a null successor",
      request: {
        kind: "run",
        mode: "writing",
        text: "Continue this.",
        refs: [blockRef("b3", "ch1")],
        task: {
          kind: "bridge",
          chapterId: "ch1",
          anchorBlockId: "b3",
          successorBlockId: null,
        },
      },
      sourceId: "b3",
      exactText: "Final live paragraph.",
      order: 3,
    },
  ] satisfies Array<{
    name: string;
    request: Extract<AgentIntent, { kind: "run" }>;
    sourceId: string;
    exactText: string;
    order: number;
  }>)(
    "captures $name inputs before deferred model lookup",
    async ({ request, sourceId, exactText, order }) => {
      const model = deferred<MockLanguageModelV3>();
      let modelRequested = false;
      let frozenChapterIds: string[] = [];
      const dependencies = makeDependencies(async (input) => {
        const frozenChapter = await input.environment.readChapter("ch1");
        frozenChapterIds = frozenChapter.blocks.map((current) => current.id);
        return successfulResult(input, "Finished");
      });
      dependencies.getModel = async () => {
        modelRequested = true;
        return model.promise;
      };
      const controller = createAgentController(dependencies);

      const submission = controller.dispatchAgentIntent(request);
      await vi.waitFor(() => expect(modelRequested).toBe(true));
      useProjectStore.setState({
        blocks: [
          activeBlocks[0],
          activeBlocks[2],
          block("inserted-middle", "Inserted middle.", "narration"),
          activeBlocks[3],
          block("inserted-tail", "Inserted tail.", "narration"),
          activeBlocks[1],
        ],
      });
      useProjectStore.setState({
        activeChapterId: "ch2",
        blocks: [block("other", "Other chapter.", "narration")],
      });
      model.resolve(new MockLanguageModelV3());
      await submission;

      const input = dependencies.stream.mock.calls[0][0];
      expect(input.run.task).toEqual(request.task);
      expect(input.run.attachments).toEqual([
        expect.objectContaining({ sourceId, exactText, order }),
      ]);
      expect(frozenChapterIds).toEqual([
        "b1",
        "note",
        "b2",
        "b3",
      ]);
    },
  );

  it("resolves an inactive Outline Sculpt run before deferred model lookup", async () => {
    const initialSource = "Before model first.\n\nBefore model target.\n";
    const changedSource = "Changed after model first.\n\nChanged after model target.\n";
    const initialBlocks = parseChapter(initialSource);
    const inactiveRef = blockRef("stale-outline-source", "ch2");
    const releaseReads = deferred<void>();
    const model = deferred<MockLanguageModelV3>();
    let diskSource = initialSource;
    let readStarts = 0;
    let readCompletions = 0;
    let readStartsAtModelLookup = -1;
    let readCompletionsAtModelLookup = -1;
    let modelRequested = false;
    let frozenChapterText: string[] = [];
    let frozenOutline: Awaited<
      ReturnType<StreamAgentRunInput["environment"]["readOutline"]>
    > | null = null;
    mocks.readTextFile.mockImplementation(async (_root, path) => {
      if (path !== "chapters/two.tex") {
        throw new Error(`Unexpected chapter read: ${path}`);
      }
      const capturedSource = diskSource;
      readStarts += 1;
      await releaseReads.promise;
      readCompletions += 1;
      return capturedSource;
    });
    useProjectStore.setState((state) => ({
      meta: {
        ...state.meta,
        outline: { premise: "Initial outline premise" },
        chapters: {
          ...state.meta.chapters,
          ch2: {
            ...outlineChapter,
            act: "confrontation",
            cards: [
              {
                id: "ch2-card-initial",
                title: "Initial road turn",
                intention: "Force the detective onward",
                characterIds: [],
                loreIds: [],
                continuityFlags: [],
              },
            ],
          },
        },
      },
    }));
    useAgentConsoleStore.setState({
      draftSourceLocators: {
        [draftContextRefKey(inactiveRef)]: {
          order: 1,
          sourceFingerprint: blockFingerprint(initialBlocks[1]),
        },
      },
    });
    const dependencies = makeDependencies(async (input) => {
      const chapter = await input.environment.readChapter("ch2");
      frozenChapterText = chapter.blocks.map((current) => current.text);
      frozenOutline = await input.environment.readOutline("ch2");
      return successfulResult(input, "Sculpted");
    });
    dependencies.getModel = async () => {
      readStartsAtModelLookup = readStarts;
      readCompletionsAtModelLookup = readCompletions;
      modelRequested = true;
      return model.promise;
    };
    const controller = createAgentController(dependencies);

    const submission = controller.dispatchAgentIntent({
      kind: "run",
      mode: "edit",
      text: "Sculpt the second chapter.",
      refs: [inactiveRef],
      task: { kind: "outline-sculpt", chapterId: "ch2" },
    });
    await vi.waitFor(() =>
      expect(readStarts > 0 || modelRequested).toBe(true),
    );
    releaseReads.resolve(undefined);
    await vi.waitFor(() => expect(modelRequested).toBe(true));
    diskSource = changedSource;
    const current = useProjectStore.getState();
    if (current.project === null) {
      throw new Error("Expected an active project");
    }
    useProjectStore.setState({
      project: {
        ...current.project,
        chapters: current.project.chapters.map((chapter) =>
          chapter.id === "ch2"
            ? { ...chapter, title: "Changed Chapter Two" }
            : chapter,
        ),
      },
      meta: {
        ...current.meta,
        outline: { premise: "Changed outline premise" },
        chapters: {
          ...current.meta.chapters,
          ch2: {
            ...current.meta.chapters.ch2,
            cards: [
              {
                id: "ch2-card-changed",
                title: "Changed road turn",
                intention: "Change the plan",
                characterIds: [],
                loreIds: [],
                continuityFlags: [],
              },
            ],
          },
        },
      },
    });
    model.resolve(new MockLanguageModelV3());
    await submission;

    expect(readStartsAtModelLookup).toBeGreaterThan(0);
    expect(readCompletionsAtModelLookup).toBe(readStartsAtModelLookup);
    const input = dependencies.stream.mock.calls[0][0];
    expect(input.run).toMatchObject({
      task: { kind: "outline-sculpt", chapterId: "ch2" },
      attachments: [
        expect.objectContaining({
          chapterId: "ch2",
          exactText: "Before model target.",
          order: 1,
        }),
      ],
    });
    expect(frozenChapterText).toEqual([
      "Before model first.",
      "Before model target.",
    ]);
    expect(frozenOutline).toMatchObject({
      premise: "Initial outline premise",
      chapters: [
        {
          chapterId: "ch2",
          title: "Chapter Two",
          cards: [
            {
              id: "ch2-card-initial",
              title: "Initial road turn",
              intention: "Force the detective onward",
            },
          ],
        },
      ],
    });
  });

  it("rejects an invalid dispatched bridge anchor before model lookup", async () => {
    const dependencies = makeDependencies(null);
    const getModel = vi.fn(async () => new MockLanguageModelV3());
    dependencies.getModel = getModel;
    const controller = createAgentController(dependencies);

    await expect(
      controller.submitAgentRequest({
        kind: "run",
        mode: "writing",
        text: "Bridge this.",
        refs: [],
        task: {
          kind: "bridge",
          chapterId: "ch1",
          anchorBlockId: "missing-anchor",
          successorBlockId: null,
        },
      }),
    ).rejects.toThrow("Bridge anchor not found: missing-anchor");

    expect(getModel).not.toHaveBeenCalled();
    expect(dependencies.stream).not.toHaveBeenCalled();
  });

  it("rejects submission immediately while persistence owns a transition", async () => {
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);
    useAgentConsoleStore
      .getState()
      .setDraftText("Do not queue this request");
    const transition = useAgentConsoleStore
      .getState()
      .beginPersistenceTransition("/book", "load");

    const submission = controller.submitAgentDraft(conversationTask("ch1"));
    useAgentConsoleStore.getState().finishPersistenceTransition(transition);

    await expect(submission).rejects.toMatchObject({
      name: "AgentConsoleOwnershipError",
      agentErrorCode: "transition",
    });
    expect(dependencies.stream).not.toHaveBeenCalled();
    expect(useAgentConsoleStore.getState()).toMatchObject({
      runStatus: "idle",
      draftText: "Do not queue this request",
      messages: [],
    });
  });

  it("rejects a root mismatch even when no transition token remains", async () => {
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);
    useAgentConsoleStore.setState({ hydratedProjectRoot: "/other-book" });

    await expect(
      controller.submitAgentRequest({
        kind: "run",
        mode: "writing",
        text: "Never run this against the wrong root.",
        refs: [],
        task: conversationTask("ch1"),
      }),
    ).rejects.toMatchObject({ name: "AgentConsoleOwnershipError" });
    expect(dependencies.stream).not.toHaveBeenCalled();
    expect(useAgentConsoleStore.getState().runStatus).toBe("idle");
  });

  it("relocates an inactive persisted block ref and snapshots current text", async () => {
    const parsed = parseChapter("Inactive first.\n\nInactive target.\n");
    const staleRef = blockRef("stale-id", "ch2");
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);
    useAgentConsoleStore.getState().setDraftText("Use the attached passage.");
    useAgentConsoleStore.getState().setDraftContextRefs([staleRef]);
    useAgentConsoleStore.setState({
      draftSourceLocators: {
        "block:ch2:stale-id": {
          order: 1,
          sourceFingerprint: blockFingerprint(parsed[1]),
        },
      },
    });

    await controller.submitAgentDraft(conversationTask("ch1"));

    const attachment = dependencies.stream.mock.calls[0][0].run.attachments[0];
    expect(attachment.sourceId).not.toBe("stale-id");
    expect(attachment).toMatchObject({
      chapterId: "ch2",
      order: 1,
      exactText: "Inactive target.",
    });
    expect(mocks.readTextFile).toHaveBeenCalledWith(
      "/book",
      "chapters/two.tex",
    );
  });

  it.each([
    ["stale first", [blockRef("legacy-b1", "ch1"), blockRef("b1", "ch1")]],
    ["current first", [blockRef("b1", "ch1"), blockRef("legacy-b1", "ch1")]],
  ])(
    "deduplicates a relocation collision with the current ref as survivor: %s",
    async (_label, refs) => {
      const dependencies = makeDependencies(null);
      const controller = createAgentController(dependencies);
      const store = useAgentConsoleStore.getState();
      store.setDraftText("Use the opening once.");
      store.setDraftContextRefs(refs);
      useAgentConsoleStore.setState({
        draftSourceLocators: {
          "block:ch1:legacy-b1": {
            order: 0,
            sourceFingerprint: blockFingerprint(activeBlocks[0]),
          },
        },
      });

      await controller.submitAgentDraft(conversationTask("ch1"));

      const input = dependencies.stream.mock.calls[0][0];
      expect(input.run.attachments).toEqual([
        expect.objectContaining({ sourceId: "b1" }),
      ]);
      expect(useAgentConsoleStore.getState()).toMatchObject({
        draftContextRefs: [],
      });
      expect(useAgentConsoleStore.getState().draftContextSources).toEqual({});
      expect(useAgentConsoleStore.getState().draftSourceLocators).toEqual({});
    },
  );

  it("does not republish caches for an attachment removed during preflight", async () => {
    const model = deferred<MockLanguageModelV3>();
    let modelRequested = false;
    const dependencies = makeDependencies(null);
    dependencies.getModel = async () => {
      modelRequested = true;
      return model.promise;
    };
    const controller = createAgentController(dependencies);
    const parsed = parseChapter("Inactive first.\n\nInactive target.\n");
    const staleRef = blockRef("stale-id", "ch2");
    const store = useAgentConsoleStore.getState();
    store.setDraftText("Use the removed passage.");
    store.setDraftContextRefs([staleRef]);
    useAgentConsoleStore.setState({
      draftSourceLocators: {
        "block:ch2:stale-id": {
          order: 1,
          sourceFingerprint: blockFingerprint(parsed[1]),
        },
      },
    });

    const submission = controller.submitAgentDraft(conversationTask("ch1"));
    await vi.waitFor(() => expect(modelRequested).toBe(true));
    store.removeDraftContextRef(staleRef);
    model.resolve(new MockLanguageModelV3());
    await submission;

    expect(dependencies.stream.mock.calls[0][0].run.attachments).toHaveLength(1);
    expect(useAgentConsoleStore.getState()).toMatchObject({
      draftContextRefs: [],
    });
    expect(useAgentConsoleStore.getState().draftContextSources).toEqual({});
    expect(useAgentConsoleStore.getState().draftSourceLocators).toEqual({});
  });

  it("retains an unavailable source and refuses to omit it from submission", async () => {
    const missingRef = blockRef("missing", "ch1");
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);
    await controller.dispatchAgentIntent({
      kind: "add-context",
      refs: [missingRef],
    });
    useAgentConsoleStore.getState().setDraftText("Use the missing source.");

    await expect(controller.submitAgentDraft(conversationTask("ch1"))).rejects.toThrow(
      "Remove unavailable context sources",
    );

    expect(useAgentConsoleStore.getState()).toMatchObject({
      draftText: "Use the missing source.",
      draftContextRefs: [missingRef],
      draftContextSources: {
        "block:ch1:missing": {
          available: false,
          ref: missingRef,
        },
      },
      messages: [],
      runStatus: "idle",
    });
    expect(dependencies.stream).not.toHaveBeenCalled();
  });

  it("keeps mode and target frozen while the author changes the editor", async () => {
    const pending = deferred<StreamAgentRunResult>();
    let captured: StreamAgentRunInput | null = null;
    const dependencies = makeDependencies(async (input) => {
      captured = input;
      return pending.promise;
    });
    const controller = createAgentController(dependencies);
    const submission = controller.submitAgentRequest({
      kind: "run",
      mode: "writing",
      text: "Continue.",
      refs: [],
      task: conversationTask("ch1"),
    });
    await vi.waitFor(() => expect(captured).not.toBeNull());

    useAgentConsoleStore.getState().setMode("edit");
    useProjectStore.setState({
      activeChapterId: "ch2",
      blocks: [block("other", "Other chapter", "narration")],
    });

    if (captured === null) throw new Error("Expected captured stream input");
    expect(captured.run.mode).toBe("writing");
    expect(captured.run.task).toEqual(conversationTask("ch1"));
    expect(captured.instructions).toContain("APROPROSE WRITING MODE");
    expect(captured.instructions).not.toContain("APROPROSE EDIT MODE");
    const frozenChapter = await captured.environment.readChapter("ch1");
    expect(frozenChapter.chapterId).toBe("ch1");
    expect(frozenChapter.blocks).toHaveLength(4);

    pending.resolve(successfulResult(captured, "Finished"));
    await submission;
  });

  it("freezes the caller's task object before asynchronous preflight", async () => {
    const model = deferred<MockLanguageModelV3>();
    let modelRequested = false;
    const dependencies = makeDependencies(null);
    dependencies.getModel = async () => {
      modelRequested = true;
      return model.promise;
    };
    const controller = createAgentController(dependencies);
    const task: Extract<AgentTask, { kind: "conversation" }> = {
      kind: "conversation",
      targetChapterId: "ch1",
    };
    const submission = controller.submitAgentRequest({
      kind: "run",
      mode: "writing",
      text: "Continue.",
      refs: [],
      task,
    });
    await vi.waitFor(() => expect(modelRequested).toBe(true));

    task.targetChapterId = "ch2";
    model.resolve(new MockLanguageModelV3());
    await submission;

    expect(dependencies.stream.mock.calls[0][0].run.task).toEqual({
      kind: "conversation",
      targetChapterId: "ch1",
    });
  });

  it("preserves same-valued text and attachment replacements during preflight", async () => {
    const model = deferred<MockLanguageModelV3>();
    let modelRequested = false;
    const dependencies = makeDependencies(null);
    dependencies.getModel = async () => {
      modelRequested = true;
      return model.promise;
    };
    const controller = createAgentController(dependencies);
    const submittedRef = blockRef("b1", "ch1");
    const store = useAgentConsoleStore.getState();
    store.setDraftText("First request");
    store.addDraftContextRefs([submittedRef]);

    const submission = controller.submitAgentDraft(conversationTask("ch1"));
    await vi.waitFor(() => expect(modelRequested).toBe(true));
    store.setDraftText("Temporary request");
    store.setDraftText("First request");
    store.removeDraftContextRef(submittedRef);
    store.addDraftContextRefs([submittedRef]);
    model.resolve(new MockLanguageModelV3());
    await submission;

    expect(useAgentConsoleStore.getState()).toMatchObject({
      draftText: "First request",
      draftContextRefs: [submittedRef],
      runStatus: "idle",
    });
  });
});

describe("run settlement and cancellation", () => {
  it("keeps text and attachments added while streaming", async () => {
    const pending = deferred<StreamAgentRunResult>();
    let captured: StreamAgentRunInput | null = null;
    const dependencies = makeDependencies(async (input) => {
      captured = input;
      return pending.promise;
    });
    const controller = createAgentController(dependencies);
    useAgentConsoleStore.getState().setDraftText("First request");
    useAgentConsoleStore.getState().addDraftContextRefs([blockRef("b1", "ch1")]);

    const submission = controller.submitAgentDraft(conversationTask("ch1"));
    await vi.waitFor(() => expect(captured).not.toBeNull());
    expect(useAgentConsoleStore.getState()).toMatchObject({
      draftText: "",
      draftContextRefs: [],
    });
    useAgentConsoleStore.getState().setDraftText("Next request");
    useAgentConsoleStore.getState().addDraftContextRefs([blockRef("b2", "ch1")]);
    if (captured === null) throw new Error("Expected captured stream input");
    pending.resolve(successfulResult(captured, "Finished"));
    await submission;

    expect(useAgentConsoleStore.getState()).toMatchObject({
      draftText: "Next request",
      draftContextRefs: [blockRef("b2", "ch1")],
      runStatus: "idle",
    });
  });

  it("stops a partial turn and retains a staged proposal", async () => {
    const pending = deferred<StreamAgentRunResult>();
    let captured: StreamAgentRunInput | null = null;
    const dependencies = makeDependencies(async (input) => {
      captured = input;
      input.onMessage(assistantMessage(input, "streaming", "Partial response"));
      return pending.promise;
    });
    const controller = createAgentController(dependencies);
    const submission = controller.submitAgentRequest({
      kind: "run",
      mode: "writing",
      text: "Continue.",
      refs: [],
      task: conversationTask("ch1"),
    });
    await vi.waitFor(() => expect(captured).not.toBeNull());
    const proposal: PendingProposal = {
      id: "proposal-1",
      kind: "manuscript",
      projectRoot: "/book",
      chapterId: "ch1",
      summary: "A staged change",
      createdAt: "2026-07-30T12:00:00.000Z",
      originatingMessageId: "assistant",
      changes: [],
    };
    useAgentConsoleStore.getState().replacePendingProposal(proposal);

    controller.stopAgentRun();

    expect(useAgentConsoleStore.getState()).toMatchObject({
      runStatus: "idle",
      activeRun: null,
      pendingProposal: proposal,
      interruptedRun: { reason: "stopped" },
    });
    const partial = useAgentConsoleStore
      .getState()
      .messages.find((message) => message.role === "assistant");
    expect(partial?.metadata?.state).toBe("stopped");
    if (captured === null) throw new Error("Expected captured stream input");
    expect(captured.signal.aborted).toBe(true);
    pending.resolve(successfulResult(captured, "Late completion"));
    await submission;
    expect(
      JSON.stringify(useAgentConsoleStore.getState().messages),
    ).not.toContain("Late completion");
  });

  it("settles a denied tool row safely when a run is stopped", async () => {
    const pending = deferred<StreamAgentRunResult>();
    let captured: StreamAgentRunInput | null = null;
    const dependencies = makeDependencies(async (input) => {
      captured = input;
      input.onMessage({
        id: input.generateMessageId(),
        role: "assistant",
        metadata: metadata(input.run, "streaming", null),
        parts: [
          {
            type: "tool-stage_manuscript_proposal",
            toolCallId: "call-denied",
            state: "output-denied",
            input: {
              summary: "PRIVATE STOP SUMMARY",
              changes: [
                {
                  kind: "remove",
                  blockId: "block-1",
                  afterId: null,
                  type: null,
                  speaker: null,
                  newText: null,
                  toIndex: null,
                  reason: "PRIVATE STOP REASON",
                },
              ],
            },
            approval: {
              id: "PRIVATE STOP APPROVAL",
              approved: false,
              reason: "PRIVATE STOP DENIAL",
            },
          },
        ],
      });
      return pending.promise;
    });
    const controller = createAgentController(dependencies);
    const submission = controller.submitAgentRequest({
      kind: "run",
      mode: "writing",
      text: "Continue.",
      refs: [],
      task: conversationTask("ch1"),
    });
    await vi.waitFor(() => expect(captured).not.toBeNull());

    controller.stopAgentRun();

    const settled = useAgentConsoleStore.getState().messages.at(-1);
    expect(settled?.parts).toEqual([
      {
        type: "tool-stage_manuscript_proposal",
        toolCallId: "call-denied",
        state: "output-denied",
        input: { summary: "", changes: [] },
        approval: { id: "call-denied", approved: false },
      },
    ]);
    expect(JSON.stringify(settled)).not.toContain("PRIVATE STOP");
    if (captured === null) throw new Error("Expected captured stream input");
    pending.resolve(successfulResult(captured, "Late completion"));
    await submission;
  });

  it("aborts preflight without clearing the composer or adding a turn", async () => {
    const model = deferred<MockLanguageModelV3>();
    let modelRequested = false;
    const dependencies = makeDependencies(null);
    dependencies.getModel = async () => {
      modelRequested = true;
      return model.promise;
    };
    const controller = createAgentController(dependencies);
    useAgentConsoleStore.getState().setDraftText("Keep this draft");
    const submission = controller.submitAgentDraft(conversationTask("ch1"));
    await vi.waitFor(() => expect(modelRequested).toBe(true));

    controller.stopAgentRun();

    expect(useAgentConsoleStore.getState()).toMatchObject({
      runStatus: "idle",
      draftText: "Keep this draft",
      messages: [],
    });
    model.resolve(new MockLanguageModelV3());
    await submission;
    expect(dependencies.stream).not.toHaveBeenCalled();
  });

  it("rejects a second submit and leaves the active run intact", async () => {
    const pending = deferred<StreamAgentRunResult>();
    let captured: StreamAgentRunInput | null = null;
    const dependencies = makeDependencies(async (input) => {
      captured = input;
      return pending.promise;
    });
    const controller = createAgentController(dependencies);
    useAgentConsoleStore.getState().setDraftText("First request");
    const first = controller.submitAgentDraft(conversationTask("ch1"));
    await vi.waitFor(() => expect(captured).not.toBeNull());
    useAgentConsoleStore.getState().setDraftText("Second request");

    await expect(controller.submitAgentDraft(conversationTask("ch1"))).rejects.toThrow(
      "An agent run is already active",
    );

    expect(dependencies.stream).toHaveBeenCalledOnce();
    expect(useAgentConsoleStore.getState()).toMatchObject({
      runStatus: "streaming",
      runError: {
        message: "An agent run is already active",
      },
      draftText: "Second request",
    });
    if (captured === null) throw new Error("Expected captured stream input");
    pending.resolve(successfulResult(captured, "Finished"));
    await first;
  });

  it("stores a typed run failure and rejects the composer submit", async () => {
    const transport = new Error("Network unavailable");
    transport.name = "AI_APICallError";
    const dependencies = makeDependencies(async () => {
      throw transport;
    });
    const controller = createAgentController(dependencies);
    useAgentConsoleStore.getState().setDraftText("Send this request");

    await expect(controller.submitAgentDraft(conversationTask("ch1"))).rejects.toBe(
      transport,
    );

    expect(useAgentConsoleStore.getState()).toMatchObject({
      runStatus: "idle",
      runError: { code: "transport", message: "Network unavailable" },
    });
    const failed = useAgentConsoleStore.getState().messages.at(-1);
    expect(failed).toMatchObject({
      role: "assistant",
      metadata: { state: "error", errorCode: "transport" },
    });
  });

  it("classifies exhausted OpenAI credits as a quota failure", async () => {
    const quota = new Error(
      "Failed after 3 attempts. Last error: You have no credits remaining.",
    );
    quota.name = "AI_RetryError";
    const dependencies = makeDependencies(async () => {
      throw quota;
    });
    const controller = createAgentController(dependencies);
    useAgentConsoleStore.getState().setDraftText("Send this request");

    await expect(controller.submitAgentDraft(conversationTask("ch1"))).rejects.toBe(
      quota,
    );

    expect(useAgentConsoleStore.getState()).toMatchObject({
      runStatus: "idle",
      runError: { code: "quota" },
    });
    expect(useAgentConsoleStore.getState().messages.at(-1)).toMatchObject({
      role: "assistant",
      metadata: { state: "error", errorCode: "quota" },
    });
  });

  it("classifies an OpenRouter payment-required response as a quota failure", async () => {
    const quota = new Error("Insufficient credits") as Error & {
      statusCode: number;
    };
    quota.name = "AI_APICallError";
    quota.statusCode = 402;
    const dependencies = makeDependencies(async () => {
      throw quota;
    });
    const controller = createAgentController(dependencies);
    useAgentConsoleStore.getState().setDraftText("Send this request");

    await expect(controller.submitAgentDraft(conversationTask("ch1"))).rejects.toBe(
      quota,
    );

    expect(useAgentConsoleStore.getState()).toMatchObject({
      runStatus: "idle",
      runError: { code: "quota" },
    });
  });

  it("settles a failed tool row safely when streaming rejects", async () => {
    const transport = new Error("Network unavailable");
    transport.name = "AI_APICallError";
    const dependencies = makeDependencies(async (input) => {
      input.onMessage({
        id: input.generateMessageId(),
        role: "assistant",
        metadata: metadata(input.run, "streaming", null),
        parts: [
          {
            type: "tool-run_critique",
            toolCallId: "call-error",
            state: "output-error",
            input: {
              chapterId: "/Users/author/private/chapter.tex",
              focus: "PRIVATE FAILURE FOCUS",
            },
            rawInput: "PRIVATE FAILURE INPUT",
            errorText: "ENOENT /Users/author/private/chapter.tex PRIVATE FAILURE",
          },
        ],
      });
      throw transport;
    });
    const controller = createAgentController(dependencies);

    await expect(
      controller.submitAgentRequest({
        kind: "run",
        mode: "writing",
        text: "Review this.",
        refs: [],
        task: conversationTask("ch1"),
      }),
    ).rejects.toBe(transport);

    const settled = useAgentConsoleStore.getState().messages.at(-1);
    expect(settled?.parts).toEqual([
      {
        type: "tool-run_critique",
        toolCallId: "call-error",
        state: "output-error",
        input: { chapterId: "Chapter", focus: null },
        errorText: "Tool execution failed.",
      },
    ]);
    expect(JSON.stringify(settled)).not.toMatch(/PRIVATE FAILURE|\/Users\/author/);
  });

  it("classifies a missing summary boundary as a compaction failure", async () => {
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);
    useAgentConsoleStore.setState({
      draftText: "Keep this request",
      messages: compactionMessages(0),
      summary: {
        throughMessageId: "missing-boundary",
        text: "Prior summary",
      },
    });

    await expect(controller.submitAgentDraft(conversationTask("ch1"))).rejects.toThrow(
      "Compaction boundary message is missing",
    );

    expect(useAgentConsoleStore.getState()).toMatchObject({
      draftText: "Keep this request",
      runStatus: "idle",
      runError: { code: "compaction" },
    });
    expect(dependencies.stream).not.toHaveBeenCalled();
  });

  it("refuses to stream when eligible history cannot meet the compaction target", async () => {
    const dependencies = makeDependencies(null);
    const summarize = vi.fn().mockResolvedValue("Too-small summary");
    dependencies.summarize = summarize;
    const controller = createAgentController(dependencies);
    const messages = compactionMessages(0);
    useAgentConsoleStore.setState({
      draftText: "Keep this request",
      messages,
      lastUsage: compactingUsage,
    });

    await expect(
      controller.submitAgentDraft(conversationTask("ch1")),
    ).rejects.toThrow("Compaction cannot reclaim the required token target");

    expect(summarize).not.toHaveBeenCalled();
    expect(dependencies.stream).not.toHaveBeenCalled();
    expect(useAgentConsoleStore.getState()).toMatchObject({
      draftText: "Keep this request",
      messages,
      runStatus: "idle",
      runError: { code: "compaction" },
    });
  });

  it("classifies frozen tool environment failures as tool errors", async () => {
    const dependencies = makeDependencies(async (input) => {
      await input.environment.readChapter("ch3");
      return successfulResult(input, "Unreachable");
    });
    const controller = createAgentController(dependencies);

    await expect(
      controller.submitAgentRequest({
        kind: "run",
        mode: "writing",
        text: "Read another chapter.",
        refs: [],
        task: conversationTask("ch1"),
      }),
    ).rejects.toThrow("Chapter does not belong to the frozen project: ch3");

    expect(useAgentConsoleStore.getState().runError).toMatchObject({
      code: "tool",
    });
    expect(useAgentConsoleStore.getState().messages.at(-1)).toMatchObject({
      role: "assistant",
      metadata: { state: "error", errorCode: "tool" },
    });
  });
});

describe("retry and local events", () => {
  it("retries from original mode, task, text, and snapshots", async () => {
    const snapshot: ContextSnapshot = {
      id: "snapshot-1",
      kind: "block",
      chapterId: "ch1",
      sourceId: "b1",
      order: 0,
      sourceType: "narration",
      label: "Narration block",
      exactText: "Frozen original text.",
      sourceFingerprint: "fingerprint-1",
    };
    const turn = originalTurn([snapshot]);
    useAgentConsoleStore.setState({
      mode: "edit",
      messages: turn.messages,
      draftText: "Unrelated next draft",
    });
    useProjectStore.setState({
      blocks: [
        block("b1", "Current first.", "narration"),
        block("b2", "Current anchor.", "narration"),
        block("replacement-successor", "Current successor.", "narration"),
      ],
    });
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);

    await controller.retryAgentTurn("original-user");

    const input = dependencies.stream.mock.calls[0][0];
    expect(input.run).toMatchObject({
      mode: turn.run.mode,
      task: turn.run.task,
      attachments: [snapshot],
    });
    const retriedUser = input.messages.at(-1);
    expect(retriedUser).toMatchObject({
      role: "user",
      metadata: { mode: "writing", retryOf: "original-user" },
      parts: [
        { type: "text", text: "Bridge these paragraphs." },
        { type: "data-context", data: { snapshots: [snapshot] } },
      ],
    });
    expect(useAgentConsoleStore.getState().draftText).toBe(
      "Unrelated next draft",
    );
  });

  it("records proposal events as complete local assistant messages", () => {
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);

    controller.recordProposalEvent({
      proposalId: "proposal-1",
      action: "accepted",
      changeCount: 1,
      text: "Accepted one manuscript change.",
    });

    expect(useAgentConsoleStore.getState().messages[0]).toMatchObject({
      role: "assistant",
      metadata: { state: "complete", mode: "writing" },
      parts: [
        {
          type: "data-proposal-event",
          data: {
            proposalId: "proposal-1",
            action: "accepted",
            changeCount: 1,
          },
        },
      ],
    });
    expect(dependencies.stream).not.toHaveBeenCalled();
  });

  it("rejects proposal events during a same-root transition", () => {
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);
    useAgentConsoleStore
      .getState()
      .beginPersistenceTransition("/book", "load");

    expect(() =>
      controller.recordProposalEvent({
        proposalId: "proposal-1",
        action: "rejected",
        changeCount: 1,
        text: "Rejected one manuscript change.",
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "AgentConsoleOwnershipError",
        agentErrorCode: "transition",
      }),
    );
    expect(useAgentConsoleStore.getState().messages).toEqual([]);
  });
});

describe("proposal staging lifecycle", () => {
  it("opens an active manuscript proposal in editor review", async () => {
    const run = await captureToolRun();
    const proposal = manuscriptProposalFixture(
      "active-proposal",
      "/book",
      "ch1",
    );

    run.input.environment.replacePendingProposal(proposal);

    expect(useAgentConsoleStore.getState().pendingProposal).toBe(proposal);
    expect(useViewStore.getState().manuscriptReviewProposalId).toBe(
      proposal.id,
    );
    await run.finish();
  });

  it("keeps an inactive chapter proposal pending without opening review", async () => {
    const run = await captureToolRun();
    const proposal = manuscriptProposalFixture(
      "inactive-proposal",
      "/book",
      "ch2",
    );

    run.input.environment.replacePendingProposal(proposal);

    expect(useAgentConsoleStore.getState().pendingProposal).toBe(proposal);
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
    await run.finish();
  });

  it("closes manuscript review when an outline proposal replaces it", async () => {
    const run = await captureToolRun();
    const proposal = outlineProposalFixture(
      "outline-proposal",
      "/book",
      "ch1",
    );
    useViewStore.getState().openManuscriptReview("old-proposal");

    run.input.environment.replacePendingProposal(proposal);

    expect(useAgentConsoleStore.getState().pendingProposal).toBe(proposal);
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
    await run.finish();
  });

  it("closes the old review before replacing and opening the new proposal", async () => {
    const run = await captureToolRun();
    const oldProposal = manuscriptProposalFixture(
      "old-proposal",
      "/book",
      "ch1",
    );
    const newProposal = manuscriptProposalFixture(
      "new-proposal",
      "/book",
      "ch1",
    );
    useAgentConsoleStore.getState().replacePendingProposal(oldProposal);
    useViewStore.getState().openManuscriptReview(oldProposal.id);
    const transitions: Array<{
      pendingProposalId: string | null;
      reviewProposalId: string | null;
    }> = [];
    const unsubscribe = useViewStore.subscribe((state) => {
      transitions.push({
        pendingProposalId:
          useAgentConsoleStore.getState().pendingProposal?.id ?? null,
        reviewProposalId: state.manuscriptReviewProposalId,
      });
    });

    run.input.environment.replacePendingProposal(newProposal);
    unsubscribe();

    expect(transitions).toEqual([
      {
        pendingProposalId: oldProposal.id,
        reviewProposalId: null,
      },
      {
        pendingProposalId: newProposal.id,
        reviewProposalId: newProposal.id,
      },
    ]);
    await run.finish();
  });
});

describe("project ownership", () => {
  it("discards a delayed old-project source refresh after console hydration", async () => {
    const sourceText = "Inactive target.\n";
    const parsed = parseChapter(sourceText);
    const staleRef = blockRef("stale-id", "ch2");
    const locator = {
      order: 0,
      sourceFingerprint: blockFingerprint(parsed[0]),
    };
    const delayedSource = deferred<string>();
    mocks.readTextFile.mockImplementationOnce(async () => delayedSource.promise);
    useAgentConsoleStore.getState().setDraftContextRefs([staleRef]);
    useAgentConsoleStore.setState({
      draftSourceLocators: { "block:ch2:stale-id": locator },
    });

    useProjectStore.setState({
      meta: structuredClone(useProjectStore.getState().meta),
    });
    await vi.waitFor(() => expect(mocks.readTextFile).toHaveBeenCalled());

    const nextState = persistedState([]);
    nextState.draftContextRefs = [staleRef];
    nextState.draftSourceLocators = { "block:ch2:stale-id": locator };
    useAgentConsoleStore.getState().hydrate("/new-book", nextState);
    delayedSource.resolve(sourceText);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: "/new-book",
      draftContextRefs: [staleRef],
      draftContextSources: {},
      draftSourceLocators: { "block:ch2:stale-id": locator },
    });
  });

  it("ignores a late add-context resolution from the old project", async () => {
    const source = deferred<string>();
    mocks.readTextFile.mockImplementationOnce(async () => source.promise);
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);
    const adding = controller.dispatchAgentIntent({
      kind: "add-context",
      refs: [blockRef("inactive", "ch2")],
    });
    await vi.waitFor(() => expect(mocks.readTextFile).toHaveBeenCalled());

    useProjectStore.setState({
      project: { ...project, root: "/new-book", name: "New Book" },
      activeChapterId: null,
      blocks: [],
    });
    useAgentConsoleStore.getState().hydrate("/new-book", persistedState([]));
    source.resolve("Inactive paragraph.");
    await adding;

    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: "/new-book",
      draftContextRefs: [],
      draftContextSources: {},
      runError: null,
    });
  });

  it("settles the old turn before hydration and ignores a late stream callback", async () => {
    const pending = deferred<StreamAgentRunResult>();
    let captured: StreamAgentRunInput | null = null;
    const dependencies = makeDependencies(async (input) => {
      captured = input;
      input.onMessage(assistantMessage(input, "streaming", "Old partial"));
      return pending.promise;
    });
    const controller = createAgentController(dependencies);
    const submission = controller.submitAgentRequest({
      kind: "run",
      mode: "writing",
      text: "Continue.",
      refs: [],
      task: conversationTask("ch1"),
    });
    await vi.waitFor(() => expect(captured).not.toBeNull());

    controller.abortAgentRunForProjectSwitch("/book", "project-switch");
    const settledOldState = useAgentConsoleStore.getState();
    expect(settledOldState.interruptedRun?.reason).toBe("project-switch");
    expect(
      settledOldState.messages.find((message) => message.role === "assistant")
        ?.metadata?.state,
    ).toBe("stopped");

    useProjectStore.setState({
      project: { ...project, root: "/new-book", name: "New Book" },
      activeChapterId: null,
      blocks: [],
    });
    useAgentConsoleStore.getState().hydrate("/new-book", persistedState([]));
    if (captured === null) throw new Error("Expected captured stream input");
    captured.onMessage(assistantMessage(captured, "streaming", "Late update"));
    pending.resolve(successfulResult(captured, "Late finish"));
    await submission;

    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: "/new-book",
      draftText: "New project draft",
      messages: [],
      runStatus: "idle",
    });
  });

  it("ignores late compaction after the old project is reset", async () => {
    const summary = deferred<string>();
    let summarizing = false;
    const dependencies = makeDependencies(null);
    dependencies.summarize = async () => {
      summarizing = true;
      return summary.promise;
    };
    const controller = createAgentController(dependencies);
    useAgentConsoleStore.setState({
      messages: compactionMessages(3_000),
      lastUsage: compactingUsage,
    });
    const submission = controller.submitAgentRequest({
      kind: "run",
      mode: "writing",
      text: "New request.",
      refs: [],
      task: conversationTask("ch1"),
    });
    await vi.waitFor(() => expect(summarizing).toBe(true));

    controller.abortAgentRunForProjectSwitch("/book", "project-switch");
    useProjectStore.setState({
      project: { ...project, root: "/new-book", name: "New Book" },
      activeChapterId: null,
      blocks: [],
    });
    useAgentConsoleStore
      .getState()
      .hydrate("/new-book", persistedState([]));
    summary.resolve("Late old-project summary");
    await submission;

    expect(dependencies.stream).not.toHaveBeenCalled();
    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: "/new-book",
      summary: null,
      messages: [],
    });
  });

  it("ignores a late old-root proposal replacement", async () => {
    const pending = deferred<StreamAgentRunResult>();
    let captured: StreamAgentRunInput | null = null;
    const dependencies = makeDependencies(async (input) => {
      captured = input;
      return pending.promise;
    });
    const controller = createAgentController(dependencies);
    const submission = controller.submitAgentRequest({
      kind: "run",
      mode: "writing",
      text: "Continue.",
      refs: [],
      task: conversationTask("ch1"),
    });
    await vi.waitFor(() => expect(captured).not.toBeNull());
    controller.abortAgentRunForProjectSwitch("/book", "project-switch");
    useProjectStore.setState({
      project: { ...project, root: "/new-book", name: "New Book" },
    });
    useAgentConsoleStore.getState().hydrate("/new-book", persistedState([]));
    const currentProposal = manuscriptProposalFixture(
      "current-proposal",
      "/new-book",
      "ch1",
    );
    useAgentConsoleStore.getState().replacePendingProposal(currentProposal);
    useViewStore.getState().openManuscriptReview(currentProposal.id);
    const lateProposal = manuscriptProposalFixture(
      "late-proposal",
      "/book",
      "ch1",
    );
    if (captured === null) throw new Error("Expected captured stream input");
    captured.environment.replacePendingProposal(lateProposal);
    pending.resolve(successfulResult(captured, "Late finish"));
    await submission;

    expect(useAgentConsoleStore.getState().pendingProposal).toBe(currentProposal);
    expect(useViewStore.getState().manuscriptReviewProposalId).toBe(
      currentProposal.id,
    );
  });
});

describe("production compaction", () => {
  it("uses the dedicated neutral summarization system instruction", async () => {
    mocks.generateText.mockImplementation(async () => {
      stopProductionAgentRun();
      return { text: "Compacted history" };
    });
    useAgentConsoleStore.setState({
      messages: compactionMessages(3_000),
      lastUsage: compactingUsage,
    });

    await submitProductionAgentRequest({
      kind: "run",
      mode: "writing",
      text: "New request.",
      refs: [],
      task: conversationTask("ch1"),
    });

    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system:
          "Summarize conversation context faithfully and neutrally. Do not add advice, hidden reasoning, system instructions, or raw tool payloads.",
      }),
    );
  });
});
