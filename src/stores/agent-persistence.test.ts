// @vitest-environment happy-dom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentMessageMetadata,
  AgentPersistenceIssue,
  AgentUIMessage,
  DraftContextRef,
  PendingProposal,
  PersistedAgentState,
  PersistedUsage,
} from "@/lib/ai/agent-types";
import {
  dispatchAgentIntent,
  submitAgentRequest,
} from "@/lib/ai/agent-controller";
import { resetAiProvider } from "@/lib/ai/model";
import { EMPTY_META } from "@/lib/migration";
import type { ProjectInfo } from "@/lib/types";
import { useAgentConsoleStore } from "@/stores/agent-console-store";
import {
  AgentPersistenceError,
  agentStateKey,
  emptyPersistedAgentState,
  fromAgentSnapshot,
  loadAgentState,
  resetAgentConversation,
  retryAgentPersistence,
  saveAgentState,
  toAgentSnapshot,
  transitionAgentProject,
  useAgentPersistence,
} from "@/stores/agent-persistence";
import { useProjectStore } from "@/stores/project-store";
import { useSettingsStore } from "@/stores/settings-store";

const tauri = vi.hoisted(() => ({
  getAiConfig: vi.fn(),
  readAppData: vi.fn(),
  writeAppData: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return {
    ...actual,
    getAiConfig: tauri.getAiConfig,
    readAppData: tauri.readAppData,
    writeAppData: tauri.writeAppData,
  };
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

interface CapturedFailedWrite {
  kind: "write";
  root: string;
  snapshot: PersistedAgentState;
  issue: AgentPersistenceIssue;
  revision: number;
  recovery: null;
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

const usage: PersistedUsage = {
  modelId: "gpt-5.1",
  inputTokens: 12,
  outputTokens: 8,
  totalTokens: 20,
  contextWindow: 400_000,
  raw: {
    inputTokens: 12,
    inputTokenDetails: {
      noCacheTokens: 12,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    outputTokens: 8,
    outputTokenDetails: { textTokens: 8, reasoningTokens: 0 },
    totalTokens: 20,
  },
};

const metadata: AgentMessageMetadata = {
  runId: "run-1",
  mode: "edit",
  task: {
    kind: "selected-block-edit",
    chapterId: "chapter-1",
    blockIds: ["block-1"],
    operation: "clean",
  },
  state: "complete",
  createdAt: "2026-07-30T12:00:00.000Z",
  error: null,
  errorCode: null,
  retryOf: null,
  usage,
};

function textMessage(
  id: string,
  role: "user" | "assistant",
  text: string,
  state: AgentMessageMetadata["state"],
): AgentUIMessage {
  return {
    id,
    role,
    metadata: { ...metadata, state },
    parts: [{ type: "text", text }],
  };
}

const proposal: PendingProposal = {
  id: "proposal-1",
  kind: "manuscript",
  projectRoot: "/books/one",
  chapterId: "chapter-1",
  summary: "Remove the repeated beat",
  createdAt: "2026-07-30T12:01:00.000Z",
  originatingMessageId: "assistant-1",
  changes: [
    {
      id: "change-1",
      change: {
        kind: "remove",
        blockId: "block-1",
        afterId: null,
        type: null,
        speaker: null,
        newText: null,
        toIndex: null,
        reason: "Repeated beat",
      },
      precondition: {
        kind: "target",
        target: {
          sourceId: "block-1",
          order: 3,
          fingerprint: "fingerprint-1",
          sourceType: "narration",
          label: "Narration block",
          exactText: "The settled proposal precondition.",
          previewText: "The settled proposal precondition.\nA frozen tail beat.",
        },
      },
    },
  ],
};

const diskDraftRef: DraftContextRef = {
  kind: "block",
  chapterId: "chapter-1",
  blockId: "disk-block",
};

const removedDuringLoadRef: DraftContextRef = {
  kind: "block",
  chapterId: "chapter-1",
  blockId: "removed-during-load",
};

const retainedDuringLoadRef: DraftContextRef = {
  kind: "outline-card",
  chapterId: "chapter-1",
  cardId: "retained-during-load",
};

function persistedState(
  draftText: string,
  messages: AgentUIMessage[],
): PersistedAgentState {
  return {
    ...emptyPersistedAgentState(),
    draftText,
    messages,
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
    chapters: [],
  };
}

function captureMutationErrors(mutations: Array<() => void>): unknown[] {
  return mutations.map((mutation) => {
    try {
      mutation();
      return null;
    } catch (error) {
      return error;
    }
  });
}

async function capturePromiseError(promise: Promise<void>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

async function resetPersistence(): Promise<void> {
  tauri.readAppData.mockReset();
  tauri.readAppData.mockResolvedValue(null);
  tauri.writeAppData.mockReset();
  tauri.writeAppData.mockResolvedValue(undefined);
  await retryAgentPersistence();
  await transitionAgentProject(null);
  useAgentConsoleStore.getState().resetProject();
  useProjectStore.setState({ project: null, meta: EMPTY_META });
  useSettingsStore.setState({ aiModel: null });
  resetAiProvider();
  tauri.getAiConfig.mockReset();
  tauri.readAppData.mockClear();
  tauri.writeAppData.mockClear();
}

beforeEach(async () => {
  await resetPersistence();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});

describe("agent persistence", () => {
  it("round-trips a sanitized v3 transcript, draft, mode, and proposal", async () => {
    const messages = [
      textMessage("user-1", "user", "Tighten this scene.", "complete"),
      textMessage("assistant-1", "assistant", "I staged one change.", "complete"),
      {
        id: "assistant-data",
        role: "assistant" as const,
        metadata,
        parts: [
          {
            type: "data-context" as const,
            data: {
              snapshots: [
                {
                  id: "snapshot-1",
                  kind: "block" as const,
                  chapterId: "chapter-1",
                  sourceId: "block-1",
                  order: 3,
                  sourceType: "narration",
                  label: "Submitted narration",
                  exactText: "Frozen submitted context",
                  sourceFingerprint: "fingerprint-1",
                },
              ],
            },
          },
          {
            type: "data-findings" as const,
            data: {
              kind: "critique" as const,
              chapterId: "chapter-1",
              items: [
                {
                  kind: "watch" as const,
                  tag: "Pacing",
                  text: "The transition repeats a beat.",
                  blockIds: ["block-1"],
                },
              ],
            },
          },
          {
            type: "data-compaction" as const,
            data: {
              throughMessageId: "assistant-0",
              text: "Earlier conversation summary",
            },
          },
          {
            type: "data-proposal-event" as const,
            data: {
              proposalId: "proposal-1",
              action: "staged" as const,
              changeCount: 1,
              text: "Staged one manuscript change.",
            },
          },
        ],
      },
    ];
    const blockRef = {
      kind: "block" as const,
      chapterId: "chapter-1",
      blockId: "block-1",
    };
    useAgentConsoleStore.getState().hydrate("/books/one", {
      v: 3,
      mode: "edit",
      messages,
      summary: { text: "Earlier work", throughMessageId: "assistant-0" },
      draftText: "Ask about the ending",
      draftContextRefs: [
        blockRef,
        {
          kind: "outline-card",
          chapterId: "chapter-1",
          cardId: "card-1",
        },
        {
          kind: "finding",
          chapterId: "chapter-1",
          findingId: "finding-1",
        },
      ],
      draftSourceLocators: {
        "block:chapter-1:block-1": {
          order: 3,
          sourceFingerprint: "fingerprint-1",
        },
      },
      pendingProposal: proposal,
      lastUsage: usage,
      interruptedRun: {
        runId: "run-0",
        userMessageId: "user-0",
        assistantMessageId: "assistant-0",
        reason: "stopped",
        interruptedAt: "2026-07-30T11:59:00.000Z",
      },
    });
    useAgentConsoleStore.setState({
      draftContextSources: {
        "block:chapter-1:block-1": {
          ref: blockRef,
          available: true,
          label: "Narration block",
          preview: "Live preview must not persist",
          resolved: {
            kind: "block",
            chapterId: "chapter-1",
            sourceId: "block-1",
            order: 3,
            sourceType: "narration",
            label: "Narration block",
            exactText: "Live source text must not persist",
            sourceFingerprint: "fingerprint-1",
          },
        },
      },
    });

    const snapshot = await toAgentSnapshot();
    const restored = await fromAgentSnapshot("/books/reopened", snapshot);

    expect(restored).toMatchObject({
      v: 3,
      mode: "edit",
      messages,
      draftText: "Ask about the ending",
      draftContextRefs: expect.arrayContaining([blockRef]),
      pendingProposal: {
        ...proposal,
        projectRoot: "/books/reopened",
      },
    });
    expect(snapshot.pendingProposal).not.toHaveProperty("projectRoot");
    expect(JSON.stringify(snapshot)).not.toContain("/books/one");
    expect(JSON.stringify(snapshot)).not.toContain("Live source text must not persist");
    expect(snapshot).not.toHaveProperty("draftContextSources");
  });

  it("round-trips explicit immediate and next-prose insert boundaries", async () => {
    const anchor = {
      sourceId: "block-1",
      order: 0,
      fingerprint: "anchor-fingerprint",
      sourceType: "narration",
      label: "Narration block",
      exactText: "Left boundary.",
      previewText: "Left boundary.",
    };
    const expectedNext = {
      sourceId: "block-2",
      order: 1,
      fingerprint: "successor-fingerprint",
      sourceType: "narration",
      label: "Narration block",
      exactText: "Right boundary.",
      previewText: "Right boundary.",
    };
    const pendingProposal = {
      id: "proposal-insert-boundaries",
      kind: "manuscript" as const,
      chapterId: "chapter-1",
      summary: "Insert at both boundary kinds",
      createdAt: "2026-07-30T12:01:00.000Z",
      originatingMessageId: "assistant-1",
      changes: [
        {
          id: "change-immediate",
          change: {
            kind: "insert" as const,
            blockId: null,
            afterId: "block-1",
            type: "narration" as const,
            speaker: null,
            newText: "Immediate insertion.",
            toIndex: null,
            reason: "Keep the physical boundary",
          },
          precondition: {
            kind: "insert" as const,
            boundary: "immediate" as const,
            anchor,
            expectedNext,
          },
        },
        {
          id: "change-next-prose",
          change: {
            kind: "insert" as const,
            blockId: null,
            afterId: "block-1",
            type: "narration" as const,
            speaker: null,
            newText: "Bridge insertion.",
            toIndex: null,
            reason: "Bridge across non-prose",
          },
          precondition: {
            kind: "insert" as const,
            boundary: "next-prose" as const,
            anchor,
            expectedNext,
          },
        },
      ],
    };

    const restored = await fromAgentSnapshot("/books/reopened", {
      ...emptyPersistedAgentState(),
      pendingProposal,
    });

    expect(restored.pendingProposal).toEqual({
      ...pendingProposal,
      projectRoot: "/books/reopened",
    });
  });

  it("rejects a persisted proposal that claims its own project root", async () => {
    const unsafeProposal = {
      ...proposal,
      projectRoot: "/books/forged",
    };
    const raw = {
      ...emptyPersistedAgentState(),
      pendingProposal: unsafeProposal,
    };

    await expect(fromAgentSnapshot("/books/one", raw)).rejects.toMatchObject({
      issue: { kind: "corrupt", projectRoot: "/books/one" },
    });
  });

  it("rejects a persisted proposal locator without its frozen preview", async () => {
    const raw = {
      ...emptyPersistedAgentState(),
      pendingProposal: {
        id: "proposal-without-preview",
        kind: "manuscript",
        chapterId: "chapter-1",
        summary: "Remove the repeated beat",
        createdAt: "2026-07-30T12:01:00.000Z",
        originatingMessageId: "assistant-1",
        changes: [
          {
            id: "change-1",
            change: proposal.changes[0].change,
            precondition: {
              kind: "target",
              target: {
                sourceId: "block-1",
                order: 3,
                fingerprint: "fingerprint-1",
                sourceType: "narration",
                label: "Narration block",
                exactText: "The settled proposal precondition.",
              },
            },
          },
        ],
      },
    };

    await expect(fromAgentSnapshot("/books/one", raw)).rejects.toMatchObject({
      issue: { kind: "corrupt", projectRoot: "/books/one" },
    });
  });

  it("rejects persisted mismatched pairs for both proposal kinds", async () => {
    const sourceLocator = {
      sourceId: "source-1",
      order: 0,
      fingerprint: "source-fingerprint",
      sourceType: "narration",
      label: "Narration block",
      exactText: "Frozen source.",
      previewText: "Frozen source.",
    };
    const persistedBase = {
      id: "proposal-mismatch",
      chapterId: "chapter-1",
      summary: "Malformed proposal",
      createdAt: "2026-07-30T12:01:00.000Z",
      originatingMessageId: "assistant-1",
    };
    const pendingProposals = [
      {
        ...persistedBase,
        kind: "manuscript",
        changes: [
          {
            id: "change-manuscript",
            change: {
              kind: "rewrite",
              blockId: "source-1",
              afterId: null,
              type: null,
              speaker: null,
              newText: "Rewritten.",
              toIndex: null,
              reason: "Rewrite",
            },
            precondition: {
              kind: "insert",
              boundary: "immediate",
              anchor: null,
              expectedNext: null,
            },
          },
        ],
      },
      {
        ...persistedBase,
        kind: "outline",
        changes: [
          {
            id: "change-outline",
            change: {
              kind: "add",
              cardId: null,
              title: "New beat",
              intention: "Escalate",
              toIndex: null,
              reason: "Add",
            },
            precondition: {
              kind: "card",
              target: sourceLocator,
            },
          },
        ],
      },
    ];

    for (const pendingProposal of pendingProposals) {
      await expect(
        fromAgentSnapshot("/books/one", {
          ...emptyPersistedAgentState(),
          pendingProposal,
        }),
      ).rejects.toMatchObject({
        issue: { kind: "corrupt", projectRoot: "/books/one" },
      });
    }
    expect(tauri.writeAppData).not.toHaveBeenCalled();
  });

  it("replaces runtime tool values with safe summaries before saving", async () => {
    const runtimeMessage: AgentUIMessage = {
      id: "assistant-tool",
      role: "assistant",
      metadata,
      parts: [
        {
          type: "dynamic-tool",
          toolName: "read_chapter",
          toolCallId: "call-1",
          state: "output-available",
          input: { chapterId: "chapter-1" },
          output: {
            kind: "runtime",
            summary: {
              label: "Read chapter",
              target: "Chapter 1",
              detail: "1 block",
              itemCount: 1,
            },
            value: { exactText: "Private live manuscript text" },
          },
        },
      ],
    };
    useAgentConsoleStore.setState({ messages: [runtimeMessage] });

    const snapshot = await toAgentSnapshot();
    await saveAgentState("/books/one", snapshot);

    const written = tauri.writeAppData.mock.calls[0][1] as PersistedAgentState;
    expect(JSON.stringify(written)).not.toContain("Private live manuscript text");
    expect(written.messages[0].parts[0]).toMatchObject({
      state: "output-available",
      output: {
        kind: "summary",
        summary: {
          label: "Read chapter",
          target: "Chapter 1",
          detail: "1 block",
          itemCount: 1,
        },
      },
    });
  });

  it("never saves streaming messages, raw reasoning, or active run state", async () => {
    const completeWithReasoning: AgentUIMessage = {
      id: "assistant-complete",
      role: "assistant",
      metadata,
      parts: [
        { type: "reasoning", text: "Private chain of thought", state: "done" },
        { type: "text", text: "Settled answer" },
      ],
    };
    const streaming = textMessage(
      "assistant-streaming",
      "assistant",
      "Transient partial answer",
      "streaming",
    );
    const stopped = textMessage(
      "assistant-stopped",
      "assistant",
      "Settled partial answer",
      "stopped",
    );
    const failed = textMessage(
      "assistant-error",
      "assistant",
      "Settled failure context",
      "error",
    );
    useAgentConsoleStore.setState({
      messages: [completeWithReasoning, streaming, stopped, failed],
      activeRun: {
        id: "run-live",
        projectRoot: "/books/one",
        mode: "writing",
        task: { kind: "conversation", targetChapterId: "chapter-1" },
        userMessageId: "user-live",
        attachments: [],
        startedAt: "2026-07-30T12:02:00.000Z",
      },
      runStatus: "streaming",
    });

    const snapshot = await toAgentSnapshot();
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.messages.map((message) => message.id)).toEqual([
      "assistant-complete",
      "assistant-stopped",
      "assistant-error",
    ]);
    expect(serialized).not.toContain("Private chain of thought");
    expect(serialized).not.toContain("Transient partial answer");
    expect(snapshot).not.toHaveProperty("activeRun");
    expect(snapshot).not.toHaveProperty("runStatus");
    expect(snapshot).not.toHaveProperty("draftRevision");
    expect(snapshot).not.toHaveProperty("draftTextRevision");
    expect(snapshot).not.toHaveProperty("draftContextVersions");
    expect(snapshot).not.toHaveProperty("draftContextMutationRevisions");
    expect(snapshot).not.toHaveProperty("persistenceTransition");
  });

  it("writes interrupted messages with only settled text and completed tool summaries", async () => {
    const interrupted = [
      {
        id: "assistant-interrupted",
        role: "assistant",
        metadata: { ...metadata, state: "stopped" },
        parts: [
          { type: "text", text: "Retained partial answer", state: "streaming" },
          {
            type: "dynamic-tool",
            toolName: "read_chapter",
            toolCallId: "call-incomplete",
            state: "input-streaming",
            input: { chapterId: "chapter-1", raw: "Transient tool input" },
          },
          {
            type: "dynamic-tool",
            toolName: "read_chapter",
            toolCallId: "call-complete",
            state: "output-available",
            input: { chapterId: "chapter-1" },
            output: {
              kind: "runtime",
              summary: {
                label: "Read chapter",
                target: "Chapter 1",
                detail: "1 block",
                itemCount: 1,
              },
              value: { exactText: "Private runtime tool value" },
            },
          },
        ],
      },
    ] as unknown as AgentUIMessage[];
    useAgentConsoleStore.setState({ messages: interrupted });

    await saveAgentState("/books/one", await toAgentSnapshot());

    const written = tauri.writeAppData.mock.calls[0][1] as PersistedAgentState;
    const serialized = JSON.stringify(written);
    expect(written.messages[0].parts).toHaveLength(2);
    expect(written.messages[0].parts[0]).toMatchObject({
      type: "text",
      state: "done",
    });
    expect(written.messages[0].parts[1]).toMatchObject({
      state: "output-available",
      output: { kind: "summary" },
    });
    expect(serialized).not.toContain("input-streaming");
    expect(serialized).not.toContain("Transient tool input");
    expect(serialized).not.toContain("Private runtime tool value");
  });

  it("migrates v1 and v2 blobs to an empty v3 conversation", async () => {
    const legacyThreads = {
      chapter: [{ role: "user", content: "Do not merge this thread" }],
    };

    await expect(
      fromAgentSnapshot("/books/one", { v: 1, messages: ["legacy"] }),
    ).resolves.toEqual(emptyPersistedAgentState());
    await expect(
      fromAgentSnapshot("/books/one", {
        v: 2,
        entries: {},
        threads: legacyThreads,
      }),
    ).resolves.toEqual(emptyPersistedAgentState());
  });

  it("throws AgentPersistenceError for malformed v3 and does not write it", async () => {
    const malformed = {
      ...emptyPersistedAgentState(),
      draftSourceLocators: undefined,
    };
    tauri.readAppData.mockResolvedValue(malformed);

    const loading = loadAgentState("/books/one");

    await expect(loading).rejects.toBeInstanceOf(AgentPersistenceError);
    await expect(loading).rejects.toMatchObject({
      issue: {
        kind: "corrupt",
        projectRoot: "/books/one",
      },
    });
    expect(tauri.writeAppData).not.toHaveBeenCalled();
  });

  it("rejects an unsafe v3 streaming turn instead of writing it", async () => {
    const unsafe = persistedState("", [
      textMessage(
        "assistant-streaming",
        "assistant",
        "Raw partial stream",
        "streaming",
      ),
    ]);

    await expect(saveAgentState("/books/one", unsafe)).rejects.toMatchObject({
      issue: { kind: "save", projectRoot: "/books/one" },
    });
    expect(tauri.writeAppData).not.toHaveBeenCalled();
  });

  it("rejects a preliminary tool result in a persisted blob", async () => {
    const raw = persistedState("", [
      {
        id: "assistant-preliminary",
        role: "assistant",
        metadata: { ...metadata, state: "stopped" },
        parts: [
          {
            type: "dynamic-tool",
            toolName: "read_chapter",
            toolCallId: "call-preliminary",
            state: "output-available",
            input: { chapterId: "chapter-1" },
            output: {
              kind: "summary",
              summary: {
                label: "Read chapter",
                target: "Chapter 1",
                detail: "Partial result",
                itemCount: 1,
              },
            },
            preliminary: true,
          },
        ],
      },
    ] as unknown as AgentUIMessage[]);

    await expect(fromAgentSnapshot("/books/one", raw)).rejects.toMatchObject({
      issue: { kind: "corrupt", projectRoot: "/books/one" },
    });
  });

  it("keeps live state and exposes Retry after a write failure", async () => {
    await transitionAgentProject("/books/one");
    useAgentConsoleStore.getState().setDraftText("Unsaved agent draft");
    const snapshot = await toAgentSnapshot();
    tauri.writeAppData.mockRejectedValueOnce(new Error("disk full"));

    await expect(saveAgentState("/books/one", snapshot)).rejects.toMatchObject({
      issue: {
        kind: "save",
        projectRoot: "/books/one",
        message: expect.stringContaining("disk full"),
      },
    });

    expect(useAgentConsoleStore.getState()).toMatchObject({
      draftText: "Unsaved agent draft",
      persistenceIssue: {
        kind: "save",
        projectRoot: "/books/one",
      },
    });
    tauri.writeAppData.mockResolvedValue(undefined);
    await retryAgentPersistence();
    expect(useAgentConsoleStore.getState().persistenceIssue).toBeNull();
    expect(tauri.writeAppData).toHaveBeenLastCalledWith(
      agentStateKey("/books/one"),
      expect.objectContaining({ draftText: "Unsaved agent draft" }),
    );
  });

  it("flushes the old root before loading the next root", async () => {
    await transitionAgentProject("/books/old");
    useAgentConsoleStore.getState().setDraftText("Old root draft");
    tauri.readAppData.mockClear();
    tauri.writeAppData.mockClear();
    const write = deferred<void>();
    tauri.writeAppData.mockReturnValueOnce(write.promise);

    const switching = transitionAgentProject("/books/new");
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledTimes(1));

    expect(tauri.writeAppData).toHaveBeenCalledWith(
      agentStateKey("/books/old"),
      expect.objectContaining({ draftText: "Old root draft" }),
    );
    expect(tauri.readAppData).not.toHaveBeenCalled();
    write.resolve(undefined);
    await switching;
    expect(tauri.readAppData).toHaveBeenCalledWith(agentStateKey("/books/new"));
  });

  it("installs cross-root ownership and freezes the old snapshot synchronously", async () => {
    const oldRoot = "/books/ownership-old";
    const nextRoot = "/books/ownership-new";
    await transitionAgentProject(oldRoot);
    const oldRef: DraftContextRef = {
      kind: "block",
      chapterId: "chapter-1",
      blockId: "old-block",
    };
    const store = useAgentConsoleStore.getState();
    store.setMode("edit");
    store.setDraftText("Frozen old draft");
    store.addDraftContextRefs([oldRef]);
    tauri.writeAppData.mockClear();
    tauri.readAppData.mockClear();
    const oldWrite = deferred<void>();
    tauri.writeAppData.mockReturnValueOnce(oldWrite.promise);
    tauri.readAppData.mockResolvedValueOnce(
      persistedState("Loaded new draft", []),
    );
    useProjectStore.setState({
      project: project(nextRoot),
      meta: EMPTY_META,
      status: "ready",
    });

    const switching = transitionAgentProject(nextRoot);
    const mutationError = {
      name: "AgentConsoleOwnershipError",
      agentErrorCode: "transition",
    };
    const immediateState = useAgentConsoleStore.getState();
    const mutationErrors = [
      () => store.setDraftText("Wrong-root text"),
      () => store.setMode("writing"),
      () => store.addDraftContextRefs([retainedDuringLoadRef]),
      () => store.removeDraftContextRef(oldRef),
    ].map((mutation): unknown => {
      try {
        mutation();
        return null;
      } catch (error) {
        return error;
      }
    });
    await expect(
      submitAgentRequest({
        kind: "run",
        mode: "writing",
        text: "Do not run against the old root.",
        refs: [],
        task: { kind: "conversation", targetChapterId: null },
      }),
    ).rejects.toMatchObject(mutationError);
    await dispatchAgentIntent({
      kind: "add-context",
      refs: [retainedDuringLoadRef],
    });
    const transitionRunError = useAgentConsoleStore.getState().runError;
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledOnce());
    const oldWriteCall = structuredClone(tauri.writeAppData.mock.calls[0]);
    const readCallsBeforeRelease = tauri.readAppData.mock.calls.length;
    oldWrite.resolve(undefined);
    await switching;

    expect(immediateState).toMatchObject({
      hydratedProjectRoot: null,
      mode: "edit",
      draftText: "Frozen old draft",
      draftContextRefs: [oldRef],
      persistenceTransition: { projectRoot: nextRoot },
    });
    for (const error of mutationErrors) {
      expect(error).toMatchObject(mutationError);
    }
    expect(transitionRunError).toMatchObject({ code: "transition" });
    expect(tauri.getAiConfig).not.toHaveBeenCalled();
    expect(oldWriteCall).toEqual([
      agentStateKey(oldRoot),
      expect.objectContaining({
        mode: "edit",
        draftText: "Frozen old draft",
        draftContextRefs: [oldRef],
      }),
    ]);
    expect(readCallsBeforeRelease).toBe(0);
    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: nextRoot,
      draftText: "Loaded new draft",
      persistenceTransition: null,
    });
  });

  it("ignores a late load result after a newer project switch", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    tauri.readAppData.mockImplementation((key: string) => {
      if (key === agentStateKey("/books/first")) return first.promise;
      if (key === agentStateKey("/books/second")) return second.promise;
      throw new Error(`Unexpected persistence key: ${key}`);
    });

    const firstSwitch = transitionAgentProject("/books/first");
    await vi.waitFor(() =>
      expect(tauri.readAppData).toHaveBeenCalledWith(
        agentStateKey("/books/first"),
      ),
    );
    const secondSwitch = transitionAgentProject("/books/second");
    first.resolve(
      persistedState("Stale first-project draft", [
        textMessage("first-message", "user", "Stale message", "complete"),
      ]),
    );
    await vi.waitFor(() =>
      expect(tauri.readAppData).toHaveBeenCalledWith(
        agentStateKey("/books/second"),
      ),
    );

    expect(useAgentConsoleStore.getState().draftText).not.toBe(
      "Stale first-project draft",
    );
    second.resolve(
      persistedState("Current second-project draft", [
        textMessage("second-message", "user", "Current message", "complete"),
      ]),
    );
    await Promise.all([firstSwitch, secondSwitch]);
    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: "/books/second",
      draftText: "Current second-project draft",
    });
  });

  it("locks a delayed same-root load before switching and restores only the frozen A state", async () => {
    const root = "/books/loading-a";
    const otherRoot = "/books/loading-b";
    const disk = new Map<string, unknown>();
    disk.set(agentStateKey(root), persistedState("Disk baseline", []));
    let delayedRead: Deferred<unknown> | null = null;
    tauri.readAppData.mockImplementation(async (key: string) =>
      key === agentStateKey(root) && delayedRead !== null
        ? delayedRead.promise
        : structuredClone(disk.get(key) ?? null),
    );
    tauri.writeAppData.mockImplementation(async (key: string, value: unknown) => {
      disk.set(key, structuredClone(value));
    });
    await transitionAgentProject(root);
    useProjectStore.setState({
      project: project(root),
      meta: EMPTY_META,
      status: "ready",
    });
    const store = useAgentConsoleStore.getState();
    const ownedProposal = { ...proposal, projectRoot: root };
    store.setMode("edit");
    store.setDraftText("Frozen A draft");
    store.addDraftContextRefs([retainedDuringLoadRef]);
    store.replacePendingProposal(ownedProposal);
    tauri.readAppData.mockClear();
    tauri.writeAppData.mockClear();
    delayedRead = deferred<unknown>();

    const loading = transitionAgentProject(root);
    await vi.waitFor(() =>
      expect(tauri.readAppData).toHaveBeenCalledWith(agentStateKey(root)),
    );
    const ownershipError = {
      name: "AgentConsoleOwnershipError",
      agentErrorCode: "transition",
    };
    const mutationErrors = captureMutationErrors([
      () => store.setMode("writing"),
      () => store.setDraftText("Rejected A load draft"),
      () => store.setDraftContextRefs([diskDraftRef]),
      () => store.addDraftContextRefs([removedDuringLoadRef]),
      () => store.removeDraftContextRef(retainedDuringLoadRef),
      () => store.removePendingChanges(["change-1"]),
      () => store.clearPendingProposal(),
      () =>
        store.appendLocalMessage(
          textMessage("rejected-local", "assistant", "Rejected", "complete"),
        ),
      () => store.beginPreflight(),
    ]);
    const submissionError = await capturePromiseError(
      submitAgentRequest({
        kind: "run",
        mode: "writing",
        text: "Rejected A load request",
        refs: [],
        task: { kind: "conversation", targetChapterId: null },
      }),
    );
    await dispatchAgentIntent({
      kind: "add-context",
      refs: [retainedDuringLoadRef],
    });
    expect(useAgentConsoleStore.getState().runError).toMatchObject({
      code: "transition",
    });

    useProjectStore.setState({ project: project(otherRoot) });
    const switching = transitionAgentProject(otherRoot);
    const loadedA = structuredClone(disk.get(agentStateKey(root)) ?? null);
    const pendingRead = delayedRead;
    delayedRead = null;
    pendingRead.resolve(loadedA);
    await Promise.all([loading, switching]);

    for (const error of mutationErrors) {
      expect(error).toMatchObject(ownershipError);
    }
    expect(submissionError).toMatchObject(ownershipError);
    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: otherRoot,
      mode: "writing",
      draftText: "",
      draftContextRefs: [],
      pendingProposal: null,
    });

    useProjectStore.setState({ project: project(root) });
    await transitionAgentProject(root);
    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: root,
      mode: "edit",
      draftText: "Frozen A draft",
      draftContextRefs: [retainedDuringLoadRef],
      pendingProposal: ownedProposal,
      persistenceIssue: null,
    });
    expect(JSON.stringify(disk.get(agentStateKey(root)))).not.toContain(
      "Rejected A load draft",
    );
    expect(JSON.stringify(disk.get(agentStateKey(otherRoot)))).not.toContain(
      "Rejected A load draft",
    );
  });

  it("rejects a submit attempt while owned project hydration is active", async () => {
    const root = "/books/loading-submit";
    const loaded = deferred<unknown>();
    tauri.readAppData.mockReturnValueOnce(loaded.promise);
    useProjectStore.setState({
      project: project(root),
      meta: EMPTY_META,
      status: "ready",
    });
    useSettingsStore.setState({ aiModel: "gpt-5.1" });

    const loading = transitionAgentProject(root);
    await vi.waitFor(() =>
      expect(tauri.readAppData).toHaveBeenCalledWith(agentStateKey(root)),
    );
    const submission = submitAgentRequest({
      kind: "run",
      mode: "writing",
      text: "Continue after hydration.",
      refs: [],
      task: { kind: "conversation", targetChapterId: null },
    });
    await expect(submission).rejects.toMatchObject({
      name: "AgentConsoleOwnershipError",
      agentErrorCode: "transition",
    });

    loaded.resolve(null);
    await loading;
    expect(tauri.getAiConfig).not.toHaveBeenCalled();
    expect(useAgentConsoleStore.getState().runStatus).toBe("idle");
  });

  it("aborts the old project's active run before hydrating the new project", async () => {
    await transitionAgentProject("/books/old");
    useProjectStore.setState({
      project: project("/books/old"),
      meta: EMPTY_META,
      status: "ready",
    });
    useSettingsStore.setState({ aiModel: "gpt-5.1" });
    const config = deferred<{ apiKey: string }>();
    tauri.getAiConfig.mockReturnValue(config.promise);
    const submission = submitAgentRequest({
      kind: "run",
      mode: "writing",
      text: "Continue the chapter.",
      refs: [],
      task: { kind: "conversation", targetChapterId: null },
    });
    await vi.waitFor(() => expect(tauri.getAiConfig).toHaveBeenCalledTimes(1));
    expect(useAgentConsoleStore.getState().runStatus).toBe("submitted");
    const loaded = deferred<unknown>();
    tauri.readAppData.mockImplementation((key: string) => {
      if (key === agentStateKey("/books/new")) return loaded.promise;
      return Promise.resolve(null);
    });
    useProjectStore.setState({ project: project("/books/new") });

    const switching = transitionAgentProject("/books/new");
    await vi.waitFor(() =>
      expect(tauri.readAppData).toHaveBeenCalledWith(agentStateKey("/books/new")),
    );

    expect(useAgentConsoleStore.getState()).toMatchObject({
      activeRun: null,
      runStatus: "idle",
      hydratedProjectRoot: null,
    });
    loaded.resolve(persistedState("New root draft", []));
    await switching;
    config.resolve({ apiKey: "test-key" });
    await submission;
    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: "/books/new",
      draftText: "New root draft",
      runStatus: "idle",
    });
  });

  it("retries the immutable old-root snapshot after a switch save fails", async () => {
    await transitionAgentProject("/books/old");
    useAgentConsoleStore.getState().setDraftText("Captured old draft");
    tauri.writeAppData.mockRejectedValueOnce(new Error("temporary failure"));

    await transitionAgentProject("/books/new");
    useAgentConsoleStore.getState().setDraftText("New project draft");
    expect(useAgentConsoleStore.getState().persistenceIssue).toMatchObject({
      kind: "save",
      projectRoot: "/books/old",
    });
    tauri.writeAppData.mockClear();
    await retryAgentPersistence();

    expect(tauri.writeAppData).toHaveBeenCalledWith(
      agentStateKey("/books/old"),
      expect.objectContaining({ draftText: "Captured old draft" }),
    );
    expect(useAgentConsoleStore.getState().persistenceIssue).toBeNull();
  });

  it("keeps old-root failures independent from new-root flushes and retries", async () => {
    useProjectStore.setState({ project: project("/books/old") });
    const persistence = renderHook(() => useAgentPersistence());
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState().hydratedProjectRoot).toBe(
        "/books/old",
      ),
    );
    useAgentConsoleStore.getState().setDraftText("Captured old draft");
    tauri.writeAppData.mockRejectedValueOnce(new Error("old root unavailable"));

    useProjectStore.setState({ project: project("/books/new") });
    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: null,
      persistenceTransition: {
        kind: "load",
        projectRoot: "/books/new",
      },
    });
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState()).toMatchObject({
        hydratedProjectRoot: "/books/new",
        persistenceIssue: {
          kind: "save",
          projectRoot: "/books/old",
        },
      }),
    );
    tauri.writeAppData.mockClear();
    useAgentConsoleStore.getState().setDraftText("New root hidden draft");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledTimes(1));

    expect(tauri.writeAppData).toHaveBeenCalledWith(
      agentStateKey("/books/new"),
      expect.objectContaining({ draftText: "New root hidden draft" }),
    );
    expect(useAgentConsoleStore.getState().persistenceIssue).toMatchObject({
      kind: "save",
      projectRoot: "/books/old",
    });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    vi.useFakeTimers();
    tauri.writeAppData.mockClear();
    useAgentConsoleStore.getState().setDraftText("New root latest draft");
    await retryAgentPersistence();
    await vi.advanceTimersByTimeAsync(400);
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledTimes(2));

    expect(tauri.writeAppData.mock.calls[0]).toEqual([
      agentStateKey("/books/old"),
      expect.objectContaining({ draftText: "Captured old draft" }),
    ]);
    expect(tauri.writeAppData.mock.calls[1]).toEqual([
      agentStateKey("/books/new"),
      expect.objectContaining({ draftText: "New root latest draft" }),
    ]);
    expect(useAgentConsoleStore.getState().persistenceIssue).toBeNull();
    vi.useRealTimers();
    persistence.unmount();
  });

  it("reconciles a retained save before reopening its root", async () => {
    const staleOldState = persistedState("Stale disk draft", [
      textMessage("stale-old", "user", "Stale disk message", "complete"),
    ]);
    tauri.readAppData.mockImplementation((key: string) => {
      if (key === agentStateKey("/books/old")) {
        return Promise.resolve(staleOldState);
      }
      if (key === agentStateKey("/books/new")) {
        return Promise.resolve(persistedState("New root draft", []));
      }
      throw new Error(`Unexpected persistence key: ${key}`);
    });
    useProjectStore.setState({ project: project("/books/old") });
    const persistence = renderHook(() => useAgentPersistence());
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState().hydratedProjectRoot).toBe(
        "/books/old",
      ),
    );
    const staleWrite = deferred<void>();
    tauri.writeAppData.mockReturnValueOnce(staleWrite.promise);
    const staleSaving = saveAgentState(
      "/books/old",
      persistedState("Stale in-flight write", []),
    );
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledTimes(1));
    useAgentConsoleStore.getState().setDraftText("Captured old draft");
    tauri.writeAppData.mockRejectedValueOnce(new Error("old root unavailable"));

    useProjectStore.setState({ project: project("/books/new") });
    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: null,
      persistenceTransition: {
        kind: "load",
        projectRoot: "/books/new",
      },
    });
    staleWrite.resolve(undefined);
    await staleSaving;
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState()).toMatchObject({
        hydratedProjectRoot: "/books/new",
        persistenceIssue: {
          kind: "save",
          projectRoot: "/books/old",
        },
      }),
    );
    expect(useAgentConsoleStore.getState().persistenceIssue).toMatchObject({
      kind: "save",
      projectRoot: "/books/old",
    });
    tauri.readAppData.mockClear();

    useProjectStore.setState({ project: project("/books/old") });
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState()).toMatchObject({
        hydratedProjectRoot: "/books/old",
        draftText: "Captured old draft",
        persistenceIssue: {
          kind: "save",
          projectRoot: "/books/old",
        },
      }),
    );
    expect(tauri.readAppData).not.toHaveBeenCalled();

    tauri.writeAppData.mockClear();
    vi.useFakeTimers();
    useAgentConsoleStore
      .getState()
      .setDraftText("Edited while recovery was pending");
    await vi.advanceTimersByTimeAsync(400);
    expect(tauri.writeAppData).not.toHaveBeenCalled();

    await retryAgentPersistence();
    expect(tauri.writeAppData).toHaveBeenCalledTimes(1);
    expect(tauri.writeAppData.mock.calls[0]).toEqual([
      agentStateKey("/books/old"),
      expect.objectContaining({ draftText: "Captured old draft" }),
    ]);
    await vi.advanceTimersByTimeAsync(400);
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledTimes(2));
    expect(tauri.writeAppData.mock.calls[1]).toEqual([
      agentStateKey("/books/old"),
      expect.objectContaining({
        draftText: "Edited while recovery was pending",
      }),
    ]);

    useAgentConsoleStore.getState().setDraftText("Post-recovery edit");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledTimes(3));
    expect(tauri.writeAppData.mock.calls[2]).toEqual([
      agentStateKey("/books/old"),
      expect.objectContaining({ draftText: "Post-recovery edit" }),
    ]);
    expect(useAgentConsoleStore.getState().persistenceIssue).toBeNull();
    vi.useRealTimers();
    persistence.unmount();
  });

  it("reconciles a successful recovery superseded by a project switch", async () => {
    const root = "/books/stale-recovery-a";
    const otherRoot = "/books/stale-recovery-b";
    const disk = new Map<string, unknown>();
    let failsOldFlush = true;
    let delaysRecovery = false;
    const recoveryWrite = deferred<void>();
    tauri.readAppData.mockImplementation(async (key: string) =>
      structuredClone(disk.get(key) ?? null),
    );
    tauri.writeAppData.mockImplementation(
      async (key: string, value: unknown) => {
        if (key === agentStateKey(root) && failsOldFlush) {
          failsOldFlush = false;
          throw new Error("retain the older A payload");
        }
        if (key === agentStateKey(root) && delaysRecovery) {
          delaysRecovery = false;
          await recoveryWrite.promise;
        }
        disk.set(key, structuredClone(value));
      },
    );
    await transitionAgentProject(root);
    useProjectStore.setState({ project: project(root) });
    useAgentConsoleStore
      .getState()
      .setDraftText("Older retained A payload");
    await transitionAgentProject(otherRoot);
    await transitionAgentProject(root);
    expect(useAgentConsoleStore.getState()).toMatchObject({
      draftText: "Older retained A payload",
      persistenceIssue: { kind: "save", projectRoot: root },
    });
    useAgentConsoleStore
      .getState()
      .setDraftText("Latest frozen A snapshot");
    const latestSnapshot = await toAgentSnapshot();
    tauri.writeAppData.mockClear();
    delaysRecovery = true;

    const recovering = saveAgentState(root, latestSnapshot);
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledOnce());
    useProjectStore.setState({ project: project(otherRoot) });
    const switching = transitionAgentProject(otherRoot);
    recoveryWrite.resolve(undefined);
    await Promise.all([recovering, switching]);
    const stateWhileOtherRoot = {
      hydratedProjectRoot:
        useAgentConsoleStore.getState().hydratedProjectRoot,
      draftText: useAgentConsoleStore.getState().draftText,
      persistenceIssue: useAgentConsoleStore.getState().persistenceIssue,
    };

    useProjectStore.setState({ project: project(root) });
    await transitionAgentProject(root);
    const reopenedState = {
      hydratedProjectRoot:
        useAgentConsoleStore.getState().hydratedProjectRoot,
      draftText: useAgentConsoleStore.getState().draftText,
      persistenceIssue: useAgentConsoleStore.getState().persistenceIssue,
    };
    tauri.writeAppData.mockClear();
    await retryAgentPersistence();
    const diskAfterRetry = disk.get(agentStateKey(root));

    expect(stateWhileOtherRoot).toEqual({
      hydratedProjectRoot: otherRoot,
      draftText: "",
      persistenceIssue: null,
    });
    expect(reopenedState).toEqual({
      hydratedProjectRoot: root,
      draftText: "Latest frozen A snapshot",
      persistenceIssue: null,
    });
    expect(diskAfterRetry).toMatchObject({
      draftText: "Latest frozen A snapshot",
    });
    expect(
      JSON.stringify(disk.get(agentStateKey(otherRoot)) ?? null),
    ).not.toContain("Latest frozen A snapshot");
  });

  it("preserves a newer root-local failure across an older stale recovery success", async () => {
    const root = "/books/recovery-cas-a";
    const otherRoot = "/books/recovery-cas-b";
    const disk = new Map<string, unknown>();
    let failsOldFlush = true;
    let delaysRecovery = false;
    const recoveryWrite = deferred<void>();
    tauri.readAppData.mockImplementation(async (key: string) =>
      structuredClone(disk.get(key) ?? null),
    );
    tauri.writeAppData.mockImplementation(
      async (key: string, value: unknown) => {
        if (key === agentStateKey(root) && failsOldFlush) {
          failsOldFlush = false;
          throw new Error("capture the original A failure");
        }
        if (key === agentStateKey(root) && delaysRecovery) {
          delaysRecovery = false;
          await recoveryWrite.promise;
        }
        disk.set(key, structuredClone(value));
      },
    );
    const mapSet = vi.spyOn(Map.prototype, "set");
    await transitionAgentProject(root);
    useAgentConsoleStore
      .getState()
      .setDraftText("Original retained A payload");
    await transitionAgentProject(otherRoot);
    const failureCallIndex = mapSet.mock.calls.findIndex(
      ([key, value]) =>
        key === root &&
        typeof value === "object" &&
        value !== null &&
        "revision" in value,
    );
    const failureLedger = mapSet.mock.contexts[failureCallIndex];
    mapSet.mockRestore();
    if (!(failureLedger instanceof Map)) {
      throw new Error("Failed-save ledger was not captured.");
    }
    const retainedFailure = failureLedger.get(root) as
      | CapturedFailedWrite
      | undefined;
    if (retainedFailure === undefined || retainedFailure.kind !== "write") {
      throw new Error("Retained write failure was not captured.");
    }

    await transitionAgentProject(root);
    useAgentConsoleStore
      .getState()
      .setDraftText("Older successful recovery payload");
    const recoverySnapshot = await toAgentSnapshot();
    tauri.writeAppData.mockClear();
    delaysRecovery = true;
    const recovering = saveAgentState(root, recoverySnapshot);
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledOnce());
    const switching = transitionAgentProject(otherRoot);
    const newerFailure: CapturedFailedWrite = {
      ...retainedFailure,
      snapshot: persistedState("Newer failed A payload", []),
      issue: {
        kind: "save",
        projectRoot: root,
        message: "Newer A failure",
      },
      revision: retainedFailure.revision + 100,
    };
    failureLedger.set(root, newerFailure);
    recoveryWrite.resolve(undefined);
    await Promise.all([recovering, switching]);

    await transitionAgentProject(root);
    const reopenedState = {
      draftText: useAgentConsoleStore.getState().draftText,
      persistenceIssue: useAgentConsoleStore.getState().persistenceIssue,
    };
    await retryAgentPersistence();

    expect(reopenedState).toEqual({
      draftText: "Newer failed A payload",
      persistenceIssue: newerFailure.issue,
    });
    expect(disk.get(agentStateKey(root))).toMatchObject({
      draftText: "Newer failed A payload",
    });
  });

  it("persists protected recovery edits captured before switching away", async () => {
    const disk = new Map<string, unknown>();
    const persistedOldDrafts: string[] = [];
    let failOldWrite = true;
    tauri.readAppData.mockImplementation((key: string) =>
      Promise.resolve(disk.get(key) ?? null),
    );
    tauri.writeAppData.mockImplementation(
      async (key: string, value: unknown) => {
        if (key === agentStateKey("/books/old") && failOldWrite) {
          failOldWrite = false;
          throw new Error("old root unavailable");
        }
        disk.set(key, structuredClone(value));
        if (key === agentStateKey("/books/old")) {
          persistedOldDrafts.push(
            (value as PersistedAgentState).draftText,
          );
        }
      },
    );
    useProjectStore.setState({ project: project("/books/old") });
    const persistence = renderHook(() => useAgentPersistence());
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState().hydratedProjectRoot).toBe(
        "/books/old",
      ),
    );
    useAgentConsoleStore.getState().setDraftText("Original failed draft");

    useProjectStore.setState({ project: project("/books/new") });
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState().persistenceIssue).toMatchObject({
        kind: "save",
        projectRoot: "/books/old",
      }),
    );
    useProjectStore.setState({ project: project("/books/old") });
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState()).toMatchObject({
        hydratedProjectRoot: "/books/old",
        draftText: "Original failed draft",
      }),
    );
    useAgentConsoleStore
      .getState()
      .setDraftText("Recovery edit before switch");

    useProjectStore.setState({ project: project("/books/new") });
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState().hydratedProjectRoot).toBe(
        "/books/new",
      ),
    );
    await retryAgentPersistence();

    expect(persistedOldDrafts).toEqual([
      "Original failed draft",
      "Recovery edit before switch",
    ]);
    useProjectStore.setState({ project: project("/books/old") });
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState()).toMatchObject({
        hydratedProjectRoot: "/books/old",
        draftText: "Recovery edit before switch",
        persistenceIssue: null,
      }),
    );
    persistence.unmount();
  });

  it("lets a newer queued success supersede an older failed save", async () => {
    useProjectStore.setState({ project: project("/books/one") });
    const persistence = renderHook(() => useAgentPersistence());
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState().hydratedProjectRoot).toBe(
        "/books/one",
      ),
    );
    tauri.writeAppData.mockClear();
    const firstWrite = deferred<void>();
    tauri.writeAppData.mockReturnValueOnce(firstWrite.promise);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    useAgentConsoleStore.getState().setDraftText("Draft A");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledTimes(1));
    useAgentConsoleStore.getState().setDraftText("Draft B");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(tauri.writeAppData).toHaveBeenCalledTimes(1);

    firstWrite.reject(new Error("Draft A failed"));
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledTimes(2));
    expect(tauri.writeAppData.mock.calls[1]).toEqual([
      agentStateKey("/books/one"),
      expect.objectContaining({ draftText: "Draft B" }),
    ]);
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState().persistenceIssue).toBeNull(),
    );

    tauri.writeAppData.mockClear();
    await retryAgentPersistence();
    expect(tauri.writeAppData).toHaveBeenCalledOnce();
    expect(tauri.writeAppData).toHaveBeenCalledWith(
      agentStateKey("/books/one"),
      expect.objectContaining({ draftText: "Draft B" }),
    );
    persistence.unmount();
  });

  it("restores an unsavable old-root source when reopened", async () => {
    await transitionAgentProject("/books/old");
    useAgentConsoleStore.setState({
      draftText: "Recoverable old draft",
      messages: [
        {
          id: "assistant-unknown",
          role: "assistant",
          metadata,
          parts: [{ type: "provider-private", value: "Unsafe payload" }],
        },
      ] as unknown as AgentUIMessage[],
    });

    await transitionAgentProject("/books/new");

    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: "/books/new",
      persistenceIssue: {
        kind: "save",
        projectRoot: "/books/old",
        message: expect.stringContaining(
          "Unknown agent message part cannot be persisted",
        ),
      },
    });
    expect(tauri.writeAppData).not.toHaveBeenCalled();
    tauri.readAppData.mockClear();

    await transitionAgentProject("/books/old");

    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: "/books/old",
      draftText: "Recoverable old draft",
      messages: [
        expect.objectContaining({
          id: "assistant-unknown",
          parts: [{ type: "provider-private", value: "Unsafe payload" }],
        }),
      ],
      persistenceIssue: {
        kind: "save",
        projectRoot: "/books/old",
        message: expect.stringContaining(
          "Unknown agent message part cannot be persisted",
        ),
      },
    });
    expect(tauri.readAppData).not.toHaveBeenCalled();
    await expect(retryAgentPersistence()).rejects.toMatchObject({
      issue: {
        kind: "save",
        projectRoot: "/books/old",
        message: expect.stringContaining(
          "Unknown agent message part cannot be persisted",
        ),
      },
    });

    await saveAgentState("/books/old", emptyPersistedAgentState());
    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: "/books/old",
      draftText: "",
      messages: [],
      persistenceIssue: null,
    });
  });

  it("keeps a failed close save retryable with no active project", async () => {
    useProjectStore.setState({ project: project("/books/closing") });
    const persistence = renderHook(() => useAgentPersistence());
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState().hydratedProjectRoot).toBe(
        "/books/closing",
      ),
    );
    useAgentConsoleStore.getState().setDraftText("Draft before close");
    tauri.writeAppData.mockRejectedValueOnce(new Error("close write failed"));

    useProjectStore.setState({ project: null });
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState()).toMatchObject({
        hydratedProjectRoot: null,
        persistenceIssue: {
          kind: "save",
          projectRoot: "/books/closing",
        },
      }),
    );
    tauri.writeAppData.mockClear();

    window.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();
    expect(tauri.writeAppData).not.toHaveBeenCalled();

    await retryAgentPersistence();
    expect(tauri.writeAppData).toHaveBeenCalledWith(
      agentStateKey("/books/closing"),
      expect.objectContaining({ draftText: "Draft before close" }),
    );
    expect(useAgentConsoleStore.getState().persistenceIssue).toBeNull();
    persistence.unmount();
  });

  it("rejects a persisted system prompt without overwriting the blob", async () => {
    const raw = persistedState("", [
      {
        id: "system-1",
        role: "system",
        metadata,
        parts: [{ type: "text", text: "Hidden system instructions" }],
      },
    ]);

    await expect(fromAgentSnapshot("/books/one", raw)).rejects.toMatchObject({
      issue: { kind: "corrupt", projectRoot: "/books/one" },
    });
    expect(tauri.writeAppData).not.toHaveBeenCalled();
  });

  it("debounces writable console changes through the serialized save path", async () => {
    useProjectStore.setState({ project: project("/books/one") });
    const persistence = renderHook(() => useAgentPersistence());
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState().hydratedProjectRoot).toBe(
        "/books/one",
      ),
    );
    tauri.writeAppData.mockClear();
    vi.useFakeTimers();

    useAgentConsoleStore.getState().setDraftText("Debounced draft");
    await vi.advanceTimersByTimeAsync(400);
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledTimes(1));

    expect(tauri.writeAppData).toHaveBeenCalledWith(
      agentStateKey("/books/one"),
      expect.objectContaining({ draftText: "Debounced draft" }),
    );
    vi.useRealTimers();
    persistence.unmount();
  });

  it("flushes hidden state without aborting the active run", async () => {
    useProjectStore.setState({ project: project("/books/one") });
    const persistence = renderHook(() => useAgentPersistence());
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState().hydratedProjectRoot).toBe(
        "/books/one",
      ),
    );
    tauri.writeAppData.mockClear();
    const activeRun = {
      id: "run-visible",
      projectRoot: "/books/one",
      mode: "writing" as const,
      task: { kind: "conversation" as const, targetChapterId: null },
      userMessageId: "user-visible",
      attachments: [],
      startedAt: "2026-07-30T12:03:00.000Z",
    };
    useAgentConsoleStore.setState({
      activeRun,
      runStatus: "streaming",
      messages: [
        textMessage(
          "assistant-visible",
          "assistant",
          "Unsaved transient stream",
          "streaming",
        ),
      ],
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledTimes(1));

    expect(useAgentConsoleStore.getState()).toMatchObject({
      activeRun,
      runStatus: "streaming",
    });
    expect(JSON.stringify(tauri.writeAppData.mock.calls[0][1])).not.toContain(
      "Unsaved transient stream",
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    persistence.unmount();
  });

  it("aborts on page hide before flushing the settled app-exit state", async () => {
    useProjectStore.setState({
      project: project("/books/one"),
      meta: EMPTY_META,
      status: "ready",
    });
    useSettingsStore.setState({ aiModel: "gpt-5.1" });
    const persistence = renderHook(() => useAgentPersistence());
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState().hydratedProjectRoot).toBe(
        "/books/one",
      ),
    );
    const config = deferred<{ apiKey: string }>();
    tauri.getAiConfig.mockReturnValue(config.promise);
    const submission = submitAgentRequest({
      kind: "run",
      mode: "writing",
      text: "Continue the chapter.",
      refs: [],
      task: { kind: "conversation", targetChapterId: null },
    });
    await vi.waitFor(() => expect(tauri.getAiConfig).toHaveBeenCalledTimes(1));
    tauri.writeAppData.mockClear();

    window.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledTimes(1));

    expect(useAgentConsoleStore.getState()).toMatchObject({
      activeRun: null,
      runStatus: "idle",
    });
    config.resolve({ apiKey: "test-key" });
    await submission;
    expect(useAgentConsoleStore.getState().runStatus).toBe("idle");
    persistence.unmount();
  });

  it("rejects a wrong-root reset before touching state, disk, or the save timer", async () => {
    const root = "/books/current-reset-owner";
    const wrongRoot = "/books/stale-reset-dialog";
    useProjectStore.setState({ project: project(root) });
    const persistence = renderHook(() => useAgentPersistence());
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState().hydratedProjectRoot).toBe(root),
    );
    tauri.writeAppData.mockClear();
    vi.useFakeTimers();
    useAgentConsoleStore.getState().setDraftText("Current root draft");
    const stateBeforeReset = useAgentConsoleStore.getState();

    expect(() => resetAgentConversation(wrongRoot)).toThrowError(
      expect.objectContaining({
        name: "AgentConsoleOwnershipError",
        agentErrorCode: "transition",
      }),
    );
    expect(useAgentConsoleStore.getState()).toBe(stateBeforeReset);
    expect(tauri.writeAppData).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledOnce());
    expect(tauri.writeAppData).toHaveBeenCalledWith(
      agentStateKey(root),
      expect.objectContaining({ draftText: "Current root draft" }),
    );
    vi.useRealTimers();
    persistence.unmount();
  });

  it("rejects reset authority after the console closes to null", async () => {
    const root = "/books/closed-reset";
    await transitionAgentProject(root);
    await transitionAgentProject(null);
    tauri.writeAppData.mockClear();
    const stateBeforeReset = useAgentConsoleStore.getState();

    expect(() => resetAgentConversation(root)).toThrowError(
      expect.objectContaining({ name: "AgentConsoleOwnershipError" }),
    );
    expect(useAgentConsoleStore.getState()).toBe(stateBeforeReset);
    await Promise.resolve();
    expect(tauri.writeAppData).not.toHaveBeenCalled();
  });

  it("rejects reset authority while a same-root transition is active", async () => {
    const root = "/books/active-reset-transition";
    await transitionAgentProject(root);
    tauri.writeAppData.mockClear();
    const store = useAgentConsoleStore.getState();
    const activeTransition = store.beginPersistenceTransition(root, "load");
    const stateBeforeReset = useAgentConsoleStore.getState();

    expect(() => resetAgentConversation(root)).toThrowError(
      expect.objectContaining({ name: "AgentConsoleOwnershipError" }),
    );
    expect(useAgentConsoleStore.getState()).toBe(stateBeforeReset);
    expect(useAgentConsoleStore.getState().persistenceTransition).toEqual(
      activeTransition,
    );
    await Promise.resolve();
    expect(tauri.writeAppData).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "a load I/O failure",
      arrangeRead: () => {
        tauri.readAppData.mockRejectedValueOnce(new Error("read unavailable"));
      },
      issueKind: "load" as const,
    },
    {
      name: "a malformed v3 snapshot",
      arrangeRead: () => {
        tauri.readAppData.mockResolvedValueOnce({
          ...emptyPersistedAgentState(),
          draftSourceLocators: undefined,
        });
      },
      issueKind: "corrupt" as const,
    },
  ])("allows an exact same-root reset after $name", async ({
    arrangeRead,
    issueKind,
  }) => {
    const root = `/books/reset-after-${issueKind}`;
    arrangeRead();
    await transitionAgentProject(root);
    expect(useAgentConsoleStore.getState()).toMatchObject({
      requestedProjectRoot: root,
      activeProjectRoot: root,
      hydratedProjectRoot: null,
      persistenceTransition: null,
      persistenceIssue: { kind: issueKind, projectRoot: root },
    });
    tauri.writeAppData.mockClear();

    await resetAgentConversation(root);

    expect(tauri.writeAppData).toHaveBeenCalledOnce();
    expect(tauri.writeAppData).toHaveBeenCalledWith(
      agentStateKey(root),
      emptyPersistedAgentState(),
    );
    expect(useAgentConsoleStore.getState()).toMatchObject({
      requestedProjectRoot: root,
      activeProjectRoot: root,
      hydratedProjectRoot: root,
      persistenceTransition: null,
      persistenceIssue: null,
    });
  });

  it("leaves corrupt v3 data locked until an explicit safe reset", async () => {
    tauri.readAppData.mockResolvedValue({
      ...emptyPersistedAgentState(),
      draftSourceLocators: undefined,
    });
    useProjectStore.setState({ project: project("/books/corrupt") });
    const persistence = renderHook(() => useAgentPersistence());
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState().persistenceIssue).toMatchObject({
        kind: "corrupt",
        projectRoot: "/books/corrupt",
      }),
    );
    tauri.writeAppData.mockClear();
    vi.useFakeTimers();

    expect(() =>
      useAgentConsoleStore
        .getState()
        .setDraftText("Must not replace corruption"),
    ).toThrowError(
      expect.objectContaining({ name: "AgentConsoleOwnershipError" }),
    );
    await vi.advanceTimersByTimeAsync(400);
    await retryAgentPersistence();

    expect(tauri.writeAppData).not.toHaveBeenCalled();
    await resetAgentConversation("/books/corrupt");
    expect(useAgentConsoleStore.getState().persistenceIssue).toBeNull();
    tauri.writeAppData.mockClear();
    useAgentConsoleStore.getState().setDraftText("Writable after reset");
    await vi.advanceTimersByTimeAsync(400);
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledTimes(1));
    vi.useRealTimers();
    persistence.unmount();
  });

  it("resets a malformed conversation to empty v3 state after an explicit action", async () => {
    const root = "/books/corrupt";
    await transitionAgentProject(root);
    const issue = {
      kind: "corrupt" as const,
      projectRoot: root,
      message: "Malformed agent conversation",
    };
    useAgentConsoleStore.setState({
      mode: "edit",
      messages: [textMessage("user-corrupt", "user", "Keep me", "complete")],
      draftText: "Unreadable draft",
      pendingProposal: { ...proposal, projectRoot: root },
      persistenceIssue: issue,
    });

    await resetAgentConversation(root);

    expect(tauri.writeAppData).toHaveBeenCalledWith(
      agentStateKey(root),
      emptyPersistedAgentState(),
    );
    expect(useAgentConsoleStore.getState()).toMatchObject({
      mode: "writing",
      messages: [],
      draftText: "",
      pendingProposal: null,
      persistenceIssue: null,
      hydratedProjectRoot: root,
    });
  });

  it("restores automatic saves after resetting a malformed conversation", async () => {
    const root = "/books/corrupt";
    tauri.readAppData.mockResolvedValue({
      ...emptyPersistedAgentState(),
      draftSourceLocators: undefined,
    });
    useProjectStore.setState({ project: project(root) });
    const persistence = renderHook(() => useAgentPersistence());
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState().persistenceIssue).toMatchObject({
        kind: "corrupt",
        projectRoot: root,
      }),
    );

    await resetAgentConversation(root);
    tauri.writeAppData.mockClear();
    vi.useFakeTimers();

    useAgentConsoleStore.getState().setDraftText("Writable after reset");
    await vi.advanceTimersByTimeAsync(400);
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledTimes(1));
    expect(tauri.writeAppData).toHaveBeenCalledWith(
      agentStateKey(root),
      expect.objectContaining({ draftText: "Writable after reset" }),
    );

    vi.useRealTimers();
    persistence.unmount();
  });

  it("locks a delayed reset before switching and does not leak rejected A edits", async () => {
    const root = "/books/resetting-a";
    const otherRoot = "/books/resetting-b";
    const disk = new Map<string, unknown>();
    tauri.readAppData.mockImplementation(async (key: string) =>
      structuredClone(disk.get(key) ?? null),
    );
    tauri.writeAppData.mockImplementation(async (key: string, value: unknown) => {
      disk.set(key, structuredClone(value));
    });
    await transitionAgentProject(root);
    useProjectStore.setState({
      project: project(root),
      meta: EMPTY_META,
      status: "ready",
    });
    const store = useAgentConsoleStore.getState();
    store.setDraftText("Draft before reset");
    store.setMode("edit");
    store.addDraftContextRefs([removedDuringLoadRef]);
    store.replacePendingProposal({ ...proposal, projectRoot: root });
    useAgentConsoleStore.setState({
      persistenceIssue: {
        kind: "corrupt",
        projectRoot: root,
        message: "Malformed agent conversation",
      },
    });
    const resetWrite = deferred<void>();
    tauri.writeAppData.mockImplementationOnce(async (key, value) => {
      await resetWrite.promise;
      disk.set(key, structuredClone(value));
    });

    const resetting = resetAgentConversation(root);
    await vi.waitFor(() =>
      expect(tauri.writeAppData).toHaveBeenCalledWith(
        agentStateKey(root),
        emptyPersistedAgentState(),
      ),
    );
    const ownershipError = {
      name: "AgentConsoleOwnershipError",
      agentErrorCode: "transition",
    };
    const mutationErrors = captureMutationErrors([
      () => store.setMode("writing"),
      () => store.setDraftText("Rejected A reset draft"),
      () => store.setDraftContextRefs([retainedDuringLoadRef]),
      () => store.addDraftContextRefs([diskDraftRef]),
      () => store.removeDraftContextRef(removedDuringLoadRef),
      () => store.removePendingChanges(["change-1"]),
      () => store.clearPendingProposal(),
      () =>
        store.appendLocalMessage(
          textMessage("rejected-reset", "assistant", "Rejected", "complete"),
        ),
      () => store.beginPreflight(),
    ]);
    const submissionError = await capturePromiseError(
      submitAgentRequest({
        kind: "run",
        mode: "writing",
        text: "Rejected A reset request",
        refs: [],
        task: { kind: "conversation", targetChapterId: null },
      }),
    );
    await dispatchAgentIntent({
      kind: "add-context",
      refs: [retainedDuringLoadRef],
    });

    useProjectStore.setState({ project: project(otherRoot) });
    const switching = transitionAgentProject(otherRoot);
    resetWrite.resolve(undefined);
    await Promise.all([resetting, switching]);

    for (const error of mutationErrors) {
      expect(error).toMatchObject(ownershipError);
    }
    expect(submissionError).toMatchObject(ownershipError);
    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: otherRoot,
      mode: "writing",
      draftText: "",
      draftContextRefs: [],
      pendingProposal: null,
      persistenceIssue: null,
    });

    useProjectStore.setState({ project: project(root) });
    await transitionAgentProject(root);
    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: root,
      mode: "writing",
      draftText: "",
      draftContextRefs: [],
      pendingProposal: null,
      persistenceIssue: null,
    });
    expect(JSON.stringify(disk.get(agentStateKey(root)))).not.toContain(
      "Rejected A reset draft",
    );
    expect(JSON.stringify(disk.get(agentStateKey(otherRoot)))).not.toContain(
      "Rejected A reset draft",
    );
  });

  it("rejects a second reset while preserving the first serialized write", async () => {
    const root = "/books/two-resets";
    await transitionAgentProject(root);
    useAgentConsoleStore.getState().setDraftText("Before both resets");
    tauri.writeAppData.mockClear();
    const firstWrite = deferred<void>();
    tauri.writeAppData.mockReturnValueOnce(firstWrite.promise);

    const firstReset = resetAgentConversation(root);
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledOnce());
    expect(() =>
      useAgentConsoleStore
        .getState()
        .setDraftText("Between reset requests"),
    ).toThrowError(
      expect.objectContaining({ name: "AgentConsoleOwnershipError" }),
    );
    expect(() => resetAgentConversation(root)).toThrowError(
      expect.objectContaining({ name: "AgentConsoleOwnershipError" }),
    );
    const callsBeforeFirstCompletes = tauri.writeAppData.mock.calls.length;
    const transitionBeforeFirstCompletes =
      useAgentConsoleStore.getState().persistenceTransition;
    firstWrite.resolve(undefined);
    await firstReset;

    expect(callsBeforeFirstCompletes).toBe(1);
    expect(transitionBeforeFirstCompletes).toMatchObject({
      kind: "reset",
      projectRoot: root,
    });
    expect(tauri.writeAppData.mock.calls).toEqual([
      [agentStateKey(root), emptyPersistedAgentState()],
    ]);
    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: root,
      mode: "writing",
      draftText: "",
      messages: [],
      persistenceIssue: null,
      persistenceTransition: null,
    });
  });

  it("serializes delayed recovery and load while rejecting reset", async () => {
    const root = "/books/recovery-overlap";
    const otherRoot = "/books/recovery-overlap-other";
    await transitionAgentProject(root);
    useAgentConsoleStore.getState().setDraftText("Retained recovery draft");
    tauri.writeAppData.mockRejectedValueOnce(new Error("retain this failure"));
    await transitionAgentProject(otherRoot);
    tauri.writeAppData.mockResolvedValue(undefined);
    await transitionAgentProject(root);
    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: root,
      draftText: "Retained recovery draft",
      persistenceIssue: { kind: "save", projectRoot: root },
    });

    const recoveryWrite = deferred<void>();
    let disk: unknown = null;
    tauri.writeAppData.mockClear();
    tauri.readAppData.mockClear();
    tauri.writeAppData.mockImplementationOnce(
      async (_key: string, value: unknown) => {
        await recoveryWrite.promise;
        disk = structuredClone(value);
      },
    );
    tauri.readAppData.mockImplementation(async () => structuredClone(disk));
    const recoverySnapshot = {
      ...emptyPersistedAgentState(),
      draftText: "Explicit recovery",
    };

    const recovering = saveAgentState(root, recoverySnapshot);
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledOnce());
    expect(() => resetAgentConversation(root)).toThrowError(
      expect.objectContaining({ name: "AgentConsoleOwnershipError" }),
    );
    const loading = transitionAgentProject(root);
    const callsBeforeRecoveryCompletes = tauri.writeAppData.mock.calls.length;
    const readsBeforeRecoveryCompletes = tauri.readAppData.mock.calls.length;
    const transitionBeforeRecoveryCompletes =
      useAgentConsoleStore.getState().persistenceTransition;
    recoveryWrite.resolve(undefined);
    await Promise.all([recovering, loading]);

    expect(callsBeforeRecoveryCompletes).toBe(1);
    expect(readsBeforeRecoveryCompletes).toBe(0);
    expect(transitionBeforeRecoveryCompletes).toMatchObject({
      kind: "load",
      projectRoot: root,
    });
    expect(tauri.writeAppData).toHaveBeenCalledOnce();
    expect(disk).toEqual(recoverySnapshot);
    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: root,
      draftText: "Explicit recovery",
      messages: [],
      persistenceIssue: null,
      persistenceTransition: null,
    });
  });

  it("does not hydrate a reset root after project ownership changes", async () => {
    const resetRoot = "/books/resetting";
    const nextRoot = "/books/next";
    const nextMessages = [
      textMessage("user-next", "user", "Keep the next project", "complete"),
    ];
    const persistedNextProposal = {
      id: proposal.id,
      kind: proposal.kind,
      chapterId: proposal.chapterId,
      summary: proposal.summary,
      createdAt: proposal.createdAt,
      originatingMessageId: proposal.originatingMessageId,
      changes: proposal.changes,
    };
    tauri.readAppData
      .mockResolvedValueOnce({
        ...emptyPersistedAgentState(),
        draftSourceLocators: undefined,
      })
      .mockResolvedValueOnce({
        ...emptyPersistedAgentState(),
        mode: "edit",
        messages: nextMessages,
        draftText: "Next project draft",
        pendingProposal: persistedNextProposal,
      });
    await transitionAgentProject(resetRoot);
    expect(useAgentConsoleStore.getState().persistenceIssue).toMatchObject({
      kind: "corrupt",
      projectRoot: resetRoot,
    });
    const resetWrite = deferred<void>();
    tauri.writeAppData.mockReturnValueOnce(resetWrite.promise);

    const resetting = resetAgentConversation(resetRoot);
    await vi.waitFor(() =>
      expect(tauri.writeAppData).toHaveBeenCalledWith(
        agentStateKey(resetRoot),
        emptyPersistedAgentState(),
      ),
    );
    const switching = transitionAgentProject(nextRoot);
    const nextProposal = { ...proposal, projectRoot: nextRoot };

    resetWrite.resolve(undefined);
    await Promise.all([resetting, switching]);

    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: nextRoot,
      mode: "edit",
      messages: nextMessages,
      draftText: "Next project draft",
      pendingProposal: nextProposal,
      persistenceIssue: null,
    });
  });

  it("retains the malformed conversation and issue when reset cannot be written", async () => {
    const root = "/books/corrupt";
    const issue = {
      kind: "corrupt" as const,
      projectRoot: root,
      message: "Malformed agent conversation",
    };
    const messages = [
      textMessage("user-corrupt", "user", "Keep me", "complete"),
    ];
    useAgentConsoleStore.setState({
      mode: "edit",
      messages,
      draftText: "Unreadable draft",
      persistenceIssue: issue,
      requestedProjectRoot: root,
      activeProjectRoot: root,
      hydratedProjectRoot: null,
    });
    tauri.writeAppData.mockRejectedValueOnce(new Error("disk full"));

    await expect(resetAgentConversation(root)).rejects.toThrow("disk full");

    expect(useAgentConsoleStore.getState()).toMatchObject({
      mode: "edit",
      messages,
      draftText: "Unreadable draft",
      persistenceIssue: issue,
    });
  });

  it("rejects agent work when corrupt-root hydration never established ownership", async () => {
    tauri.readAppData.mockResolvedValue({
      ...emptyPersistedAgentState(),
      draftSourceLocators: undefined,
    });
    useProjectStore.setState({
      project: project("/books/corrupt"),
      meta: EMPTY_META,
      status: "ready",
    });
    useSettingsStore.setState({ aiModel: "gpt-5.1" });
    const persistence = renderHook(() => useAgentPersistence());
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState().persistenceIssue).toMatchObject({
        kind: "corrupt",
        projectRoot: "/books/corrupt",
      }),
    );
    const submission = submitAgentRequest({
      kind: "run",
      mode: "writing",
      text: "Continue the chapter.",
      refs: [],
      task: { kind: "conversation", targetChapterId: null },
    });
    await expect(submission).rejects.toMatchObject({
      name: "AgentConsoleOwnershipError",
    });

    window.dispatchEvent(new Event("pagehide"));

    expect(tauri.getAiConfig).not.toHaveBeenCalled();
    expect(useAgentConsoleStore.getState().runStatus).toBe("idle");
    expect(tauri.writeAppData).not.toHaveBeenCalled();
    persistence.unmount();
  });
});
