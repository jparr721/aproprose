import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  getModel: vi.fn().mockResolvedValue({}),
  productionStream: vi.fn(),
  uid: vi.fn(),
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, generateText: mocks.generateText };
});

vi.mock("@/lib/ai/model", () => ({
  getModel: mocks.getModel,
}));

vi.mock("@/lib/ai/agent-runtime", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/agent-runtime")>(
    "@/lib/ai/agent-runtime",
  );
  return { ...actual, streamAgentRun: mocks.productionStream };
});

vi.mock("@/lib/id", () => ({
  uid: mocks.uid,
}));

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
  readTextFile: vi.fn(),
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
  submitAgentRequest as submitProductionAgentRequest,
  type AgentControllerDependencies,
} from "@/lib/ai/agent-controller";
import type {
  StreamAgentRunInput,
  StreamAgentRunResult,
} from "@/lib/ai/agent-runtime";
import { createAgentToolHandlers } from "@/lib/ai/agent-tools";
import type {
  AgentMessageMetadata,
  AgentRun,
  AgentUIMessage,
  ManuscriptPendingProposal,
  OutlinePendingProposal,
  PersistedAgentSnapshot,
  PersistedUsage,
} from "@/lib/ai/agent-types";
import { EMPTY_META } from "@/lib/migration";
import { readAppData, writeAppData, writeProjectMeta } from "@/lib/tauri";
import type { Block, ProjectInfo, ProjectMeta } from "@/lib/types";
import {
  agentStateKey,
  emptyPersistedAgentState,
  transitionAgentProject,
} from "@/stores/agent-persistence";
import {
  EMPTY_AGENT_STATE,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useViewStore } from "@/stores/view-store";

type StreamImplementation = (
  input: StreamAgentRunInput,
) => Promise<StreamAgentRunResult>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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

function block(id: string, text: string): Block {
  return {
    id,
    type: "narration",
    text,
    raw: `${text}\n\n`,
    dirty: false,
  };
}

function project(root: string): ProjectInfo {
  return {
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
        label: "1",
        title: "Chapter One",
        file: "chapters/one.tex",
        wordCount: 16,
      },
    ],
  };
}

function projectMeta(): ProjectMeta {
  return {
    ...EMPTY_META,
    chapters: {
      ch1: {
        act: "setup",
        plotPoint: null,
        premise: "",
        goal: "",
        conflict: "",
        turn: "",
        characterIds: [],
        cards: [],
      },
    },
  };
}

function messageMetadata(
  run: AgentRun,
  state: AgentMessageMetadata["state"],
): AgentMessageMetadata {
  return {
    runId: run.id,
    mode: run.mode,
    task: run.task,
    state,
    createdAt: run.startedAt,
    error: null,
    errorCode: null,
    retryOf: null,
    usage: null,
  };
}

function completeAssistant(input: StreamAgentRunInput): AgentUIMessage {
  return {
    id: input.generateMessageId(),
    role: "assistant",
    metadata: messageMetadata(input.run, "complete"),
    parts: [{ type: "text", text: "Proposal ready.", state: "done" }],
  };
}

function dependencies(
  streamImplementation: StreamImplementation,
): AgentControllerDependencies {
  let nextId = 0;
  return {
    now: () => "2026-07-30T12:00:00.000Z",
    id: () => `flow-${++nextId}`,
    getModel: async () => new MockLanguageModelV3(),
    summarize: async () => "Compacted history",
    stream: streamImplementation,
  };
}

const originalBlocks: Block[] = [
  block("anchor", "Mara closed the ledger."),
  block("successor", "At dawn, the harbor bells woke her."),
  block("later", "She found the summons under the door."),
];

beforeEach(() => {
  vi.clearAllMocks();
  const uidCounts = new Map<string, number>();
  mocks.generateText.mockReset();
  mocks.getModel.mockReset().mockResolvedValue({});
  mocks.productionStream.mockReset();
  mocks.uid.mockReset().mockImplementation((prefix?: string): string => {
    const key = prefix ?? "b";
    const next = (uidCounts.get(key) ?? 0) + 1;
    uidCounts.set(key, next);
    return `${key}-test-${next}`;
  });
  vi.mocked(readAppData).mockReset().mockResolvedValue(null);
  vi.mocked(writeAppData).mockReset().mockResolvedValue(undefined);
  useAgentConsoleStore.setState({
    ...EMPTY_AGENT_STATE,
    requestedProjectRoot: "/book",
    activeProjectRoot: "/book",
    hydratedProjectRoot: "/book",
  });
  useProjectStore.setState({
    status: "ready",
    project: project("/book"),
    meta: projectMeta(),
    activeChapterId: "ch1",
    blocks: structuredClone(originalBlocks),
    selectedId: "anchor",
    selectedIds: [],
    editing: false,
    editCaret: null,
    chapterDirty: false,
    past: [],
    future: [],
    lastTextEditId: null,
  });
  useSettingsStore.setState({
    aiModel: "gpt-4.1",
    styleGuide: "Preserve the clipped voice.",
    editingRules: "Keep existing prose intact.",
  });
  useViewStore.setState({ aiOpen: false });
});

describe("agent console authoring flows", () => {
  it("bridges a middle chapter anchor without replacing later prose", async () => {
    const before = structuredClone(useProjectStore.getState().blocks);
    const controller = createAgentController(
      dependencies(async (input) => {
        const handlers = createAgentToolHandlers(input.environment);
        const chapter = await handlers.readChapter({ chapterId: "ch1" });
        expect(chapter.kind).toBe("runtime");
        if (chapter.kind !== "runtime") {
          throw new Error("Expected the complete chapter tool value.");
        }
        expect(chapter.value.blocks.map((item) => [item.id, item.text])).toEqual(
          originalBlocks.map((item) => [item.id, item.text]),
        );

        await handlers.stageManuscript({
          summary: "Bridge into dawn",
          changes: [
            {
              kind: "insert",
              blockId: null,
              afterId: "anchor",
              type: "narration",
              speaker: null,
              newText: "Sleep never came, only the slow whitening of the window.",
              toIndex: null,
              reason: "Connect the ledger to the morning bell",
            },
          ],
        });
        return { message: completeAssistant(input), usage };
      }),
    );

    await controller.submitAgentRequest({
      kind: "run",
      mode: "writing",
      text: "Pick up from here and bridge into the next paragraph.",
      refs: [{ kind: "block", chapterId: "ch1", blockId: "anchor" }],
      task: {
        kind: "bridge",
        chapterId: "ch1",
        anchorBlockId: "anchor",
        successorBlockId: "successor",
      },
    });

    const pending = useAgentConsoleStore.getState().pendingProposal;
    if (pending === null || pending.kind !== "manuscript") {
      throw new Error("Expected a pending manuscript proposal.");
    }
    expect(pending).toEqual({
      id: "flow-5",
      kind: "manuscript",
      projectRoot: "/book",
      chapterId: "ch1",
      summary: "Bridge into dawn",
      createdAt: "2026-07-30T12:00:00.000Z",
      originatingMessageId: "flow-3",
      changes: [
        {
          id: "flow-6",
          change: {
            kind: "insert",
            blockId: null,
            afterId: "anchor",
            type: "narration",
            speaker: null,
            newText: "Sleep never came, only the slow whitening of the window.",
            toIndex: null,
            reason: "Connect the ledger to the morning bell",
          },
          precondition: {
            kind: "insert",
            boundary: "next-prose",
            anchor: {
              sourceId: "anchor",
              order: 0,
              fingerprint: "64e5c668",
              sourceType: "narration",
              label: "narration block",
              exactText: "Mara closed the ledger.",
              previewText: "Mara closed the ledger.",
            },
            expectedNext: {
              sourceId: "successor",
              order: 1,
              fingerprint: "106a8c7e",
              sourceType: "narration",
              label: "narration block",
              exactText: "At dawn, the harbor bells woke her.",
              previewText: "At dawn, the harbor bells woke her.",
            },
          },
        },
      ],
    });
    expect(useProjectStore.getState().blocks).toEqual(before);

    const applied = useProjectStore
      .getState()
      .applyAgentManuscriptProposal(pending, ["flow-6"]);
    expect(applied).toEqual({
      status: "applied",
      appliedChangeIds: ["flow-6"],
    });
    const after = useProjectStore.getState().blocks;
    expect(after).toEqual([
      {
        id: "anchor",
        type: "narration",
        text: "Mara closed the ledger.",
        raw: "Mara closed the ledger.\n\n",
        dirty: false,
      },
      {
        id: "b-test-1",
        type: "narration",
        text: "Sleep never came, only the slow whitening of the window.",
        raw: "",
        dirty: true,
      },
      {
        id: "successor",
        type: "narration",
        text: "At dawn, the harbor bells woke her.",
        raw: "At dawn, the harbor bells woke her.\n\n",
        dirty: false,
      },
      {
        id: "later",
        type: "narration",
        text: "She found the summons under the door.",
        raw: "She found the summons under the door.\n\n",
        dirty: false,
      },
    ]);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().blocks).toEqual(before);
  });

  it("appends only after a final prose anchor", async () => {
    const before = structuredClone(useProjectStore.getState().blocks);
    const controller = createAgentController(
      dependencies(async (input) => {
        const handlers = createAgentToolHandlers(input.environment);
        const chapter = await handlers.readChapter({ chapterId: "ch1" });
        expect(chapter.kind).toBe("runtime");
        await handlers.stageManuscript({
          summary: "Continue after the summons",
          changes: [
            {
              kind: "insert",
              blockId: null,
              afterId: "later",
              type: "narration",
              speaker: null,
              newText: "By noon, Mara was already walking toward the quay.",
              toIndex: null,
              reason: "Continue from the final prose block",
            },
          ],
        });
        return { message: completeAssistant(input), usage };
      }),
    );

    await controller.submitAgentRequest({
      kind: "run",
      mode: "writing",
      text: "Pick up from the final paragraph.",
      refs: [{ kind: "block", chapterId: "ch1", blockId: "later" }],
      task: {
        kind: "bridge",
        chapterId: "ch1",
        anchorBlockId: "later",
        successorBlockId: null,
      },
    });

    const pending = useAgentConsoleStore.getState().pendingProposal;
    if (pending === null || pending.kind !== "manuscript") {
      throw new Error("Expected a final-anchor manuscript proposal.");
    }
    expect(pending).toEqual({
      id: "flow-5",
      kind: "manuscript",
      projectRoot: "/book",
      chapterId: "ch1",
      summary: "Continue after the summons",
      createdAt: "2026-07-30T12:00:00.000Z",
      originatingMessageId: "flow-3",
      changes: [
        {
          id: "flow-6",
          change: {
            kind: "insert",
            blockId: null,
            afterId: "later",
            type: "narration",
            speaker: null,
            newText: "By noon, Mara was already walking toward the quay.",
            toIndex: null,
            reason: "Continue from the final prose block",
          },
          precondition: {
            kind: "insert",
            boundary: "next-prose",
            anchor: {
              sourceId: "later",
              order: 2,
              fingerprint: "bd042c29",
              sourceType: "narration",
              label: "narration block",
              exactText: "She found the summons under the door.",
              previewText: "She found the summons under the door.",
            },
            expectedNext: null,
          },
        },
      ],
    });

    const applied = useProjectStore
      .getState()
      .applyAgentManuscriptProposal(pending, ["flow-6"]);
    expect(applied).toEqual({
      status: "applied",
      appliedChangeIds: ["flow-6"],
    });
    expect(useProjectStore.getState().blocks).toEqual([
      {
        id: "anchor",
        type: "narration",
        text: "Mara closed the ledger.",
        raw: "Mara closed the ledger.\n\n",
        dirty: false,
      },
      {
        id: "successor",
        type: "narration",
        text: "At dawn, the harbor bells woke her.",
        raw: "At dawn, the harbor bells woke her.\n\n",
        dirty: false,
      },
      {
        id: "later",
        type: "narration",
        text: "She found the summons under the door.",
        raw: "She found the summons under the door.\n\n",
        dirty: false,
      },
      {
        id: "b-test-1",
        type: "narration",
        text: "By noon, Mara was already walking toward the quay.",
        raw: "",
        dirty: true,
      },
    ]);
  });

  it("reads and completely replaces a proposal on follow-up while preserving it on failure", async () => {
    let streamCall = 0;
    const readPendingChanges: unknown[] = [];
    const controller = createAgentController(
      dependencies(async (input) => {
        streamCall += 1;
        const handlers = createAgentToolHandlers(input.environment);
        if (streamCall === 1) {
          await handlers.stageManuscript({
            summary: "Initial revision",
            changes: [
              {
                kind: "rewrite",
                blockId: "anchor",
                afterId: null,
                type: null,
                speaker: null,
                newText: "Mara snapped the ledger shut.",
                toIndex: null,
                reason: "Sharpen the gesture",
              },
            ],
          });
          return { message: completeAssistant(input), usage };
        }

        const current = input.environment.getPendingProposal();
        if (current === null) {
          throw new Error("Expected a proposal before follow-up.");
        }
        const read = await handlers.readPendingProposal({
          proposalId: current.id,
        });
        if (read.kind !== "runtime") {
          throw new Error("Expected the complete pending proposal tool value.");
        }
        readPendingChanges.push(structuredClone(read.value.changes));

        if (streamCall === 3) {
          await handlers.stageManuscript({
            summary: "Invalid follow-up revision",
            changes: [
              {
                kind: "rewrite",
                blockId: "missing-block",
                afterId: null,
                type: null,
                speaker: null,
                newText: "This source does not exist.",
                toIndex: null,
                reason: "Exercise transactional proposal staging",
              },
            ],
          });
          throw new Error("Expected invalid proposal staging to fail.");
        }

        expect(input.run.attachments).toEqual([
          {
            id: "flow-10",
            kind: "block",
            chapterId: "ch1",
            sourceId: "later",
            order: 2,
            sourceType: "narration",
            label: "Narration block",
            exactText: "She found the summons under the door.",
            sourceFingerprint: "bd042c29",
          },
        ]);
        await handlers.stageManuscript({
          summary: "Replacement revision",
          changes: [
            {
              kind: "rewrite",
              blockId: "successor",
              afterId: null,
              type: null,
              speaker: null,
              newText: "At dawn, the harbor bells dragged her awake.",
              toIndex: null,
              reason: "Carry the harder tone into morning",
            },
          ],
        });
        return { message: completeAssistant(input), usage };
      }),
    );

    await controller.submitAgentRequest({
      kind: "run",
      mode: "edit",
      text: "Tighten the opening gesture.",
      refs: [],
      task: { kind: "conversation", targetChapterId: "ch1" },
    });
    const initial = useAgentConsoleStore.getState().pendingProposal;
    if (initial === null || initial.kind !== "manuscript") {
      throw new Error("Expected the initial manuscript proposal.");
    }
    const expectedInitial: ManuscriptPendingProposal = {
      id: "flow-4",
      kind: "manuscript",
      projectRoot: "/book",
      chapterId: "ch1",
      summary: "Initial revision",
      createdAt: "2026-07-30T12:00:00.000Z",
      originatingMessageId: "flow-3",
      changes: [
        {
          id: "flow-5",
          change: {
            kind: "rewrite",
            blockId: "anchor",
            afterId: null,
            type: null,
            speaker: null,
            newText: "Mara snapped the ledger shut.",
            toIndex: null,
            reason: "Sharpen the gesture",
          },
          precondition: {
            kind: "target",
            target: {
              sourceId: "anchor",
              order: 0,
              fingerprint: "64e5c668",
              sourceType: "narration",
              label: "narration block",
              exactText: "Mara closed the ledger.",
              previewText: "Mara closed the ledger.",
            },
          },
        },
      ],
    };
    expect(initial).toEqual(expectedInitial);

    await controller.dispatchAgentIntent({
      kind: "add-context",
      refs: [{ kind: "block", chapterId: "ch1", blockId: "later" }],
    });
    useAgentConsoleStore.getState().setDraftText(
      "Use the summons paragraph and revise the morning instead.",
    );
    await controller.submitAgentDraft({
      kind: "proposal-follow-up",
      proposalId: "flow-4",
    });

    const replacement = useAgentConsoleStore.getState().pendingProposal;
    if (replacement === null || replacement.kind !== "manuscript") {
      throw new Error("Expected the replacement manuscript proposal.");
    }
    const expectedReplacement: ManuscriptPendingProposal = {
      id: "flow-11",
      kind: "manuscript",
      projectRoot: "/book",
      chapterId: "ch1",
      summary: "Replacement revision",
      createdAt: "2026-07-30T12:00:00.000Z",
      originatingMessageId: "flow-9",
      changes: [
        {
          id: "flow-12",
          change: {
            kind: "rewrite",
            blockId: "successor",
            afterId: null,
            type: null,
            speaker: null,
            newText: "At dawn, the harbor bells dragged her awake.",
            toIndex: null,
            reason: "Carry the harder tone into morning",
          },
          precondition: {
            kind: "target",
            target: {
              sourceId: "successor",
              order: 1,
              fingerprint: "106a8c7e",
              sourceType: "narration",
              label: "narration block",
              exactText: "At dawn, the harbor bells woke her.",
              previewText: "At dawn, the harbor bells woke her.",
            },
          },
        },
      ],
    };
    expect(replacement).toEqual(expectedReplacement);
    expect(readPendingChanges).toEqual([expectedInitial.changes]);

    useAgentConsoleStore.getState().setDraftText("Try another follow-up.");
    await expect(
      controller.submitAgentDraft({
        kind: "proposal-follow-up",
        proposalId: "flow-11",
      }),
    ).rejects.toThrow("invalid manuscript change");
    expect(readPendingChanges).toEqual([
      expectedInitial.changes,
      expectedReplacement.changes,
    ]);
    expect(useAgentConsoleStore.getState().pendingProposal).toEqual(
      expectedReplacement,
    );
  });

  it("emits critique and continuity findings while keeping analysis tasks read-only", async () => {
    mocks.generateText
      .mockResolvedValueOnce({
        output: {
          notes: [
            {
              kind: "strength",
              tag: "Voice",
              text: "The ledger image gives Mara a precise, controlled gesture.",
              blockIds: ["anchor"],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        output: {
          flags: [
            {
              sev: "ok",
              tag: "Timeline",
              text: "The ledger closes before the dawn bells ring.",
              blockIds: ["anchor", "successor"],
            },
          ],
        },
      });
    const controller = createAgentController(
      dependencies(async (input) => {
        const handlers = createAgentToolHandlers(input.environment);
        const attemptedStage = handlers.stageManuscript({
          summary: "Unsafe analysis edit",
          changes: [
            {
              kind: "insert",
              blockId: null,
              afterId: "anchor",
              type: "narration",
              speaker: null,
              newText: "This must not stage.",
              toIndex: null,
              reason: "Analysis is read-only",
            },
          ],
        });
        await expect(attemptedStage).rejects.toThrow("read-only");

        if (
          input.run.task.kind !== "chapter-analysis" ||
          input.run.task.analysis === "critique"
        ) {
          const result = await handlers.runCritique({
            chapterId: "ch1",
            focus: null,
          });
          if (result.kind !== "runtime") {
            throw new Error("Expected critique findings.");
          }
          return {
            message: {
              ...completeAssistant(input),
              parts: [
                {
                  type: "data-findings",
                  data: {
                    kind: "critique",
                    chapterId: "ch1",
                    items: result.value.findings,
                  },
                },
              ],
            },
            usage,
          };
        }

        const result = await handlers.runContinuity({
          chapterId: "ch1",
          focus: null,
        });
        if (result.kind !== "runtime") {
          throw new Error("Expected continuity findings.");
        }
        return {
          message: {
            ...completeAssistant(input),
            parts: [
              {
                type: "data-findings",
                data: {
                  kind: "continuity",
                  chapterId: "ch1",
                  items: result.value.findings,
                },
              },
            ],
          },
          usage,
        };
      }),
    );

    await controller.submitAgentRequest({
      kind: "run",
      mode: "edit",
      text: "Critique this chapter.",
      refs: [],
      task: { kind: "chapter-analysis", chapterId: "ch1", analysis: "critique" },
    });
    await controller.submitAgentRequest({
      kind: "run",
      mode: "edit",
      text: "Check continuity.",
      refs: [],
      task: {
        kind: "chapter-analysis",
        chapterId: "ch1",
        analysis: "continuity",
      },
    });

    const findings = useAgentConsoleStore
      .getState()
      .messages.flatMap((message) =>
        message.parts.filter((part) => part.type === "data-findings"),
      );
    expect(findings).toEqual([
      {
        type: "data-findings",
        data: {
          kind: "critique",
          chapterId: "ch1",
          items: [
            {
              kind: "strength",
              tag: "Voice",
              text: "The ledger image gives Mara a precise, controlled gesture.",
              blockIds: ["anchor"],
            },
          ],
        },
      },
      {
        type: "data-findings",
        data: {
          kind: "continuity",
          chapterId: "ch1",
          items: [
            {
              sev: "ok",
              tag: "Timeline",
              text: "The ledger closes before the dawn bells ring.",
              blockIds: ["anchor", "successor"],
            },
          ],
        },
      },
    ]);
    expect(useAgentConsoleStore.getState().pendingProposal).toBeNull();
  });

  it("stages, atomically applies, and restores an outline proposal", async () => {
    const card = {
      id: "card-1",
      title: "The ledger closes",
      intention: "End the night scene",
      characterIds: [],
      loreIds: [],
      continuityFlags: [],
    };
    useProjectStore.setState((state) => ({
      meta: {
        ...state.meta,
        chapters: {
          ...state.meta.chapters,
          ch1: { ...state.meta.chapters.ch1, cards: [card] },
        },
      },
    }));
    const before = structuredClone(useProjectStore.getState().meta);
    const controller = createAgentController(
      dependencies(async (input) => {
        const handlers = createAgentToolHandlers(input.environment);
        const outline = await handlers.readOutline({ chapterId: "ch1" });
        expect(outline).toEqual({
          kind: "runtime",
          summary: {
            label: "Read outline",
            target: "ch1",
            detail: "1 card",
            itemCount: 1,
          },
          value: {
            premise: "",
            chapters: [
              {
                chapterId: "ch1",
                title: "Chapter One",
                cards: [
                  {
                    id: "card-1",
                    order: 0,
                    title: "The ledger closes",
                    intention: "End the night scene",
                    fingerprint: "ed97ddf8",
                  },
                ],
              },
            ],
          },
        });
        await handlers.stageOutline({
          summary: "Strengthen the chapter turn",
          changes: [
            {
              kind: "rewrite",
              cardId: "card-1",
              title: "The summons arrives",
              intention: "Turn Mara toward the harbor",
              toIndex: null,
              reason: "Align the beat with the chapter ending",
            },
            {
              kind: "add",
              cardId: null,
              title: "Mara leaves",
              intention: "Commit her to the next scene",
              toIndex: 1,
              reason: "Make the transition explicit",
            },
          ],
        });
        return { message: completeAssistant(input), usage };
      }),
    );

    await controller.submitAgentRequest({
      kind: "run",
      mode: "edit",
      text: "Sculpt the chapter outline.",
      refs: [],
      task: { kind: "outline-sculpt", chapterId: "ch1" },
    });

    const pending = useAgentConsoleStore.getState().pendingProposal;
    if (pending === null || pending.kind !== "outline") {
      throw new Error("Expected a shared pending outline proposal.");
    }
    const expectedProposal: OutlinePendingProposal = {
      id: "flow-4",
      kind: "outline",
      projectRoot: "/book",
      chapterId: "ch1",
      summary: "Strengthen the chapter turn",
      createdAt: "2026-07-30T12:00:00.000Z",
      originatingMessageId: "flow-3",
      changes: [
        {
          id: "flow-5",
          change: {
            kind: "rewrite",
            cardId: "card-1",
            title: "The summons arrives",
            intention: "Turn Mara toward the harbor",
            toIndex: null,
            reason: "Align the beat with the chapter ending",
          },
          precondition: {
            kind: "card",
            target: {
              sourceId: "card-1",
              order: 0,
              fingerprint: "ed97ddf8",
              sourceType: "outline-card",
              label: "The ledger closes",
              exactText: "The ledger closes\nEnd the night scene",
              previewText: "The ledger closes\nEnd the night scene",
            },
          },
        },
        {
          id: "flow-6",
          change: {
            kind: "add",
            cardId: null,
            title: "Mara leaves",
            intention: "Commit her to the next scene",
            toIndex: 1,
            reason: "Make the transition explicit",
          },
          precondition: {
            kind: "outline-order",
            orderFingerprint: "f9295252",
          },
        },
      ],
    };
    expect(pending).toEqual(expectedProposal);
    expect(useProjectStore.getState().meta).toEqual(before);
    const applied = useProjectStore
      .getState()
      .applyAgentOutlineProposal(pending, ["flow-5", "flow-6"]);
    if (applied.status !== "applied") {
      throw new Error("Expected the complete outline proposal to apply.");
    }
    expect(applied.appliedChangeIds).toEqual(["flow-5", "flow-6"]);
    expect(applied.undoToken.id).toBe("b-test-1");
    const appliedMeta = useProjectStore.getState().meta;
    expect(appliedMeta.chapters.ch1.cards).toEqual([
      {
        id: "card-1",
        title: "The summons arrives",
        intention: "Turn Mara toward the harbor",
        characterIds: [],
        loreIds: [],
        continuityFlags: [],
      },
      {
        id: "card-test-1",
        title: "Mara leaves",
        intention: "Commit her to the next scene",
        characterIds: [],
        loreIds: [],
        continuityFlags: [],
      },
    ]);
    expect(writeProjectMeta).toHaveBeenCalledOnce();
    expect(writeProjectMeta).toHaveBeenLastCalledWith(
      "/book",
      JSON.stringify(appliedMeta),
    );
    expect(
      useProjectStore.getState().undoAgentOutlineProposal(applied.undoToken),
    ).toBe(true);
    expect(useProjectStore.getState().meta).toEqual(before);
    expect(writeProjectMeta).toHaveBeenCalledTimes(2);
    expect(writeProjectMeta).toHaveBeenLastCalledWith(
      "/book",
      JSON.stringify(before),
    );
  });

  it("stops after a completed tool row while preserving the next draft", async () => {
    const pending = deferred<StreamAgentRunResult>();
    let captured: StreamAgentRunInput | null = null;
    let pendingResolved = false;
    const controller = createAgentController(
      dependencies(async (input) => {
        captured = input;
        const handlers = createAgentToolHandlers(input.environment);
        const chapter = await handlers.readChapter({ chapterId: "ch1" });
        input.onMessage({
          id: input.generateMessageId(),
          role: "assistant",
          metadata: messageMetadata(input.run, "streaming"),
          parts: [
            {
              type: "dynamic-tool",
              toolName: "read_chapter",
              toolCallId: "flow-read-chapter",
              state: "output-available",
              input: { chapterId: "ch1" },
              output: chapter,
            },
          ],
        });
        return pending.promise;
      }),
    );
    useAgentConsoleStore.getState().setDraftText("Read before answering.");

    const submission = controller.submitAgentDraft({
      kind: "conversation",
      targetChapterId: "ch1",
    });
    await vi.waitFor(() => expect(captured).not.toBeNull());
    const expectedStoppedMessages: AgentUIMessage[] = [
      {
        id: "flow-2",
        role: "user",
        metadata: {
          runId: "flow-1",
          mode: "writing",
          task: { kind: "conversation", targetChapterId: "ch1" },
          state: "complete",
          createdAt: "2026-07-30T12:00:00.000Z",
          error: null,
          errorCode: null,
          retryOf: null,
          usage: null,
        },
        parts: [
          { type: "text", text: "Read before answering." },
          { type: "data-context", data: { snapshots: [] } },
        ],
      },
      {
        id: "flow-3",
        role: "assistant",
        metadata: {
          runId: "flow-1",
          mode: "writing",
          task: { kind: "conversation", targetChapterId: "ch1" },
          state: "stopped",
          createdAt: "2026-07-30T12:00:00.000Z",
          error: null,
          errorCode: null,
          retryOf: null,
          usage: null,
        },
        parts: [
          {
            type: "dynamic-tool",
            toolName: "read_chapter",
            toolCallId: "flow-read-chapter",
            state: "output-available",
            input: { chapterId: "ch1" },
            output: {
              kind: "summary",
              summary: {
                label: "Read chapter",
                target: "Chapter One",
                detail: "3 blocks",
                itemCount: 3,
              },
            },
          },
        ],
      },
    ];
    const expectedStoppedState = {
      messages: expectedStoppedMessages,
      interruptedRun: {
        runId: "flow-1",
        userMessageId: "flow-2",
        assistantMessageId: "flow-3",
        reason: "stopped" as const,
        interruptedAt: "2026-07-30T12:00:00.000Z",
      },
      draftText: "Ask about the summons next.",
      draftContextRefs: [
        { kind: "block" as const, chapterId: "ch1", blockId: "later" },
      ],
      runStatus: "idle" as const,
      activeRun: null,
      runError: null,
    };

    try {
      useAgentConsoleStore
        .getState()
        .setDraftText("Ask about the summons next.");
      useAgentConsoleStore.getState().addDraftContextRefs([
        { kind: "block", chapterId: "ch1", blockId: "later" },
      ]);

      controller.stopAgentRun();

      const stopped = useAgentConsoleStore.getState();
      expect({
        messages: stopped.messages,
        interruptedRun: stopped.interruptedRun,
        draftText: stopped.draftText,
        draftContextRefs: stopped.draftContextRefs,
        runStatus: stopped.runStatus,
        activeRun: stopped.activeRun,
        runError: stopped.runError,
      }).toEqual(expectedStoppedState);
      expect(JSON.stringify(stopped.messages)).not.toContain(
        "Mara closed the ledger.",
      );
      expect(JSON.stringify(stopped.messages)).not.toContain("64e5c668");
      if (captured === null) {
        throw new Error("Expected the stopped stream input.");
      }
      pending.resolve({ message: completeAssistant(captured), usage });
      pendingResolved = true;
      await submission;
      const afterLateCompletion = useAgentConsoleStore.getState();
      expect({
        messages: afterLateCompletion.messages,
        interruptedRun: afterLateCompletion.interruptedRun,
        draftText: afterLateCompletion.draftText,
        draftContextRefs: afterLateCompletion.draftContextRefs,
        runStatus: afterLateCompletion.runStatus,
        activeRun: afterLateCompletion.activeRun,
        runError: afterLateCompletion.runError,
      }).toEqual(expectedStoppedState);
    } finally {
      if (!pendingResolved) {
        if (captured === null) {
          throw new Error("Expected the stopped stream input during cleanup.");
        }
        controller.stopAgentRun();
        pending.resolve({ message: completeAssistant(captured), usage });
        await submission;
      }
    }
  });

  it("flushes a stopped project and restores only its conversation on reopen", async () => {
    const bookA = "/book-a";
    const bookB = "/book-b";
    const keyA = agentStateKey(bookA);
    const keyB = agentStateKey(bookB);
    const events: string[] = [];
    const disk = new Map<string, PersistedAgentSnapshot>();
    const bookBRun: AgentRun = {
      id: "book-b-run",
      projectRoot: bookB,
      mode: "writing",
      task: { kind: "conversation", targetChapterId: "ch1" },
      userMessageId: "book-b-user",
      attachments: [],
      startedAt: "2026-07-30T11:00:00.000Z",
    };
    const bookBMessages: AgentUIMessage[] = [
      {
        id: bookBRun.userMessageId,
        role: "user",
        metadata: messageMetadata(bookBRun, "complete"),
        parts: [
          { type: "text", text: "Continue Book B." },
          { type: "data-context", data: { snapshots: [] } },
        ],
      },
      {
        id: "book-b-assistant",
        role: "assistant",
        metadata: messageMetadata(bookBRun, "complete"),
        parts: [{ type: "text", text: "Book B remains separate." }],
      },
    ];
    disk.set(keyB, {
      ...emptyPersistedAgentState(),
      mode: "writing",
      messages: bookBMessages,
      draftText: "Book B draft",
    });
    vi.mocked(readAppData).mockImplementation(
      async <T>(key: string): Promise<T | null> => {
        if (key === keyA) events.push("read-a");
        if (key === keyB) events.push("read-b");
        const saved = disk.get(key);
        return saved === undefined ? null : (structuredClone(saved) as T);
      },
    );
    vi.mocked(writeAppData).mockImplementation(
      async <T>(key: string, value: T): Promise<void> => {
        if (key === keyA) events.push("write-a");
        if (key === keyB) events.push("write-b");
        disk.set(key, structuredClone(value) as PersistedAgentSnapshot);
      },
    );

    useProjectStore.setState({ project: project(bookA) });
    useAgentConsoleStore.setState({
      ...EMPTY_AGENT_STATE,
      requestedProjectRoot: bookA,
      activeProjectRoot: bookA,
      hydratedProjectRoot: bookA,
    });
    await transitionAgentProject(bookA);
    events.length = 0;
    useAgentConsoleStore.getState().setMode("edit");

    const stagingController = createAgentController(
      dependencies(async (input) => {
        const handlers = createAgentToolHandlers(input.environment);
        await handlers.stageManuscript({
          summary: "Revise Mara's final beat",
          changes: [
            {
              kind: "rewrite",
              blockId: "later",
              afterId: null,
              type: null,
              speaker: null,
              newText: "She found the sealed summons under the door.",
              toIndex: null,
              reason: "Make the summons concrete",
            },
          ],
        });
        return { message: completeAssistant(input), usage };
      }),
    );
    await stagingController.submitAgentRequest({
      kind: "run",
      mode: "edit",
      text: "Revise the final beat in Book A.",
      refs: [],
      task: { kind: "conversation", targetChapterId: "ch1" },
    });
    const bookAProposal = useAgentConsoleStore.getState().pendingProposal;
    if (bookAProposal === null || bookAProposal.kind !== "manuscript") {
      throw new Error("Expected Book A's pending manuscript proposal.");
    }
    const expectedBookAProposal: ManuscriptPendingProposal = {
      id: "flow-4",
      kind: "manuscript",
      projectRoot: bookA,
      chapterId: "ch1",
      summary: "Revise Mara's final beat",
      createdAt: "2026-07-30T12:00:00.000Z",
      originatingMessageId: "flow-3",
      changes: [
        {
          id: "flow-5",
          change: {
            kind: "rewrite",
            blockId: "later",
            afterId: null,
            type: null,
            speaker: null,
            newText: "She found the sealed summons under the door.",
            toIndex: null,
            reason: "Make the summons concrete",
          },
          precondition: {
            kind: "target",
            target: {
              sourceId: "later",
              order: 2,
              fingerprint: "bd042c29",
              sourceType: "narration",
              label: "narration block",
              exactText: "She found the summons under the door.",
              previewText: "She found the summons under the door.",
            },
          },
        },
      ],
    };
    expect(bookAProposal).toEqual(expectedBookAProposal);
    useAgentConsoleStore.getState().setDraftText("Book A draft");

    const liveResult = deferred<StreamAgentRunResult>();
    let liveInput: StreamAgentRunInput | null = null;
    let liveResultResolved = false;
    const productionTime = "2026-07-30T13:00:00.000Z";
    const dateSpy = vi
      .spyOn(Date.prototype, "toISOString")
      .mockReturnValue(productionTime);
    mocks.productionStream.mockImplementation(
      async (input: StreamAgentRunInput): Promise<StreamAgentRunResult> => {
        liveInput = input;
        input.signal.addEventListener(
          "abort",
          () => events.push("abort"),
          { once: true },
        );
        const handlers = createAgentToolHandlers(input.environment);
        const chapter = await handlers.readChapter({ chapterId: "ch1" });
        input.onMessage({
          id: input.generateMessageId(),
          role: "assistant",
          metadata: messageMetadata(input.run, "streaming"),
          parts: [
            {
              type: "dynamic-tool",
              toolName: "read_chapter",
              toolCallId: "book-a-read",
              state: "output-available",
              input: { chapterId: "ch1" },
              output: chapter,
            },
          ],
        });
        return liveResult.promise;
      },
    );
    const liveSubmission = submitProductionAgentRequest({
      kind: "run",
      mode: "edit",
      text: "Read Book A before the next revision.",
      refs: [],
      task: { kind: "conversation", targetChapterId: "ch1" },
    });
    const expectedLiveBookATranscript: AgentUIMessage[] = [
      {
        id: "flow-2",
        role: "user",
        metadata: {
          runId: "flow-1",
          mode: "edit",
          task: { kind: "conversation", targetChapterId: "ch1" },
          state: "complete",
          createdAt: "2026-07-30T12:00:00.000Z",
          error: null,
          errorCode: null,
          retryOf: null,
          usage: null,
        },
        parts: [
          { type: "text", text: "Revise the final beat in Book A." },
          { type: "data-context", data: { snapshots: [] } },
        ],
      },
      {
        id: "flow-3",
        role: "assistant",
        metadata: {
          runId: "flow-1",
          mode: "edit",
          task: { kind: "conversation", targetChapterId: "ch1" },
          state: "complete",
          createdAt: "2026-07-30T12:00:00.000Z",
          error: null,
          errorCode: null,
          retryOf: null,
          usage,
        },
        parts: [{ type: "text", text: "Proposal ready.", state: "done" }],
      },
      {
        id: "agent-test-2",
        role: "user",
        metadata: {
          runId: "agent-test-1",
          mode: "edit",
          task: { kind: "conversation", targetChapterId: "ch1" },
          state: "complete",
          createdAt: productionTime,
          error: null,
          errorCode: null,
          retryOf: null,
          usage: null,
        },
        parts: [
          { type: "text", text: "Read Book A before the next revision." },
          { type: "data-context", data: { snapshots: [] } },
        ],
      },
      {
        id: "agent-test-3",
        role: "assistant",
        metadata: {
          runId: "agent-test-1",
          mode: "edit",
          task: { kind: "conversation", targetChapterId: "ch1" },
          state: "streaming",
          createdAt: productionTime,
          error: null,
          errorCode: null,
          retryOf: null,
          usage: null,
        },
        parts: [
          {
            type: "dynamic-tool",
            toolName: "read_chapter",
            toolCallId: "book-a-read",
            state: "output-available",
            input: { chapterId: "ch1" },
            output: {
              kind: "runtime",
              summary: {
                label: "Read chapter",
                target: "Chapter One",
                detail: "3 blocks",
                itemCount: 3,
              },
              value: {
                chapterId: "ch1",
                title: "Chapter One",
                blocks: [
                  {
                    id: "anchor",
                    order: 0,
                    type: "narration",
                    text: "Mara closed the ledger.",
                    fingerprint: "64e5c668",
                  },
                  {
                    id: "successor",
                    order: 1,
                    type: "narration",
                    text: "At dawn, the harbor bells woke her.",
                    fingerprint: "106a8c7e",
                  },
                  {
                    id: "later",
                    order: 2,
                    type: "narration",
                    text: "She found the summons under the door.",
                    fingerprint: "bd042c29",
                  },
                ],
              },
            },
          },
        ],
      },
    ];
    const expectedPersistedBookATranscript: AgentUIMessage[] = [
      {
        id: "flow-2",
        role: "user",
        metadata: {
          runId: "flow-1",
          mode: "edit",
          task: { kind: "conversation", targetChapterId: "ch1" },
          state: "complete",
          createdAt: "2026-07-30T12:00:00.000Z",
          error: null,
          errorCode: null,
          retryOf: null,
          usage: null,
        },
        parts: [
          {
            type: "text",
            text: "Revise the final beat in Book A.",
            state: "done",
          },
          { type: "data-context", data: { snapshots: [] } },
        ],
      },
      {
        id: "flow-3",
        role: "assistant",
        metadata: {
          runId: "flow-1",
          mode: "edit",
          task: { kind: "conversation", targetChapterId: "ch1" },
          state: "complete",
          createdAt: "2026-07-30T12:00:00.000Z",
          error: null,
          errorCode: null,
          retryOf: null,
          usage,
        },
        parts: [{ type: "text", text: "Proposal ready.", state: "done" }],
      },
      {
        id: "agent-test-2",
        role: "user",
        metadata: {
          runId: "agent-test-1",
          mode: "edit",
          task: { kind: "conversation", targetChapterId: "ch1" },
          state: "complete",
          createdAt: productionTime,
          error: null,
          errorCode: null,
          retryOf: null,
          usage: null,
        },
        parts: [
          {
            type: "text",
            text: "Read Book A before the next revision.",
            state: "done",
          },
          { type: "data-context", data: { snapshots: [] } },
        ],
      },
      {
        id: "agent-test-3",
        role: "assistant",
        metadata: {
          runId: "agent-test-1",
          mode: "edit",
          task: { kind: "conversation", targetChapterId: "ch1" },
          state: "stopped",
          createdAt: productionTime,
          error: null,
          errorCode: null,
          retryOf: null,
          usage: null,
        },
        parts: [
          {
            type: "dynamic-tool",
            toolName: "read_chapter",
            toolCallId: "book-a-read",
            state: "output-available",
            input: { chapterId: "ch1" },
            output: {
              kind: "summary",
              summary: {
                label: "Read chapter",
                target: "Chapter One",
                detail: "3 blocks",
                itemCount: 3,
              },
            },
          },
        ],
      },
    ];
    const expectedInterruptedRun = {
      runId: "agent-test-1",
      userMessageId: "agent-test-2",
      assistantMessageId: "agent-test-3",
      reason: "project-switch" as const,
      interruptedAt: productionTime,
    };
    const expectedPersistedBookAProposal = {
      id: "flow-4",
      kind: "manuscript" as const,
      chapterId: "ch1",
      summary: "Revise Mara's final beat",
      createdAt: "2026-07-30T12:00:00.000Z",
      originatingMessageId: "flow-3",
      changes: [
        {
          id: "flow-5",
          change: {
            kind: "rewrite" as const,
            blockId: "later",
            afterId: null,
            type: null,
            speaker: null,
            newText: "She found the sealed summons under the door.",
            toIndex: null,
            reason: "Make the summons concrete",
          },
          precondition: {
            kind: "target" as const,
            target: {
              sourceId: "later",
              order: 2,
              fingerprint: "bd042c29",
              sourceType: "narration",
              label: "narration block",
              exactText: "She found the summons under the door.",
              previewText: "She found the summons under the door.",
            },
          },
        },
      ],
    };

    let recordedReset = false;
    let recordedHydration = false;
    let unsubscribe = (): void => undefined;
    try {
      await vi.waitFor(() => expect(liveInput).not.toBeNull());
      expect(useAgentConsoleStore.getState().messages).toEqual(
        expectedLiveBookATranscript,
      );
      unsubscribe = useAgentConsoleStore.subscribe((state, previous) => {
        if (
          !recordedReset &&
          state.persistenceTransition?.projectRoot === bookB &&
          previous.messages.length > 0 &&
          state.messages.length === 0
        ) {
          recordedReset = true;
          events.push("reset");
        }
        if (
          !recordedHydration &&
          state.hydratedProjectRoot === bookB &&
          previous.hydratedProjectRoot !== bookB
        ) {
          recordedHydration = true;
          events.push("hydrate-b");
        }
      });
      useProjectStore.setState({ project: project(bookB) });
      await transitionAgentProject(bookB);

      expect(events).toEqual([
        "abort",
        "write-a",
        "reset",
        "read-b",
        "hydrate-b",
      ]);
      const persistedA = disk.get(keyA);
      if (persistedA === undefined) {
        throw new Error("Expected Book A to be flushed before Book B loaded.");
      }
      expect(persistedA).toEqual({
        v: 3,
        mode: "edit",
        messages: expectedPersistedBookATranscript,
        summary: null,
        draftText: "Book A draft",
        draftContextRefs: [],
        draftSourceLocators: {},
        pendingProposal: expectedPersistedBookAProposal,
        lastUsage: usage,
        interruptedRun: expectedInterruptedRun,
      });
      const hydratedB = useAgentConsoleStore.getState();
      expect({
        mode: hydratedB.mode,
        messages: hydratedB.messages,
        summary: hydratedB.summary,
        draftText: hydratedB.draftText,
        draftContextRefs: hydratedB.draftContextRefs,
        pendingProposal: hydratedB.pendingProposal,
        lastUsage: hydratedB.lastUsage,
        interruptedRun: hydratedB.interruptedRun,
        activeRun: hydratedB.activeRun,
        runStatus: hydratedB.runStatus,
        runError: hydratedB.runError,
        hydratedProjectRoot: hydratedB.hydratedProjectRoot,
      }).toEqual({
        mode: "writing",
        messages: bookBMessages,
        summary: null,
        draftText: "Book B draft",
        draftContextRefs: [],
        pendingProposal: null,
        lastUsage: null,
        interruptedRun: null,
        activeRun: null,
        runStatus: "idle",
        runError: null,
        hydratedProjectRoot: bookB,
      });

      if (liveInput === null) {
        throw new Error("Expected the interrupted Book A stream input.");
      }
      liveResult.resolve({ message: completeAssistant(liveInput), usage });
      liveResultResolved = true;
      await liveSubmission;
      expect(useAgentConsoleStore.getState().messages).toEqual(bookBMessages);

      events.length = 0;
      useProjectStore.setState({ project: project(bookA) });
      await transitionAgentProject(bookA);

      expect(events).toEqual(["write-b", "read-a"]);
      const restoredA = useAgentConsoleStore.getState();
      expect({
        mode: restoredA.mode,
        messages: restoredA.messages,
        summary: restoredA.summary,
        draftText: restoredA.draftText,
        draftContextRefs: restoredA.draftContextRefs,
        pendingProposal: restoredA.pendingProposal,
        lastUsage: restoredA.lastUsage,
        interruptedRun: restoredA.interruptedRun,
        activeRun: restoredA.activeRun,
        runStatus: restoredA.runStatus,
        runError: restoredA.runError,
        hydratedProjectRoot: restoredA.hydratedProjectRoot,
      }).toEqual({
        mode: "edit",
        messages: expectedPersistedBookATranscript,
        summary: null,
        draftText: "Book A draft",
        draftContextRefs: [],
        pendingProposal: expectedBookAProposal,
        lastUsage: usage,
        interruptedRun: expectedInterruptedRun,
        activeRun: null,
        runStatus: "idle",
        runError: null,
        hydratedProjectRoot: bookA,
      });
    } finally {
      unsubscribe();
      if (!liveResultResolved && liveInput !== null) {
        liveResult.resolve({ message: completeAssistant(liveInput), usage });
        await liveSubmission;
      }
      dateSpy.mockRestore();
    }
  });
});
