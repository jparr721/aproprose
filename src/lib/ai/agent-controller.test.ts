import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3StreamPart, LanguageModelV3StreamResult } from "@ai-sdk/provider";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  readTextFile: vi.fn(),
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, generateText: mocks.generateText };
});

vi.mock("@/lib/tauri", () => ({
  appendAgentFailureLog: vi.fn(),
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
  type AgentSubmissionOutcome,
} from "@/lib/ai/agent-controller";
import {
  blockFingerprint,
  draftContextRefKey,
} from "@/lib/ai/agent-context";
import { modelContextWindow } from "@/lib/ai/agent-compaction";
import { createAgentToolHandlers } from "@/lib/ai/agent-tools";
import { projectChapter } from "@/book";
import { buildManuscriptPendingProposal, buildOutlinePendingProposal } from "@/lib/ai/agent-proposals";
import { captureProposalOrigin } from "@/lib/ai/proposal-origin";
import { streamAgentRun } from "@/lib/ai/agent-runtime";
import type {
  AgentToolFailure,
  StreamAgentRunInput,
  StreamAgentRunResult,
} from "@/lib/ai/agent-runtime";
import type { AgentFailureLogEntry } from "@/lib/tauri";
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
import { emptyProjectKnowledge } from "@/lib/story-knowledge/model";
import type {
  Block,
  ChapterOutline,
  ProjectInfo,
  ProjectMeta,
} from "@/lib/types";
import {
  agentSessionStore,
  clearCharacterAgentSessions,
  clearOutlineAgentSessions,
  EMPTY_AGENT_STATE,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { emptyPersistedAgentState, fromAgentSnapshot, toAgentSnapshot } from "@/stores/agent-persistence";
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

interface ToolFailureStreamInput extends StreamAgentRunInput {
  onToolFailure: (failure: AgentToolFailure) => Promise<void>;
}

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
    knowledge: emptyProjectKnowledge(),
    outline: { premise: "A detective is trapped.", overview: "" },
    chapters: { ch1: outlineChapter },
    characters: [
      {
        id: "character-1",
        name: "Detective",
        color: "#123456",
        role: "Detective",
        profile: {
          appearance: "",
          mannerisms: "",
          motivations: "",
          relationships: "",
          history: "",
          voice: "",
        },
      },
      {
        id: "c1",
        name: "Mara",
        color: "#654321",
        role: "Courier",
        profile: {
          appearance: "",
          mannerisms: "",
          motivations: "",
          relationships: "",
          history: "",
          voice: "",
        },
      },
      {
        id: "c2",
        name: "Ivo",
        color: "#abcdef",
        role: "Watcher",
        profile: {
          appearance: "",
          mannerisms: "",
          motivations: "",
          relationships: "",
          history: "",
          voice: "",
        },
      },
    ],
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
  recordFailure: ReturnType<typeof vi.fn<(
    entry: AgentFailureLogEntry,
  ) => Promise<void>>>;
} {
  let nextId = 0;
  const stream = vi.fn(
    streamImplementation ??
      (async (input: StreamAgentRunInput) => {
        input.onMessage(assistantMessage(input, "streaming", "Draft"));
        return successfulResult(input, "Draft response");
      }),
  );
  const recordFailure = vi.fn(async () => undefined);
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
    recordFailure,
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
  let index = 0;
  return buildManuscriptPendingProposal({
    run: { id: "fixture-run", projectRoot, mode: "writing", task: conversationTask(chapterId), userMessageId: "fixture-user", attachments: [], startedAt: "2026-07-30T12:00:00.000Z" },
    raw: { chapterId, summary: `Manuscript proposal ${id}`, changes: [{ kind: "insert", blockId: null, afterId: "b3", type: "narration", speaker: null, newText: "A continuation.", toIndex: null, reason: "Continue" }] },
    blocks: activeBlocks,
    currentPending: null,
    originatingMessageId: "assistant-1",
    makeId: () => index++ === 0 ? id : `${id}:change`,
    currentOverview: "",
    now: "2026-07-30T12:00:00.000Z",
  });
}

function outlineProposalFixture(
  id: string,
  projectRoot: string,
  chapterId: string,
): PendingProposal {
  let index = 0;
  return buildOutlinePendingProposal({
    run: { id: "fixture-run", projectRoot, mode: "edit", task: { kind: "outline-sculpt", chapterId }, userMessageId: "fixture-user", attachments: [], startedAt: "2026-07-30T12:00:00.000Z" },
    raw: { chapterId, summary: `Outline proposal ${id}`, changes: [{ kind: "rewrite", cardId: "card-1", title: "Escape", intention: null, toIndex: null, reason: "Raise stakes" }] },
    cards: outlineChapter.cards,
    currentPending: null,
    originatingMessageId: "assistant-1",
    makeId: () => index++ === 0 ? id : `${id}:change`,
    currentOverview: "",
    now: "2026-07-30T12:00:00.000Z",
  });
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
    ...emptyPersistedAgentState(),
    mode: "edit",
    messages,
    summary: null,
    draftText: "New project draft",
    draftContextRefs: [],
    draftSourceLocators: {},
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
  clearCharacterAgentSessions();
  clearOutlineAgentSessions();
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

describe("book tools retain the captured active chapter", () => {
  for (const taskKind of ["outline-sculpt", "character-describe"] as const) {
    it.each(["full", "range", "search"] as const)(
      `${taskKind} reads unsaved semantic content when %s reads first`,
      async (firstRead) => {
        const sourceBlocks: Block[] = [
          {
            ...block("speech", "UNSAVED opening", "dialogue"),
            speaker: "Mara",
            tail: [
              { kind: "beat", text: "UNSAVED pause" },
              { kind: "quote", text: "UNSAVED answer" },
            ],
          },
          block("scratch", "UNSAVED intention", "scratchpad"),
        ];
        const expectedChapter = projectChapter({
          chapterId: "ch1",
          title: "Chapter One",
          blocks: sourceBlocks,
        });
        useProjectStore.setState({ blocks: sourceBlocks });
        const sessionId = taskKind === "outline-sculpt"
          ? { kind: "outline" as const, chapterId: "ch2" }
          : { kind: "character" as const, characterId: "c1" };
        const task: AgentTask = taskKind === "outline-sculpt"
          ? { kind: taskKind, chapterId: "ch2" }
          : { kind: taskKind, characterId: "c1" };
        agentSessionStore(sessionId).getState().hydrate(
          "/book",
          emptyPersistedAgentState(),
        );
        const model = deferred<MockLanguageModelV3>();
        let modelRequested = false;
        const dependencies = makeDependencies(async (input) => {
          const handlers = createAgentToolHandlers(input.environment);
          const readFull = () => handlers.readChapter({ chapterId: "ch1" });
          const readRange = () => handlers.readChapterRange({
            chapterId: "ch1", start: 0, limit: 100,
          });
          const search = () => handlers.searchBook({
            query: "UNSAVED", chapterIds: ["ch1"], limit: 10,
          });
          if (firstRead === "full") await readFull();
          if (firstRead === "range") await readRange();
          if (firstRead === "search") await search();
          const full = await readFull();
          const range = await readRange();
          const matches = await search();
          if (full.kind !== "runtime" || range.kind !== "runtime" || matches.kind !== "runtime") {
            throw new Error("Expected runtime book tool results");
          }
          expect(full.value).toEqual(expectedChapter);
          expect(range.value.blocks).toEqual(expectedChapter.blocks);
          expect(range.value.totalBlocks).toBe(2);
          expect(matches.value.matches.map((match) => match.blockId)).toEqual([
            "speech", "scratch",
          ]);
          expect(matches.value.matches[0].text).toBe("UNSAVED opening\nUNSAVED pause\nUNSAVED answer");
          expect(input.run.task).toEqual(task);
          return successfulResult(input, "Inspected captured source");
        });
        dependencies.getModel = async () => {
          modelRequested = true;
          return model.promise;
        };
        const controller = createAgentController(dependencies);
        const submission = controller.submitAgentRequest({
          kind: "run", mode: "writing", text: "Inspect the book.", refs: [], task,
        }, sessionId);
        await vi.waitFor(() => expect(modelRequested).toBe(true));

        sourceBlocks[0].text = "Later author edit";
        sourceBlocks[0].speaker = "Ivo";
        sourceBlocks[0].tail = [{ kind: "quote", text: "Later answer" }];
        sourceBlocks[1].text = "Later intention";
        model.resolve(new MockLanguageModelV3());

        await expect(submission).resolves.toEqual({ status: "success" });
        expect(mocks.readTextFile).not.toHaveBeenCalledWith("/book", "chapters/one.tex");
        expect(mocks.readTextFile).toHaveBeenCalledTimes(taskKind === "outline-sculpt" ? 1 : 0);
      },
    );
  }
});

describe("character Describe sessions", () => {
  it("rejects a task whose character differs from the session", async () => {
    const sessionId = { kind: "character" as const, characterId: "c1" };
    const store = agentSessionStore(sessionId);
    store.getState().hydrate("/book", emptyPersistedAgentState());
    store.getState().setDraftText("Describe Ivo.");
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);

    await expect(
      controller.submitAgentDraft(
        { kind: "character-describe", characterId: "c2" },
        sessionId,
      ),
    ).rejects.toThrow("Character Describe target does not match the session: c2");
    expect(dependencies.stream).not.toHaveBeenCalled();
  });

  it("freezes the character session identity during asynchronous preflight", async () => {
    const sessionId: {
      kind: "character";
      characterId: string;
    } = { kind: "character", characterId: "c1" };
    agentSessionStore(sessionId).getState().hydrate(
      "/book",
      emptyPersistedAgentState(),
    );
    const model = deferred<MockLanguageModelV3>();
    let modelRequested = false;
    const dependencies = makeDependencies(null);
    dependencies.getModel = async () => {
      modelRequested = true;
      return model.promise;
    };
    const controller = createAgentController(dependencies);
    const submission = controller.submitAgentRequest(
      {
        kind: "run",
        mode: "writing",
        text: "Describe Mara.",
        refs: [],
        task: { kind: "character-describe", characterId: "c1" },
      },
      sessionId,
    );
    await vi.waitFor(() => expect(modelRequested).toBe(true));

    sessionId.characterId = "c2";
    model.resolve(new MockLanguageModelV3());

    await expect(submission).resolves.toEqual({ status: "success" });
    expect(dependencies.stream).toHaveBeenCalledOnce();
    expect(dependencies.stream.mock.calls[0][0].run.task).toEqual({
      kind: "character-describe",
      characterId: "c1",
    });
  });
});

describe("outline planner sessions", () => {
  it("rejects outline and character runs while the project run is active", async () => {
    const release = deferred<void>();
    const inputs: StreamAgentRunInput[] = [];
    const dependencies = makeDependencies(async (input) => {
      inputs.push(input);
      await release.promise;
      return successfulResult(input, "Finished");
    });
    const controller = createAgentController(dependencies);
    const outlineSession = { kind: "outline" as const, chapterId: "ch2" };
    const outlineStore = agentSessionStore(outlineSession);
    outlineStore.getState().hydrate("/book", emptyPersistedAgentState());
    const characterSession = {
      kind: "character" as const,
      characterId: "character-1",
    };
    const characterStore = agentSessionStore(characterSession);
    characterStore.getState().hydrate("/book", emptyPersistedAgentState());
    useAgentConsoleStore.getState().setDraftText("Revise the current chapter.");
    outlineStore.getState().setDraftText("Plan the next chapter.");
    characterStore.getState().setDraftText("Describe the detective.");

    const projectSubmission = controller.submitAgentDraft(conversationTask("ch1"));
    await vi.waitFor(() => expect(inputs).toHaveLength(1));
    const outlineSubmission = controller.submitAgentDraft(
      { kind: "outline-sculpt", chapterId: "ch2" },
      outlineSession,
    );
    const characterSubmission = controller.submitAgentDraft(
      { kind: "character-describe", characterId: "character-1" },
      characterSession,
    );
    let contenders: AgentSubmissionOutcome[] | null = null;
    const contenderSettlements = Promise.all([
      outlineSubmission,
      characterSubmission,
    ]).then((outcomes) => {
      contenders = outcomes;
      return outcomes;
    });
    await vi.waitFor(() =>
      expect(inputs.length > 1 || contenders !== null).toBe(true),
    );
    release.resolve(undefined);
    const [projectOutcome, contenderOutcomes] = await Promise.all([
      projectSubmission,
      contenderSettlements,
    ]);

    expect(useAgentConsoleStore.getState().runStatus).toBe("idle");
    expect(outlineStore.getState().runStatus).toBe("idle");
    expect(characterStore.getState().runStatus).toBe("idle");
    expect(projectOutcome).toEqual({ status: "success" });
    expect(contenderOutcomes).toEqual([
      expect.objectContaining({ status: "failure" }),
      expect.objectContaining({ status: "failure" }),
    ]);
    expect(inputs).toHaveLength(1);
  });

  it("rejects project and character runs while an outline run is active", async () => {
    const release = deferred<void>();
    const inputs: StreamAgentRunInput[] = [];
    const dependencies = makeDependencies(async (input) => {
      inputs.push(input);
      await release.promise;
      return successfulResult(input, "Finished");
    });
    const controller = createAgentController(dependencies);
    const outlineSession = { kind: "outline" as const, chapterId: "ch2" };
    const outlineStore = agentSessionStore(outlineSession);
    outlineStore.getState().hydrate("/book", emptyPersistedAgentState());
    const characterSession = {
      kind: "character" as const,
      characterId: "character-1",
    };
    const characterStore = agentSessionStore(characterSession);
    characterStore.getState().hydrate("/book", emptyPersistedAgentState());
    outlineStore.getState().setDraftText("Plan the next chapter.");
    useAgentConsoleStore.getState().setDraftText("Revise the chapter.");
    characterStore.getState().setDraftText("Describe the detective.");

    const outlineSubmission = controller.submitAgentDraft(
      { kind: "outline-sculpt", chapterId: "ch2" },
      outlineSession,
    );
    await vi.waitFor(() => expect(inputs).toHaveLength(1));
    const projectSubmission = controller.submitAgentDraft(
      conversationTask("ch1"),
    );
    const characterSubmission = controller.submitAgentDraft(
      { kind: "character-describe", characterId: "character-1" },
      characterSession,
    );
    let contenders: AgentSubmissionOutcome[] | null = null;
    const contenderSettlements = Promise.all([
      projectSubmission,
      characterSubmission,
    ]).then((outcomes) => {
      contenders = outcomes;
      return outcomes;
    });
    await vi.waitFor(() =>
      expect(inputs.length > 1 || contenders !== null).toBe(true),
    );
    release.resolve(undefined);
    const [outlineOutcome, contenderOutcomes] = await Promise.all([
      outlineSubmission,
      contenderSettlements,
    ]);

    expect(outlineStore.getState().runStatus).toBe("idle");
    expect(useAgentConsoleStore.getState().runStatus).toBe("idle");
    expect(characterStore.getState().runStatus).toBe("idle");
    expect(outlineOutcome).toEqual({ status: "success" });
    expect(contenderOutcomes).toEqual([
      expect.objectContaining({ status: "failure" }),
      expect.objectContaining({ status: "failure" }),
    ]);
    expect(inputs).toHaveLength(1);
  });

  it("rejects a second character run while another character is active", async () => {
    const release = deferred<void>();
    const inputs: StreamAgentRunInput[] = [];
    const dependencies = makeDependencies(async (input) => {
      inputs.push(input);
      await release.promise;
      return successfulResult(input, "Finished");
    });
    const controller = createAgentController(dependencies);
    const firstSession = { kind: "character" as const, characterId: "c1" };
    const secondSession = { kind: "character" as const, characterId: "c2" };
    const firstStore = agentSessionStore(firstSession);
    const secondStore = agentSessionStore(secondSession);
    firstStore.getState().hydrate("/book", emptyPersistedAgentState());
    secondStore.getState().hydrate("/book", emptyPersistedAgentState());
    firstStore.getState().setDraftText("Describe the detective.");
    secondStore.getState().setDraftText("Describe the witness.");

    const firstSubmission = controller.submitAgentDraft(
      { kind: "character-describe", characterId: "c1" },
      firstSession,
    );
    await vi.waitFor(() => expect(inputs).toHaveLength(1));
    const secondSubmission = controller.submitAgentDraft(
      { kind: "character-describe", characterId: "c2" },
      secondSession,
    );
    let contender: AgentSubmissionOutcome | null = null;
    const contenderSettlement = secondSubmission.then((outcome) => {
      contender = outcome;
      return outcome;
    });
    await vi.waitFor(() =>
      expect(inputs.length > 1 || contender !== null).toBe(true),
    );
    release.resolve(undefined);
    const [firstOutcome, secondOutcome] = await Promise.all([
      firstSubmission,
      contenderSettlement,
    ]);

    expect(firstStore.getState().runStatus).toBe("idle");
    expect(secondStore.getState().runStatus).toBe("idle");
    expect(firstOutcome).toEqual({ status: "success" });
    expect(secondOutcome).toMatchObject({ status: "failure" });
    expect(inputs).toHaveLength(1);
  });

  it("rejects project and outline runs while a character run is active", async () => {
    const release = deferred<void>();
    const inputs: StreamAgentRunInput[] = [];
    const dependencies = makeDependencies(async (input) => {
      inputs.push(input);
      await release.promise;
      return successfulResult(input, "Finished");
    });
    const controller = createAgentController(dependencies);
    const characterSession = {
      kind: "character" as const,
      characterId: "character-1",
    };
    const characterStore = agentSessionStore(characterSession);
    characterStore.getState().hydrate("/book", emptyPersistedAgentState());
    const outlineSession = { kind: "outline" as const, chapterId: "ch2" };
    const outlineStore = agentSessionStore(outlineSession);
    outlineStore.getState().hydrate("/book", emptyPersistedAgentState());
    characterStore.getState().setDraftText("Describe the detective.");
    useAgentConsoleStore.getState().setDraftText("Revise the chapter.");
    outlineStore.getState().setDraftText("Plan the next chapter.");

    const characterSubmission = controller.submitAgentDraft(
      { kind: "character-describe", characterId: "character-1" },
      characterSession,
    );
    await vi.waitFor(() => expect(inputs).toHaveLength(1));
    const projectSubmission = controller.submitAgentDraft(
      conversationTask("ch1"),
    );
    const outlineSubmission = controller.submitAgentDraft(
      { kind: "outline-sculpt", chapterId: "ch2" },
      outlineSession,
    );
    let contenders: AgentSubmissionOutcome[] | null = null;
    const contenderSettlements = Promise.all([
      projectSubmission,
      outlineSubmission,
    ]).then((outcomes) => {
      contenders = outcomes;
      return outcomes;
    });
    await vi.waitFor(() =>
      expect(inputs.length > 1 || contenders !== null).toBe(true),
    );
    release.resolve(undefined);
    const [characterOutcome, contenderOutcomes] = await Promise.all([
      characterSubmission,
      contenderSettlements,
    ]);

    expect(characterStore.getState().runStatus).toBe("idle");
    expect(useAgentConsoleStore.getState().runStatus).toBe("idle");
    expect(outlineStore.getState().runStatus).toBe("idle");
    expect(characterOutcome).toEqual({ status: "success" });
    expect(contenderOutcomes).toEqual([
      expect.objectContaining({ status: "failure" }),
      expect.objectContaining({ status: "failure" }),
    ]);
    expect(inputs).toHaveLength(1);
  });

  it("injects the frozen target and discovers neighboring prose on demand", async () => {
    const sessionId = { kind: "outline" as const, chapterId: "ch2" };
    agentSessionStore(sessionId).getState().hydrate(
      "/book",
      {
        v: 3,
        mode: "writing",
        messages: [],
        summary: null,
        draftText: "",
        draftContextRefs: [],
        draftSourceLocators: {},
        pendingProposal: null,
        lastUsage: null,
        interruptedRun: null,
      },
    );
    useProjectStore.setState((state) => ({
      meta: {
        ...state.meta,
        outline: {
          premise: state.meta.outline.premise,
          overview: "The detective must escape before the house resets.",
        },
      },
    }));
    let instructions = "";
    let arbitraryChapterText: string[] = [];
    const dependencies = makeDependencies(async (input) => {
      instructions = input.instructions;
      const chapter = await input.environment.readChapter("ch1");
      arbitraryChapterText = chapter.blocks.map((block) => block.text);
      return successfulResult(input, "Planned");
    });
    const controller = createAgentController(dependencies);

    await controller.submitAgentRequest(
      {
        kind: "run",
        mode: "writing",
        text: "Plan the escape.",
        refs: [],
        task: { kind: "outline-sculpt", chapterId: "ch2" },
      },
      sessionId,
    );

    expect(instructions).toContain("APROPROSE OUTLINE PLANNING");
    expect(instructions).toContain("OUTLINE PLANNER GROUNDING");
    expect(instructions).toContain(
      '"storyOverview": "The detective must escape before the house resets."',
    );
    expect(instructions).toContain('"chapterId": "ch1"');
    expect(instructions).toContain('"chapterId": "ch2"');
    expect(instructions).toContain('"next": null');
    expect(instructions).toContain('"previous": null');
    expect(instructions).not.toContain("Disk first.");
    expect(arbitraryChapterText).toEqual([
      "First live paragraph.",
      "Private note.",
      "Middle live paragraph.",
      "Final live paragraph.",
    ]);
  });

  it("grounds a follow-up to an overview-only proposal in the planner chapter", async () => {
    const sessionId = { kind: "outline" as const, chapterId: "ch2" };
    const outlineStore = agentSessionStore(sessionId);
    outlineStore.getState().hydrate("/book", emptyPersistedAgentState());
    const proposal: PendingProposal = {
      id: "overview-proposal",
      kind: "overview",
      projectRoot: "/book",
      chapterId: null,
      summary: "Clarify the story direction",
      createdAt: "2026-07-30T12:00:00.000Z",
      originatingMessageId: "assistant-overview",
      changes: [],
      overviewChange: {
        id: "overview-change",
        before: "",
        after: "The detective must escape before the house resets.",
        reason: "Make the central pressure explicit",
        sourceFingerprint: "overview-source",
      },
    };
    outlineStore.getState().replacePendingProposal(proposal);
    outlineStore.getState().setDraftText("Develop the next beat.");
    let instructions = "";
    const dependencies = makeDependencies(async (input) => {
      instructions = input.instructions;
      return successfulResult(input, "Planned");
    });
    const controller = createAgentController(dependencies);

    await expect(
      controller.submitAgentDraft(
        { kind: "proposal-follow-up", proposalId: proposal.id },
        sessionId,
      ),
    ).resolves.toEqual({ status: "success" });

    expect(dependencies.stream).toHaveBeenCalledOnce();
    expect(instructions).toContain("OUTLINE PLANNER GROUNDING");
    expect(instructions).toContain('"chapterId": "ch2"');
  });

  it("bounds planner manuscript grounding against the selected model context", async () => {
    const sessionId = { kind: "outline" as const, chapterId: "ch2" };
    agentSessionStore(sessionId).getState().hydrate(
      "/book",
      {
        v: 3,
        mode: "writing",
        messages: [],
        summary: null,
        draftText: "",
        draftContextRefs: [],
        draftSourceLocators: {},
        pendingProposal: null,
        lastUsage: null,
        interruptedRun: null,
      },
    );
    mocks.readTextFile.mockResolvedValue(
      "HEAD TARGET_TAIL_SHOULD_NOT_REACH_THE_MODEL",
    );
    let instructions = "";
    const dependencies = makeDependencies(async (input) => {
      instructions = input.instructions;
      return successfulResult(input, "Planned");
    });
    dependencies.getContextWindow = async () => 24;
    const controller = createAgentController(dependencies);

    await controller.submitAgentRequest(
      {
        kind: "run",
        mode: "writing",
        text: "Plan the escape.",
        refs: [],
        task: { kind: "outline-sculpt", chapterId: "ch2" },
      },
      sessionId,
    );

    expect(instructions).toContain('"truncated": true');
    expect(instructions).not.toContain("TARGET_TAIL_SHOULD_NOT_REACH_THE_MODEL");
  });

  it("reports the exact planner grounding source when preflight fails", async () => {
    const sessionId = { kind: "outline" as const, chapterId: "ch2" };
    agentSessionStore(sessionId).getState().hydrate(
      "/book",
      {
        v: 3,
        mode: "writing",
        messages: [],
        summary: null,
        draftText: "",
        draftContextRefs: [],
        draftSourceLocators: {},
        pendingProposal: null,
        lastUsage: null,
        interruptedRun: null,
      },
    );
    mocks.readTextFile.mockRejectedValueOnce(new Error("chapter file missing"));
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);

    const outcome = await controller.submitAgentRequest(
      {
        kind: "run",
        mode: "writing",
        text: "Plan the escape.",
        refs: [],
        task: { kind: "outline-sculpt", chapterId: "ch2" },
      },
      sessionId,
    );

    expect(outcome).toMatchObject({
      status: "failure",
      failure: {
        message: expect.stringContaining(
          "Outline planner grounding failed for chapter ch2 at target source ch2: chapter file missing",
        ),
      },
    });
    expect(dependencies.stream).not.toHaveBeenCalled();
  });
});

describe("dispatchAgentIntent", () => {
  it("adds findings to the requested planner draft without changing the project draft", async () => {
    const sessionId = { kind: "outline" as const, chapterId: "ch2" };
    const outlineStore = agentSessionStore(sessionId);
    outlineStore.getState().hydrate("/book", emptyPersistedAgentState());
    const findingsMessage: AgentUIMessage = {
      id: "planner-findings",
      role: "assistant",
      metadata: metadata(
        {
          id: "planner-run",
          projectRoot: "/book",
          mode: "writing",
          task: { kind: "chapter-analysis", chapterId: "ch2", analysis: "critique" },
          userMessageId: "planner-user",
          attachments: [],
          startedAt: "2026-07-30T12:00:00.000Z",
        },
        "complete",
        null,
      ),
      parts: [
        {
          type: "data-findings",
          data: {
            kind: "critique",
            chapterId: "ch2",
            items: [
              {
                kind: "watch",
                tag: "Pacing",
                text: "The turn arrives before the setup lands.",
                blockIds: [],
              },
            ],
          },
        },
      ],
    };
    outlineStore.setState({ messages: [findingsMessage] });
    useAgentConsoleStore.getState().addDraftContextRefs([blockRef("b1", "ch1")]);
    const controller = createAgentController(makeDependencies(null));

    await controller.dispatchAgentIntent(
      {
        kind: "add-context",
        refs: [
          {
            kind: "finding",
            chapterId: "ch2",
            findingId: "planner-findings:0",
          },
        ],
      },
      sessionId,
    );

    expect(outlineStore.getState().draftContextRefs).toEqual([
      {
        kind: "finding",
        chapterId: "ch2",
        findingId: "planner-findings:0",
      },
    ]);
    expect(
      outlineStore.getState().draftContextSources[
        "finding:ch2:planner-findings:0"
      ],
    ).toMatchObject({
      available: true,
      label: "Pacing",
      preview: "The turn arrives before the setup lands.",
    });
    expect(useAgentConsoleStore.getState().draftContextRefs).toEqual([
      blockRef("b1", "ch1"),
    ]);
    expect(useViewStore.getState().aiOpen).toBe(false);
  });

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
        reason: "transition",
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
        reason: "transition",
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
      reason: "unknown",
      message: "The AI request could not be completed. Retry the request.",
      action: "retry",
      settingsTarget: null,
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

  it("records a redacted diagnostic when manuscript staging fails", async () => {
    const dependencies = {
      ...makeDependencies(async (input) => {
        await (input as ToolFailureStreamInput).onToolFailure({
          toolCallId: "call-stage-manuscript",
          toolName: "stage_manuscript_proposal",
          input: {
            summary: "Private proposal summary",
            changes: [
              {
                kind: "rewrite",
                blockId: "missing-block",
                afterId: null,
                type: "narration",
                speaker: null,
                newText: "Private replacement text",
                toIndex: null,
                reason: "Private reason",
              },
            ],
          },
          error: new Error("Block not found: missing-block"),
        });
        return successfulResult(input, "Tool failure reported");
      }),
    };
    const controller = createAgentController(dependencies);

    await controller.submitAgentRequest({
      kind: "run",
      mode: "writing",
      text: "Stage a proposal.",
      refs: [],
      task: conversationTask("ch1"),
    });

    expect(dependencies.recordFailure).toHaveBeenCalledOnce();
    expect(dependencies.recordFailure).toHaveBeenCalledWith({
      kind: "tool",
      occurredAt: "2026-07-30T12:00:00.000Z",
      runId: "agent-1",
      provider: "openai",
      modelId: "gpt-4.1",
      task: { kind: "conversation", targetChapterId: "ch1" },
      toolName: "stage_manuscript_proposal",
      toolCallId: "call-stage-manuscript",
      changeTargets: [
        {
          kind: "rewrite",
          targetId: "missing-block",
          afterId: null,
          toIndex: null,
        },
      ],
      errorCode: "tool",
      error: "Block not found: missing-block",
    });
  });

  it("records provider stream failures in the diagnostic log", async () => {
    const streamError = new Error("Provider unavailable");
    streamError.name = "AI_APICallError";
    const dependencies = makeDependencies(async () => {
      throw streamError;
    });
    const controller = createAgentController(dependencies);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      controller.submitAgentRequest({
        kind: "run",
        mode: "writing",
        text: "Continue.",
        refs: [],
        task: conversationTask("ch1"),
      }),
    ).resolves.toMatchObject({
      status: "failure",
      failure: { reason: "transport" },
    });

    expect(dependencies.recordFailure).toHaveBeenCalledOnce();
    expect(dependencies.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "run",
        occurredAt: "2026-07-30T12:00:00.000Z",
        runId: "agent-1",
        provider: "openai",
        modelId: "gpt-4.1",
        task: { kind: "conversation", targetChapterId: "ch1" },
        toolName: null,
        toolCallId: null,
        changeTargets: null,
        errorCode: "transport",
        error: "Provider unavailable",
      }),
    );
    consoleError.mockRestore();
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
        reason: "model-unselected",
        message: "Choose a model for OpenAI, then submit again.",
      },
      messages: [],
    });
    expect(dependencies.stream).not.toHaveBeenCalled();
    expect(dependencies.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "run",
        modelId: null,
        errorCode: "configuration",
        error: "Choose a model for OpenAI, then submit again.",
      }),
    );
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("records run requests rejected before preflight", async () => {
    const dependencies = makeDependencies(null);
    const controller = createAgentController(dependencies);
    useProjectStore.setState({ project: null });

    await controller.dispatchAgentIntent({
      kind: "run",
      mode: "writing",
      text: "Continue.",
      refs: [],
      task: conversationTask("ch1"),
    });

    expect(dependencies.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "run",
        provider: "openai",
        modelId: "gpt-4.1",
        task: { kind: "conversation", targetChapterId: "ch1" },
        errorCode: "unknown",
        error: "Open a project before using the agent console.",
      }),
    );
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

    expect(useAgentConsoleStore.getState().runError).toMatchObject({
      reason: "transport",
      message: "Your AI provider is temporarily unavailable. Retry shortly.",
    });
    expect(dependencies.stream).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "Agent run failed",
      expect.objectContaining({
        reason: "transport",
        message: "Your AI provider is temporarily unavailable. Retry shortly.",
        phase: null,
      }),
    );
    consoleError.mockRestore();
  });
});

describe("frozen run preflight", () => {
  it("preserves complete dialogue semantics in chapter tools", async () => {
    useProjectStore.setState({ blocks: [{
      id: "dialogue-full", type: "dialogue", text: "First quote", speaker: "Mara",
      tail: [{ kind: "beat", text: "She turns the key." }, { kind: "quote", text: "Final quote" }],
      raw: "", dirty: true,
    }] });
    const dependencies = makeDependencies(async (input) => {
      const chapter = await input.environment.readChapter("ch1");
      expect(chapter.blocks[0]).toMatchObject({
        speaker: "Mara",
        tail: [{ kind: "beat", text: "She turns the key." }, { kind: "quote", text: "Final quote" }],
      });
      expect(chapter.blocks[0].citationText).toContain("Final quote");
      return successfulResult(input, "Read");
    });
    const controller = createAgentController(dependencies);
    expect(await controller.submitAgentRequest({ kind: "run", mode: "edit", text: "Read", refs: [], task: { kind: "conversation", targetChapterId: "ch1" } })).toEqual({ status: "success" });
  });

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
        outline: {
          premise: "Initial outline premise",
          overview: "Initial story overview",
        },
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
        outline: { premise: "Changed outline premise", overview: "" },
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
      overview: "Initial story overview",
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
      agentFailureReason: "transition",
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

    await expect(controller.submitAgentDraft(conversationTask("ch1"))).resolves.toMatchObject({
      status: "failure",
      failure: { reason: "unknown" },
    });

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
  it("stops the active outline session", async () => {
    const pending = deferred<StreamAgentRunResult>();
    let input: StreamAgentRunInput | null = null;
    const dependencies = makeDependencies(async (captured) => {
      input = captured;
      return pending.promise;
    });
    const controller = createAgentController(dependencies);
    const sessionId = { kind: "outline" as const, chapterId: "ch2" };
    const store = agentSessionStore(sessionId);
    store.getState().hydrate("/book", emptyPersistedAgentState());
    store.getState().setDraftText("Plan the next chapter.");
    const submission = controller.submitAgentDraft(
      { kind: "outline-sculpt", chapterId: "ch2" },
      sessionId,
    );
    await vi.waitFor(() => expect(input).not.toBeNull());

    controller.stopAgentRun(sessionId);

    expect(store.getState().runStatus).toBe("idle");
    if (input === null) throw new Error("Expected captured outline input");
    expect(input.signal.aborted).toBe(true);
    pending.resolve(successfulResult(input, "Ignored outline finish"));
    await expect(submission).resolves.toEqual({ status: "stopped" });
  });

  it("aborts the active character session for a project switch", async () => {
    const pending = deferred<StreamAgentRunResult>();
    let input: StreamAgentRunInput | null = null;
    const dependencies = makeDependencies(async (captured) => {
      input = captured;
      return pending.promise;
    });
    const controller = createAgentController(dependencies);
    const sessionId = { kind: "character" as const, characterId: "c1" };
    const store = agentSessionStore(sessionId);
    store.getState().hydrate("/book", emptyPersistedAgentState());
    store.getState().setDraftText("Describe the detective.");
    const submission = controller.submitAgentDraft(
      { kind: "character-describe", characterId: "c1" },
      sessionId,
    );
    await vi.waitFor(() => expect(input).not.toBeNull());

    controller.abortAgentRunForProjectSwitch("/book", "project-switch");

    if (input === null) throw new Error("Expected captured character input");
    expect(input.signal.aborted).toBe(true);
    expect(store.getState().interruptedRun?.reason).toBe("project-switch");
    pending.resolve(successfulResult(input, "Ignored character finish"));
    await expect(submission).resolves.toEqual({ status: "stopped" });
  });

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
    const proposal = manuscriptProposalFixture("proposal-1", "/book", "ch1");
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

    await expect(controller.submitAgentDraft(conversationTask("ch1"))).resolves.toMatchObject({
      status: "failure",
      failure: { reason: "unknown" },
    });

    expect(dependencies.stream).toHaveBeenCalledOnce();
    expect(useAgentConsoleStore.getState()).toMatchObject({
      runStatus: "streaming",
      runError: {
        reason: "unknown",
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

    await expect(controller.submitAgentDraft(conversationTask("ch1"))).resolves.toMatchObject({
      status: "failure",
      failure: { reason: "transport" },
    });

    expect(useAgentConsoleStore.getState()).toMatchObject({
      runStatus: "idle",
      runError: { reason: "transport" },
    });
    const failed = useAgentConsoleStore.getState().messages.at(-1);
    expect(failed).toMatchObject({
      role: "assistant",
      metadata: { state: "error", failure: { reason: "transport" } },
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

    await expect(controller.submitAgentDraft(conversationTask("ch1"))).resolves.toMatchObject({
      status: "failure",
      failure: { reason: "quota" },
    });

    expect(useAgentConsoleStore.getState()).toMatchObject({
      runStatus: "idle",
      runError: { reason: "quota" },
    });
    expect(useAgentConsoleStore.getState().messages.at(-1)).toMatchObject({
      role: "assistant",
      metadata: { state: "error", failure: { reason: "quota" } },
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

    await expect(controller.submitAgentDraft(conversationTask("ch1"))).resolves.toMatchObject({
      status: "failure",
      failure: { reason: "quota" },
    });

    expect(useAgentConsoleStore.getState()).toMatchObject({
      runStatus: "idle",
      runError: { reason: "quota" },
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
    ).resolves.toMatchObject({
      status: "failure",
      failure: { reason: "transport" },
    });

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

    await expect(controller.submitAgentDraft(conversationTask("ch1"))).resolves.toMatchObject({
      status: "failure",
      failure: { reason: "compaction" },
    });

    expect(useAgentConsoleStore.getState()).toMatchObject({
      draftText: "Keep this request",
      runStatus: "idle",
      runError: { reason: "compaction" },
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
    ).resolves.toMatchObject({
      status: "failure",
      failure: { reason: "compaction" },
    });

    expect(summarize).not.toHaveBeenCalled();
    expect(dependencies.stream).not.toHaveBeenCalled();
    expect(useAgentConsoleStore.getState()).toMatchObject({
      draftText: "Keep this request",
      messages,
      runStatus: "idle",
      runError: { reason: "compaction" },
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
    ).resolves.toMatchObject({
      status: "failure",
      failure: { reason: "tool" },
    });

    expect(useAgentConsoleStore.getState().runError).toMatchObject({
      reason: "tool",
    });
    expect(useAgentConsoleStore.getState().messages.at(-1)).toMatchObject({
      role: "assistant",
      metadata: { state: "error", failure: { reason: "tool" } },
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
        block("b3", "Current successor.", "narration"),
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
        agentFailureReason: "transition",
      }),
    );
    expect(useAgentConsoleStore.getState().messages).toEqual([]);
  });
});

describe("proposal staging lifecycle", () => {
  it("retains independent proposals without taking over the editor", async () => {
    const run = await captureToolRun();
    const first = manuscriptProposalFixture("first", "/book", "ch1");
    const second = manuscriptProposalFixture("second", "/book", "ch1");
    run.input.environment.replacePendingProposal(first);
    run.input.environment.replacePendingProposal(second);
    expect(useAgentConsoleStore.getState().proposalRecords.map((record) => record.proposal.id)).toEqual(["first", "second"]);
    expect(useAgentConsoleStore.getState().pendingProposal).toEqual(second);
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
    expect(useAgentConsoleStore.getState().proposalRecords[1].source).toEqual({
      kind: "run", runId: run.input.run.id, task: run.input.run.task, text: "Stage a proposal.",
      origin: { kind: "task", mode: run.input.run.mode, task: run.input.run.task },
    });
    await run.finish();
  });

  it("keeps Outline and the ordinary editor available while staging", async () => {
    const run = await captureToolRun();
    useViewStore.setState({ outlineOpen: true });
    const proposal = manuscriptProposalFixture("background", "/book", "ch2");
    run.input.environment.replacePendingProposal(proposal);
    expect(useViewStore.getState().outlineOpen).toBe(true);
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
    expect(useAgentConsoleStore.getState().pendingProposal).toEqual(proposal);
    await run.finish();
  });

  it.each(["text", "empty", "overview"])("does not count a %s response as a continuation draft", async (output) => {
    const dependencies = makeDependencies(async (input) => {
      if (output === "empty") {
        input.environment.replacePendingProposal(input.environment.buildManuscriptProposal({ summary: "Empty", changes: [] }));
      }
      if (output === "overview") {
        input.environment.replacePendingProposal(input.environment.buildOverviewProposal({ summary: "Overview", overview: "New premise", reason: "Update" }));
      }
      return successfulResult(input, "Consider a twist.");
    });
    const controller = createAgentController(dependencies);
    const result = await controller.submitAgentRequest({
      kind: "run", mode: "writing", text: "Suggest", refs: [],
      task: { kind: "bridge", chapterId: "ch1", anchorBlockId: "b3", successorBlockId: null },
    });
    expect(result.status).toBe("failure");
    expect(dependencies.stream).toHaveBeenCalledTimes(1);
    expect(useAgentConsoleStore.getState().proposalRecords).toEqual([]);
    expect(useAgentConsoleStore.getState().runError).toMatchObject({ action: null, message: "No continuation draft was produced. Open AI to review the response before trying again." });
    if (output === "text") {
      expect(JSON.stringify(useAgentConsoleStore.getState().messages)).toContain("Consider a twist.");
    }
  });

  it("stages an opening for a chapter without prose", async () => {
    useProjectStore.setState({ blocks: [] });
    const dependencies = makeDependencies(async (input) => {
      const proposal = input.environment.buildManuscriptProposal({
        summary: "Opening", changes: [{ kind: "insert", blockId: null, afterId: null, type: "narration", speaker: null, newText: "The tide turned.", toIndex: null, reason: "Begin" }],
      });
      input.environment.replacePendingProposal(proposal);
      return successfulResult(input, "Opening staged");
    });
    const controller = createAgentController(dependencies);
    const result = await controller.submitAgentRequest({
      kind: "run", mode: "writing", text: "Suggest", refs: [],
      task: { kind: "bridge", chapterId: "ch1", anchorBlockId: null, successorBlockId: null },
    });
    expect(result.status).toBe("success");
    expect(useAgentConsoleStore.getState().pendingProposal).toMatchObject({ changes: [{ change: { afterId: null, newText: "The tide turned." } }] });
    expect(useViewStore.getState().changesOpen).toBe(true);
    expect(useViewStore.getState().manuscriptReviewProposalId).toBeNull();
  });

  it.each(["success", "error", "stop", "edit", "dismiss"])("finalizes follow-up replacement only for an unchanged successful target: %s", async (outcome) => {
    const original = manuscriptProposalFixture("original", "/book", "ch1");
    useAgentConsoleStore.getState().replacePendingProposal(original);
    const pending = deferred<StreamAgentRunResult>();
    let captured: StreamAgentRunInput | null = null;
    const dependencies = makeDependencies(async (input) => {
      captured = input;
      const proposal = input.environment.buildManuscriptProposal({
        summary: "Replacement", changes: [{ kind: "insert", blockId: null, afterId: "b3", type: "narration", speaker: null, newText: "A better continuation.", toIndex: null, reason: "Improve" }],
      });
      input.environment.replacePendingProposal(proposal);
      return pending.promise;
    });
    const controller = createAgentController(dependencies);
    const submission = controller.submitAgentRequest({
      kind: "run", mode: "writing", text: "Improve the draft", refs: [],
      task: { kind: "proposal-follow-up", proposalId: original.id },
    });
    await vi.waitFor(() => expect(captured).not.toBeNull());
    if (captured === null) throw new Error("Expected captured follow-up");
    const input: StreamAgentRunInput = captured;
    expect(useAgentConsoleStore.getState().proposalRecords).toHaveLength(1);
    expect(useAgentConsoleStore.getState().pendingProposal).toEqual(original);
    if (outcome === "edit") useAgentConsoleStore.getState().updatePendingManuscriptText({ proposalId: original.id, changeId: original.changes[0].id, newText: "Author edit" });
    if (outcome === "dismiss") useAgentConsoleStore.getState().decideProposalChanges(original.id, [original.changes[0].id], { status: "dismissed", decidedAt: "2026-07-30T12:00:00.000Z" });
    if (outcome === "stop") controller.stopAgentRun();
    if (outcome === "error") pending.reject(new Error("Transport failed"));
    else pending.resolve(successfulResult(input, "Replacement staged"));
    const result = await submission;
    const records = useAgentConsoleStore.getState().proposalRecords;
    if (outcome === "success") {
      expect(result.status).toBe("success");
      expect(records).toHaveLength(2);
      expect(records[0].replacedByProposalId).toBe(records[1].proposal.id);
    } else {
      expect(result.status).toBe(outcome === "stop" ? "stopped" : "failure");
      expect(records).toHaveLength(1);
      expect(records[0].replacedByProposalId).toBeNull();
    }
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
        system: expect.stringContaining("SPECIALIST CONTRACT: conversation-compactor/1"),
      }),
    );
  });
});


function providerOriginStream(chunks: LanguageModelV3StreamPart[]): LanguageModelV3StreamResult {
  return { stream: new ReadableStream<LanguageModelV3StreamPart>({ start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  } }) };
}

describe("specialist proposal follow-up origin", () => {
  it.each(["clean", "structure", "bridge"] as const)(
    "retains %s policy and frozen scope over two restored follow-ups with renewed IDs",
    async (operation) => {
      const source = "First paragraph.\n\nSelected paragraph.\n\nLast paragraph.\n";
      useProjectStore.setState({ blocks: parseChapter(source) });
      let replacementTurn = false;
      const dependencies = makeDependencies(null);
      dependencies.stream.mockImplementation(streamAgentRun);
      dependencies.getModel = async () => {
        let step = 0;
        return new MockLanguageModelV3({
          doStream: async (): Promise<LanguageModelV3StreamResult> => {
            const blocks = useProjectStore.getState().blocks;
            const outside = replacementTurn && step === 0;
            const target = blocks[outside ? 0 : 1];
            const change = operation === "bridge" ? {
              kind: "insert", blockId: null, afterId: target.id,
              type: "narration", speaker: null, newText: "A precise bridge.",
              toIndex: null, reason: "Connect the paragraphs",
            } : {
              kind: "rewrite", blockId: target.id, afterId: null,
              type: "narration", speaker: null, newText: "A precise revision.",
              toIndex: null, reason: "Improve the selection",
            };
            const chunks: LanguageModelV3StreamPart[] = step < (replacementTurn ? 2 : 1)
              ? [{ type: "tool-call", toolCallId: `stage-${step}`, toolName: "stage_manuscript_proposal",
                input: JSON.stringify({ summary: "Revise the same task", changes: [change] }) }]
              : [{ type: "text-start", id: "done" }, { type: "text-delta", id: "done", delta: "Finished" }, { type: "text-end", id: "done" }];
            step += 1;
            chunks.push({ type: "finish", finishReason: { unified: chunks[0].type === "tool-call" ? "tool-calls" : "stop", raw: "stop" }, usage: {
              inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 4, text: 4, reasoning: 0 },
            } });
            return providerOriginStream(chunks);
          },
        });
      };
      const controller = createAgentController(dependencies);
      const blocks = useProjectStore.getState().blocks;
      const task: AgentTask = operation === "bridge"
        ? { kind: "bridge", chapterId: "ch1", anchorBlockId: blocks[1].id, successorBlockId: blocks[2].id }
        : { kind: "selected-block-edit", chapterId: "ch1", blockIds: [blocks[1].id], operation };
      expect(await controller.submitAgentRequest({ kind: "run", mode: "edit", text: "Perform this action", refs: [], task })).toEqual({ status: "success" });
      const initialPolicy = dependencies.stream.mock.calls[0][0].environment.policy;
      expect(initialPolicy.action).toBe(operation === "bridge" ? "bridge-writer" : operation === "clean" ? "copyeditor" : "block-structurer");
      replacementTurn = true;
      for (let turn = 0; turn < 2; turn += 1) {
        const snapshot = await toAgentSnapshot();
        snapshot.messages = [];
        snapshot.summary = null;
        const restored = await fromAgentSnapshot("/book", JSON.parse(JSON.stringify(snapshot)));
        useAgentConsoleStore.getState().hydrate("/book", restored);
        const previous = useAgentConsoleStore.getState().pendingProposal;
        if (previous === null) throw new Error("Expected pending specialist proposal");
        const renewed = parseChapter(source);
        expect(renewed[1].id).not.toBe(blocks[1].id);
        useProjectStore.setState({ blocks: renewed });
        useSettingsStore.setState({ styleGuide: `Latest author voice ${turn}`, editingRules: `Latest author rule ${turn}` });
        expect(await controller.submitAgentRequest({ kind: "run", mode: "writing", text: "Try again, same task", refs: [], task: { kind: "proposal-follow-up", proposalId: previous.id } })).toEqual({ status: "success" });
        const input = dependencies.stream.mock.calls.at(-1)?.[0];
        if (input === undefined) throw new Error("Expected follow-up stream");
        expect(input.run.task).toEqual({ kind: "proposal-follow-up", proposalId: previous.id });
        expect(input.environment.policy.action).toBe(initialPolicy.action);
        expect(input.environment.policy.capabilities).toEqual(initialPolicy.capabilities);
        expect(input.environment.policy.stepBudget).toBe(initialPolicy.stepBudget);
        expect(input.environment.policy.stopAfterProposal).toBe(true);
        expect(input.instructions).toContain(`Latest author voice ${turn}`);
        expect(input.instructions).toContain(`Latest author rule ${turn}`);
        expect(input.instructions).toContain("APROPROSE EDIT MODE");
        expect(input.instructions).not.toContain("APROPROSE WRITING MODE");
        expect(input.instructions).toContain(previous.id);
        expect(input.instructions).toContain(renewed[1].id);
        const state = useAgentConsoleStore.getState();
        expect(state.proposalRecords).toHaveLength(turn + 2);
        expect(state.proposalRecords.at(-2)?.replacedByProposalId).toBe(state.pendingProposal?.id);
        expect(state.messages.at(-1)?.parts).toEqual(expect.arrayContaining([
          expect.objectContaining({ type: "tool-stage_manuscript_proposal", toolCallId: "stage-0", state: "output-error" }),
          expect.objectContaining({ type: "tool-stage_manuscript_proposal", toolCallId: "stage-1", state: "output-available" }),
        ]));
        expect(state.pendingProposal?.changes[0].change).toMatchObject(operation === "bridge" ? { afterId: renewed[1].id } : { blockId: renewed[1].id });
      }
    },
  );
});


describe("global overview follow-up origin", () => {
  it("retains a chapter-targeted writer origin for a global overview replacement", async () => {
    const dependencies = makeDependencies(null);
    dependencies.stream.mockImplementation(streamAgentRun);
    dependencies.getModel = async () => {
      let staged = false;
      return new MockLanguageModelV3({ doStream: async () => {
        const chunks: LanguageModelV3StreamPart[] = staged
          ? [{ type: "text-start", id: "done" }, { type: "text-delta", id: "done", delta: "Done" }, { type: "text-end", id: "done" }]
          : [{ type: "tool-call", toolCallId: "overview", toolName: "stage_overview_proposal", input: JSON.stringify({ summary: "Clarify direction", overview: "The conflict changes the whole city.", reason: "Clarify the central stakes" }) }];
        staged = true;
        chunks.push({ type: "finish", finishReason: { unified: chunks[0].type === "tool-call" ? "tool-calls" : "stop", raw: "stop" }, usage: { inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 4, text: 4, reasoning: 0 } } });
        return providerOriginStream(chunks);
      } });
    };
    const controller = createAgentController(dependencies);
    expect(await controller.submitAgentRequest({ kind: "run", mode: "writing", text: "Revise the overview", refs: [], task: conversationTask("ch1") })).toEqual({ status: "success" });
    const original = useAgentConsoleStore.getState().pendingProposal;
    if (original === null) throw new Error("Expected overview proposal");
    expect(original.kind).toBe("overview");
    expect(original.chapterId).toBeNull();
    useAgentConsoleStore.getState().hydrate("/book", await fromAgentSnapshot("/book", JSON.parse(JSON.stringify(await toAgentSnapshot()))));
    expect(await controller.submitAgentRequest({ kind: "run", mode: "edit", text: "Try again, same task", refs: [], task: { kind: "proposal-follow-up", proposalId: original.id } })).toEqual({ status: "success" });
    expect(dependencies.stream.mock.calls.at(-1)?.[0].environment.policy.action).toBe("writer");
    expect(useAgentConsoleStore.getState().proposalRecords).toHaveLength(2);
  });
});


describe("specialist follow-up completion and stale boundaries", () => {
  function originalSelection() {
    const task = { kind: "selected-block-edit", chapterId: "ch1", blockIds: ["b2"], operation: "clean" } satisfies AgentTask;
    let id = 0;
    const proposal = buildManuscriptPendingProposal({
      run: { id: "original", projectRoot: "/book", mode: "edit", task, userMessageId: "original-user", attachments: [], startedAt: "now" },
      raw: { chapterId: "ch1", summary: "Original selection", changes: [{ kind: "rewrite", blockId: "b2", afterId: null, type: "narration", speaker: null, newText: "Original cleaned text.", toIndex: null, reason: "Clean" }] },
      blocks: activeBlocks, currentPending: null, originatingMessageId: "original-assistant", makeId: () => `original-${++id}`, now: "now", currentOverview: "",
    });
    useAgentConsoleStore.getState().stageProposal(proposal, { kind: "run", runId: "original", task, text: "Clean", origin: captureProposalOrigin({ task, mode: "edit", blocks: activeBlocks }) });
    return proposal;
  }

  it.each(["success", "error", "stop"] as const)("keeps the original specialist draft until a %s completion", async (outcome) => {
    const original = originalSelection();
    const finish = deferred<void>();
    const dependencies = makeDependencies(null);
    dependencies.stream.mockImplementation(streamAgentRun);
    dependencies.getModel = async () => new MockLanguageModelV3({ doStream: async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          controller.enqueue({ type: "tool-call", toolCallId: "replacement", toolName: "stage_manuscript_proposal", input: JSON.stringify({ summary: "Replace the same selection", changes: [{ kind: "rewrite", blockId: "b2", afterId: null, type: "narration", speaker: null, newText: "Better cleaned text.", toIndex: null, reason: "Clean" }] }) });
          void finish.promise.then(() => {
            if (outcome === "error") controller.error(new Error("Provider connection failed"));
            else {
              controller.enqueue({ type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage: { inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 4, text: 4, reasoning: 0 } } });
              controller.close();
            }
          });
        },
      }),
    }) });
    const controller = createAgentController(dependencies);
    const submission = controller.submitAgentRequest({ kind: "run", mode: "writing", text: "Try again, same task", refs: [], task: { kind: "proposal-follow-up", proposalId: original.id } });
    await vi.waitFor(() => expect(useAgentConsoleStore.getState().messages.at(-1)?.parts).toEqual(expect.arrayContaining([expect.objectContaining({ type: "tool-stage_manuscript_proposal", state: "output-available" })])));
    expect(useAgentConsoleStore.getState().pendingProposal).toEqual(original);
    expect(useAgentConsoleStore.getState().proposalRecords).toHaveLength(1);
    if (outcome === "stop") controller.stopAgentRun();
    finish.resolve();
    expect((await submission).status).toBe(outcome === "error" ? "failure" : outcome === "stop" ? "stopped" : "success");
    expect(useAgentConsoleStore.getState().proposalRecords).toHaveLength(outcome === "success" ? 2 : 1);
    if (outcome !== "success") expect(useAgentConsoleStore.getState().pendingProposal).toEqual(original);
  });

  it("refuses changed original source before invoking the provider and preserves the draft", async () => {
    const original = originalSelection();
    useProjectStore.setState({ blocks: activeBlocks.map((item) => item.id === "b2" ? { ...item, text: "The author revised this source." } : item) });
    const dependencies = makeDependencies(null);
    const getModel = vi.fn(dependencies.getModel);
    dependencies.getModel = getModel;
    const result = await createAgentController(dependencies).submitAgentRequest({ kind: "run", mode: "writing", text: "Try again, same task", refs: [], task: { kind: "proposal-follow-up", proposalId: original.id } });
    expect(result).toMatchObject({ status: "failure", failure: { reason: "tool", action: null, message: expect.stringContaining("Start the original action again") } });
    expect(getModel).not.toHaveBeenCalled();
    expect(dependencies.stream).not.toHaveBeenCalled();
    expect(useAgentConsoleStore.getState().pendingProposal).toEqual(original);
    expect(useAgentConsoleStore.getState().messages).toEqual([]);
  });
});
