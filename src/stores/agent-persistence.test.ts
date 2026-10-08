// @vitest-environment happy-dom

import { useNotificationStore } from "@/stores/notification-store";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Book } from "@/book";
import type {
  AgentMessageMetadata,
  AgentTask,
  AgentPersistenceIssue,
  AgentProposalRecord,
  AgentSessionId,
  AgentUIMessage,
  AgentUiTools,
  DraftContextRef,
  PendingProposal,
  PersistedAgentState,
  PersistedUsage,
  ProposalReviewPreconditions,
  ProposalOrigin,
} from "@/lib/ai/agent-types";
import {
  dispatchAgentIntent,
  submitAgentRequest,
} from "@/lib/ai/agent-controller";
import {
  convertAgentMessagesToModel,
  validateAgentMessages,
} from "@/lib/ai/agent-messages";
import { compileAgentPolicy } from "@/lib/ai/agent-prompts";
import {
  createAgentTools,
  type AgentToolEnvironment,
} from "@/lib/ai/agent-tools";
import { resetAiProvider } from "@/lib/ai/model";
import { EMPTY_META } from "@/lib/migration";
import type { ProjectInfo } from "@/lib/types";
import {
  agentSessionStore,
  characterAgentSessionEntries,
  clearCharacterAgentSessions,
  clearOutlineAgentSessions,
  deleteCharacterAgentSession,
  selectPendingProposal,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import {
  AgentPersistenceError,
  agentSessionCollectionKey,
  agentStateKey,
  emptyPersistedAgentState,
  fromAgentSnapshot,
  hydrateAgentCharacterSession,
  hydrateAgentOutlineSession,
  loadAgentState,
  loadAgentSessionCollection,
  canResetAgentSessionPersistence,
  resetAgentConversation,
  retryAgentPersistence,
  retryAgentSessionPersistence,
  saveAgentSessionCollection,
  saveAgentState,
  toAgentSnapshot,
  transitionAgentProject,
  useAgentPersistence,
} from "@/stores/agent-persistence";
import { useProjectStore } from "@/stores/project-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useViewStore } from "@/stores/view-store";

const tauri = vi.hoisted(() => ({
  getAiConfig: vi.fn(),
  readAppData: vi.fn(),
  writeAppData: vi.fn(),
}));

const controller = vi.hoisted(() => ({
  abortAgentRunForProjectSwitch: vi.fn<
    (root: string, reason: "project-switch" | "app-exit") => void
  >(),
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

vi.mock("@/lib/ai/agent-controller", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/agent-controller")>();
  controller.abortAgentRunForProjectSwitch.mockImplementation(
    actual.abortAgentRunForProjectSwitch,
  );
  return {
    ...actual,
    abortAgentRunForProjectSwitch: controller.abortAgentRunForProjectSwitch,
  };
});

vi.mock("@/lib/ai/models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/models")>();
  return {
    ...actual,
    resolveModelContextWindow: vi.fn().mockResolvedValue(400_000),
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

function persistedProposalState(pendingProposal: unknown, proposalId: string): unknown {
  return {
    ...emptyPersistedAgentState(),
    proposalRecords: [{
      proposal: pendingProposal,
      source: { kind: "legacy" },
      decisions: {},
      replacedByProposalId: null,
    }],
    currentProposalId: proposalId,
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

function persistenceToolEnvironment(): AgentToolEnvironment {
  const unavailable = (): never => {
    throw new Error("Persistence validation must not execute tools");
  };
  const run = {
    id: "run-1",
    projectRoot: "/books/one",
    mode: "writing",
    task: { kind: "conversation", targetChapterId: "chapter-1" },
    userMessageId: "user-1",
    attachments: [],
    startedAt: "2026-07-30T12:00:00.000Z",
  } satisfies AgentToolEnvironment["run"];
  return {
    run,
    policy: compileAgentPolicy({
      mode: run.mode,
      task: run.task,
      sessionId: { kind: "project" },
      styleGuide: "",
      editingRules: "",
    }),
    book: new Book({
      project: project(run.projectRoot),
      meta: EMPTY_META,
      chapter: null,
      loadChapter: unavailable,
    }),
    signal: new AbortController().signal,
    assertRunOwnership: unavailable,
    readChapter: unavailable,
    readOutline: unavailable,
    readLore: unavailable,
    runCritique: unavailable,
    runContinuity: unavailable,
    readConversationContext: unavailable,
    getPendingProposal: unavailable,
    buildManuscriptProposal: unavailable,
    buildOutlineProposal: unavailable,
    buildOverviewProposal: unavailable,
    replacePendingProposal: unavailable,
    updateCharacterProfile: unavailable,
  };
}

const registeredToolInputs = {
  ask_author: {
    question: "Did Dad win twice, or should the printed count change?",
    rationale: "The chapter reports three wins but describes only two.",
    options: ["Change the count to two", "Add the missing third win"],
  },
  read_book_manifest: {},
  read_book_metadata: {},
  read_story_knowledge: {},
  read_character: { characterId: "c1" },
  read_chapter_range: { chapterId: "chapter-1", start: 0, limit: 1 },
  search_book: { query: "Dad", chapterIds: null, limit: 1 },
  read_chapter: { chapterId: "chapter-1" },
  read_outline: { chapterId: "chapter-1" },
  read_lore: { query: null },
  run_critique: { chapterId: "chapter-1", focus: null },
  run_continuity: { chapterId: "chapter-1", focus: null },
  read_conversation_context: { messageIds: [] },
  read_pending_proposal: { proposalId: "proposal-1" },
  stage_manuscript_proposal: { summary: "Fix the count", changes: [] },
  stage_outline_proposal: { summary: "Complete the scene", changes: [] },
  stage_overview_proposal: {
    summary: "Clarify Dad's role",
    overview: "PRIVATE PROPOSED OVERVIEW",
    reason: "PRIVATE PROPOSAL REASON",
  },
  update_character_profile: {
    characterId: "c1",
    profile: {
      appearance: null,
      mannerisms: "PRIVATE PROFILE EDIT",
      motivations: null,
      relationships: null,
      history: null,
      voice: null,
    },
  },
} satisfies { [Name in keyof AgentUiTools]: AgentUiTools[Name]["input"] };

const privateRuntimeOutput = {
  kind: "runtime",
  summary: { label: "Read book", target: "Book", detail: "1 item", itemCount: 1 },
  value: {
    chapter: "PRIVATE CHAPTER BODY",
    knowledge: "PRIVATE KNOWLEDGE BODY",
    profile: "PRIVATE PROFILE BODY",
  },
};

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
  useViewStore.setState(useViewStore.getInitialState(), true);
  useSettingsStore.setState({ aiModel: null });
  resetAiProvider();
  tauri.getAiConfig.mockReset();
  controller.abortAgentRunForProjectSwitch.mockClear();
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
  it("covers every registered tool in the persistence regression fixtures", () => {
    expect(Object.keys(registeredToolInputs).sort()).toEqual(
      Object.keys(createAgentTools(persistenceToolEnvironment())).sort(),
    );
  });

  describe.each(["static", "dynamic"])("%s tool persistence", (encoding) => {
    it.each(Object.entries(registeredToolInputs))(
      "saves and reloads registered tool %s through the native persistence path",
      async (name, input) => {
        const disk = new Map<string, unknown>();
        tauri.readAppData.mockImplementation(async (key: string) =>
          disk.has(key) ? structuredClone(disk.get(key)) : null,
        );
        tauri.writeAppData.mockImplementation(async (key: string, value: unknown) => {
          disk.set(key, structuredClone(value));
        });
        const toolPart = encoding === "static"
          ? { type: `tool-${name}` }
          : { type: "dynamic-tool", toolName: name };
        const messages = await validateAgentMessages([
          textMessage("user-1", "user", "Investigate this chapter", "complete"),
          {
            id: `assistant-${name}`,
            role: "assistant",
            metadata,
            parts: [{
              ...toolPart,
              toolCallId: `call-${name}`,
              state: "output-available",
              input,
              output: privateRuntimeOutput,
            }],
          },
        ], createAgentTools(persistenceToolEnvironment()));
        useAgentConsoleStore.setState({ messages });

        const snapshot = await toAgentSnapshot();
        await saveAgentState("/books/one", snapshot);
        const restored = await loadAgentState("/books/one");

        expect(restored.messages).toHaveLength(2);
        expect(restored.messages[1].parts).toEqual(snapshot.messages[1].parts);
        expect(restored.messages[1].parts[0]).toMatchObject({
          ...toolPart,
          state: "output-available",
          output: { kind: "summary" },
        });
        if (name === "ask_author") {
          expect(restored.messages[1].parts[0]).toHaveProperty("input", input);
        }
        for (const serialized of [JSON.stringify(disk.get(agentStateKey("/books/one"))), JSON.stringify(restored)]) {
          for (const marker of ["PRIVATE CHAPTER BODY", "PRIVATE KNOWLEDGE BODY", "PRIVATE PROFILE BODY", "PRIVATE PROPOSED OVERVIEW", "PRIVATE PROPOSAL REASON", "PRIVATE PROFILE EDIT"]) {
            expect(serialized).not.toContain(marker);
          }
        }
      },
    );

    it("rejects unregistered tools without writing them", async () => {
      const toolPart = encoding === "static"
        ? { type: "tool-unregistered_book_tool" }
        : { type: "dynamic-tool", toolName: "unregistered_book_tool" };
      const messages = await validateAgentMessages([{
        id: "assistant-unregistered-tool",
        role: "assistant",
        metadata,
        parts: [{
          ...toolPart,
          toolCallId: "call-unregistered",
          state: "output-available",
          input: {},
          output: {
            kind: "summary",
            summary: { label: "Unknown", target: "Book", detail: "1 item", itemCount: 1 },
          },
        }],
      }]);

      await expect(saveAgentState("/books/one", persistedState("", messages))).rejects.toMatchObject({
        issue: { kind: "save", projectRoot: "/books/one" },
      });
      await expect(fromAgentSnapshot("/books/one", persistedState("", messages))).rejects.toMatchObject({
        issue: { kind: "corrupt", projectRoot: "/books/one" },
      });
      expect(tauri.writeAppData).not.toHaveBeenCalled();
    });

    it("rejects raw runtime bodies on persisted new tools", async () => {
      const toolPart = encoding === "static"
        ? { type: "tool-read_story_knowledge" }
        : { type: "dynamic-tool", toolName: "read_story_knowledge" };
      const messages = await validateAgentMessages([{
        id: "assistant-raw-knowledge",
        role: "assistant",
        metadata,
        parts: [{
          ...toolPart,
          toolCallId: "call-knowledge",
          state: "output-available",
          input: {},
          output: privateRuntimeOutput,
        }],
      }], createAgentTools(persistenceToolEnvironment()));

      await expect(saveAgentState("/books/one", persistedState("", messages))).rejects.toMatchObject({
        issue: { kind: "save", projectRoot: "/books/one" },
      });
      await expect(fromAgentSnapshot("/books/one", persistedState("", messages))).rejects.toMatchObject({
        issue: { kind: "corrupt", projectRoot: "/books/one" },
      });
      expect(tauri.writeAppData).not.toHaveBeenCalled();
    });
  });

  it("reopens scoped editorial questions with book read summaries and retained proposals", async () => {
    const root = "/books/editorial-question";
    const sessionId = { kind: "outline", chapterId: "chapter-1" } satisfies Parameters<typeof agentSessionStore>[0];
    const disk = new Map<string, unknown>();
    tauri.readAppData.mockImplementation(async (key: string) =>
      disk.has(key) ? structuredClone(disk.get(key)) : null,
    );
    tauri.writeAppData.mockImplementation(async (key: string, value: unknown) => {
      disk.set(key, structuredClone(value));
    });
    useProjectStore.setState({ project: project(root) });
    await transitionAgentProject(root);
    const outline = agentSessionStore(sessionId);
    outline.getState().hydrate(root, emptyPersistedAgentState());
    const messages = await validateAgentMessages([
      textMessage("user-1", "user", "Investigate Dad's chapter", "complete"),
      {
        id: "assistant-question",
        role: "assistant",
        metadata: { ...metadata, mode: "writing", task: { kind: "outline-sculpt", chapterId: "chapter-1" } },
        parts: [
          { type: "tool-read_story_knowledge", toolCallId: "call-knowledge", state: "output-available", input: {}, output: privateRuntimeOutput },
          { type: "tool-ask_author", toolCallId: "call-question", state: "output-available", input: registeredToolInputs.ask_author, output: privateRuntimeOutput },
        ],
      },
      textMessage("user-answer", "user", "Change the count to two", "complete"),
    ], createAgentTools(persistenceToolEnvironment()));
    outline.setState({ messages });
    outline.getState().stageProposal({ ...proposal, projectRoot: root }, { kind: "legacy" });

    await saveAgentSessionCollection(root);
    clearOutlineAgentSessions();
    await hydrateAgentOutlineSession(root, sessionId.chapterId);

    const reopened = agentSessionStore(sessionId).getState();
    expect(reopened.messages).toHaveLength(3);
    expect(reopened.messages[1].parts[1]).toMatchObject({
      type: "tool-ask_author",
      input: registeredToolInputs.ask_author,
      output: { kind: "summary" },
    });
    expect(reopened.messages[2].parts[0]).toMatchObject({ text: "Change the count to two" });
    expect(reopened.pendingProposal).toEqual({ ...proposal, projectRoot: root });
    expect(reopened.proposalRecords).toHaveLength(1);
    const saved = JSON.stringify(disk.get(agentSessionCollectionKey(root)));
    expect(saved).toContain(registeredToolInputs.ask_author.question);
    expect(saved).not.toContain("PRIVATE KNOWLEDGE BODY");
    expect(saved).not.toContain("PRIVATE CHAPTER BODY");
    expect(saved).not.toContain("PRIVATE PROFILE BODY");
  });

  it("rejects a persisted character describe task whose ID is blank", async () => {
    const raw = persistedState("", [
      {
        ...textMessage(
          "character-user",
          "user",
          "Describe Mara.",
          "complete",
        ),
        metadata: {
          ...metadata,
          task: { kind: "character-describe", characterId: "" },
        },
      },
    ]);

    await expect(fromAgentSnapshot("/books/one", raw)).rejects.toMatchObject({
      issue: { kind: "corrupt", projectRoot: "/books/one" },
    });
  });

  it("recovers a completed outputless assistant run as a retryable error", async () => {
    const zeroUsage: PersistedUsage = {
      modelId: "gpt-5.6-luna",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextWindow: 1_050_000,
      raw: {
        inputTokens: 0,
        inputTokenDetails: {
          noCacheTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        outputTokens: 0,
        outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
        totalTokens: 0,
      },
    };
    const raw = persistedState("", [
      textMessage("user-empty", "user", "Continue the scene.", "complete"),
      {
        id: "assistant-empty",
        role: "assistant",
        metadata: { ...metadata, usage: zeroUsage },
        parts: [{ type: "step-start" }],
      },
    ]);
    raw.lastUsage = zeroUsage;

    const restored = await fromAgentSnapshot("/books/one", raw);

    expect(restored.messages.at(-1)).toMatchObject({
      id: "assistant-empty",
      metadata: {
        state: "error",
        failure: {
          reason: "unknown",
          message: "A previous AI request could not be completed. Retry the request.",
          action: "retry",
          settingsTarget: null,
        },
        usage: null,
      },
    });
    expect(restored.lastUsage).toBeNull();
  });

  it("migrates legacy raw error fields to a safe failure descriptor", async () => {
    const rawFailure =
      "provider response body at /Users/author/.config/aproprose/openai_key.json";
    const raw = persistedState("", [
      {
        id: "assistant-legacy-error",
        role: "assistant",
        metadata: {
          ...metadata,
          state: "error",
          error: rawFailure,
          errorCode: "transport",
        },
        parts: [{ type: "text", text: "The request failed." }],
      },
    ]);

    const restored = await fromAgentSnapshot("/books/one", raw);
    const restoredMetadata = restored.messages[0].metadata;

    expect(restoredMetadata).toMatchObject({
      state: "error",
      failure: {
        reason: "unknown",
        message: "A previous AI request could not be completed. Retry the request.",
        action: "retry",
        settingsTarget: null,
      },
    });
    expect(restoredMetadata).not.toHaveProperty("error");
    expect(restoredMetadata).not.toHaveProperty("errorCode");
    expect(JSON.stringify(restored)).not.toContain(rawFailure);
    expect(JSON.stringify(restored)).not.toContain("/Users/author");
  });

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
      v: 4,
      mode: "edit",
      draftText: "Ask about the ending",
      draftContextRefs: expect.arrayContaining([blockRef]),
      proposalRecords: [{ proposal: { ...proposal, projectRoot: "/books/reopened" } }],
    });
    expect(restored.messages).toHaveLength(messages.length);
    expect(restored.messages[0].metadata).toMatchObject({ failure: null });
    expect(restored.messages[1].metadata).toMatchObject({ failure: null });
    expect(restored.messages[2].metadata).toMatchObject({ failure: null });
    expect(snapshot.proposalRecords[0].proposal).not.toHaveProperty("projectRoot");
    expect(JSON.stringify(snapshot)).not.toContain("/books/one");
    expect(JSON.stringify(snapshot)).not.toContain("Live source text must not persist");
    expect(snapshot).not.toHaveProperty("draftContextSources");
  });

  it("round-trips edited proposal text", async () => {
    const editableProposal: PendingProposal = {
      id: "proposal-editable",
      kind: "manuscript",
      projectRoot: "/book",
      chapterId: "chapter-1",
      summary: "Soften the opening beat",
      createdAt: "2026-07-30T12:01:00.000Z",
      originatingMessageId: "assistant-1",
      changes: [
        {
          id: "rewrite-1",
          change: {
            kind: "rewrite",
            blockId: "block-1",
            afterId: null,
            type: null,
            speaker: null,
            newText: "The rain struck against the glass.",
            toIndex: null,
            reason: "Temper the weather beat",
          },
          precondition: {
            kind: "target",
            target: {
              sourceId: "block-1",
              order: 0,
              fingerprint: "rewrite-fingerprint",
              sourceType: "narration",
              label: "Opening narration",
              exactText: "The rain hammered against the glass.",
              previewText: "The rain hammered against the glass.",
            },
          },
        },
      ],
    };
    const store = useAgentConsoleStore.getState();
    store.hydrate("/book", emptyPersistedAgentState());
    store.replacePendingProposal(editableProposal);
    store.updatePendingManuscriptText({
      proposalId: "proposal-editable",
      changeId: "rewrite-1",
      newText: "The rain softened against the glass.",
    });

    const snapshot = await toAgentSnapshot();
    const restored = await fromAgentSnapshot("/book", snapshot);

    const restoredProposal = selectPendingProposal(restored, "proposal-editable");
    if (restoredProposal === null || restoredProposal.kind !== "manuscript") {
      throw new Error("Expected a restored manuscript proposal.");
    }
    expect(restoredProposal.changes[0].change.newText).toBe(
      "The rain softened against the glass.",
    );
    expect(restoredProposal.projectRoot).toBe("/book");
  });

  describe("proposal review preconditions", () => {
    const reviewProposals: PendingProposal[] = [
      {
        ...proposal,
        changes: [
          proposal.changes[0],
          { ...proposal.changes[0], id: "change-2" },
        ],
      },
      {
        ...proposal,
        kind: "outline",
        changes: [
          {
            id: "change-1",
            change: {
              kind: "rewrite",
              cardId: "card-1",
              title: "Revised arrival",
              intention: null,
              toIndex: null,
              reason: "Clarify the arrival",
            },
            precondition: {
              kind: "card",
              target: {
                sourceId: "card-1",
                order: 0,
                fingerprint: "card-fingerprint",
                sourceType: "outline-card",
                label: "Arrival",
                exactText: "Arrival",
                previewText: "Arrival",
              },
            },
          },
          {
            id: "change-2",
            change: {
              kind: "add",
              cardId: null,
              title: "Departure",
              intention: "Leave the city",
              toIndex: null,
              reason: "Complete the journey",
            },
            precondition: {
              kind: "outline-order",
              orderFingerprint: "original-outline-order",
            },
          },
        ],
      },
    ];
    const manuscriptReview: ProposalReviewPreconditions = {
      kind: "manuscript",
      changes: {
        "change-2": {
          kind: "target",
          target: {
            sourceId: "block-1",
            order: 2,
            fingerprint: "advanced-fingerprint",
            sourceType: "narration",
            label: "Narration block",
            exactText: "The advanced source.",
            previewText: "The advanced source.",
          },
        },
      },
    };
    const outlineReview: ProposalReviewPreconditions = {
      kind: "outline",
      changes: {
        "change-2": {
          kind: "outline-order",
          orderFingerprint: "advanced-outline-order",
        },
      },
    };
    const appliedDecisions: AgentProposalRecord["decisions"] = {
      "change-1": { status: "applied", decidedAt: "2026-10-07T12:00:00.000Z" },
    };

    function persistedReviewState(args: {
      reviewProposal: PendingProposal;
      reviewPreconditions: unknown;
      decisions: AgentProposalRecord["decisions"];
    }): unknown {
      const { projectRoot: _projectRoot, ...persistedProposal } = args.reviewProposal;
      return {
        ...emptyPersistedAgentState(),
        proposalRecords: [{
          proposal: persistedProposal,
          source: { kind: "legacy" },
          decisions: args.decisions,
          replacedByProposalId: null,
          reviewPreconditions: args.reviewPreconditions,
        }],
        currentProposalId: persistedProposal.id,
      };
    }

    it.each(reviewProposals)("round-trips $kind review preconditions and the original draft", async (reviewProposal) => {
      const reviewPreconditions = reviewProposal.kind === "manuscript"
        ? manuscriptReview
        : outlineReview;
      const record: AgentProposalRecord = {
        proposal: reviewProposal,
        source: { kind: "legacy" },
        decisions: appliedDecisions,
        replacedByProposalId: null,
        reviewPreconditions,
      };
      useAgentConsoleStore.getState().hydrate("/books/one", {
        ...emptyPersistedAgentState(),
        proposalRecords: [record],
        currentProposalId: reviewProposal.id,
      });

      const snapshot = await toAgentSnapshot();
      const restored = await fromAgentSnapshot("/books/reopened", snapshot);

      expect(snapshot.proposalRecords[0].reviewPreconditions).toEqual(reviewPreconditions);
      expect(restored.proposalRecords[0].reviewPreconditions).toEqual(reviewPreconditions);
      expect(restored.proposalRecords[0].proposal).toEqual({
        ...reviewProposal,
        projectRoot: "/books/reopened",
      });
      expect(restored.proposalRecords[0].decisions).toEqual(record.decisions);
    });

    it.each(reviewProposals)("loads empty $kind review preconditions without an applied decision", async (reviewProposal) => {
      const reviewPreconditions = { kind: reviewProposal.kind, changes: {} };

      const restored = await fromAgentSnapshot("/books/one", persistedReviewState({
        reviewProposal,
        reviewPreconditions,
        decisions: {},
      }));

      expect(restored.proposalRecords[0].reviewPreconditions).toEqual(reviewPreconditions);
    });

    it("preserves removed-source review guards through hydration", async () => {
      if (manuscriptReview.kind !== "manuscript") throw new Error("Expected manuscript guards");
      const change = manuscriptReview.changes["change-2"];
      if (change === undefined || change.kind !== "target") throw new Error("Expected target guard");
      const reviewPreconditions: ProposalReviewPreconditions = {
        kind: "manuscript",
        changes: { "change-2": { ...change, target: { ...change.target, removed: true } } },
      };
      const restored = await fromAgentSnapshot("/books/one", persistedReviewState({
        reviewProposal: reviewProposals[0], reviewPreconditions, decisions: appliedDecisions,
      }));
      useAgentConsoleStore.getState().hydrate("/books/one", restored);
      expect(selectPendingProposal(useAgentConsoleStore.getState(), proposal.id)).toMatchObject({
        changes: [{ id: "change-2", precondition: { target: { removed: true } } }],
      });
      expect((await toAgentSnapshot()).proposalRecords[0].reviewPreconditions).toEqual(reviewPreconditions);
    });

    it("loads old v4 proposal records without review preconditions", async () => {
      const { projectRoot: _projectRoot, ...persistedProposal } = proposal;

      const restored = await fromAgentSnapshot(
        "/books/one",
        persistedProposalState(persistedProposal, proposal.id),
      );

      expect(restored.proposalRecords[0]).not.toHaveProperty("reviewPreconditions");
      expect(restored.proposalRecords[0].proposal).toEqual(proposal);
    });

    it.each([
      {
        name: "unknown change IDs",
        reviewPreconditions: {
          kind: "manuscript",
          changes: { unknown: manuscriptReview.changes["change-2"] },
        },
      },
      { name: "a proposal kind mismatch", reviewPreconditions: outlineReview },
      {
        name: "an empty proposal kind mismatch",
        reviewPreconditions: { kind: "outline", changes: {} },
      },
      {
        name: "a manuscript change correlation mismatch",
        reviewPreconditions: {
          kind: "manuscript",
          changes: {
            "change-2": {
              kind: "insert",
              boundary: "immediate",
              anchor: null,
              expectedNext: null,
            },
          },
        },
      },
    ])("rejects review preconditions with $name", async ({ reviewPreconditions }) => {
      const raw = persistedReviewState({
        reviewProposal: reviewProposals[0],
        reviewPreconditions,
        decisions: appliedDecisions,
      });

      await expect(fromAgentSnapshot("/books/one", raw)).rejects.toMatchObject({
        issue: { kind: "corrupt", projectRoot: "/books/one" },
      });
    });

    it("rejects an outline review precondition correlation mismatch", async () => {
      const reviewProposal = reviewProposals[1];
      if (reviewProposal.kind !== "outline") throw new Error("Expected an outline proposal fixture.");
      const raw = persistedReviewState({
        reviewProposal,
        reviewPreconditions: {
          kind: "outline",
          changes: { "change-2": reviewProposal.changes[0].precondition },
        },
        decisions: appliedDecisions,
      });

      await expect(fromAgentSnapshot("/books/one", raw)).rejects.toMatchObject({
        issue: { kind: "corrupt", projectRoot: "/books/one" },
      });
    });

    it.each(["undecided", "dismissed"])("rejects nonempty review preconditions when earlier changes are %s", async (status) => {
      const raw = persistedReviewState({
        reviewProposal: reviewProposals[0],
        reviewPreconditions: manuscriptReview,
        decisions: status === "dismissed"
          ? { "change-1": { status: "dismissed", decidedAt: "2026-10-07T12:00:00.000Z" } }
          : {},
      });

      await expect(fromAgentSnapshot("/books/one", raw)).rejects.toMatchObject({
        issue: { kind: "corrupt", projectRoot: "/books/one" },
      });
    });
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

    const restored = await fromAgentSnapshot("/books/reopened", persistedProposalState(pendingProposal, pendingProposal.id));

    expect(selectPendingProposal(restored, pendingProposal.id)).toEqual({
      ...pendingProposal,
      projectRoot: "/books/reopened",
    });
  });

  it("rejects a persisted proposal that claims its own project root", async () => {
    const unsafeProposal = {
      ...proposal,
      projectRoot: "/books/forged",
    };
    const raw = persistedProposalState(unsafeProposal, unsafeProposal.id);

    await expect(fromAgentSnapshot("/books/one", raw)).rejects.toMatchObject({
      issue: { kind: "corrupt", projectRoot: "/books/one" },
    });
  });

  it("rejects a persisted proposal locator without its frozen preview", async () => {
    const raw = persistedProposalState({
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
      }, "proposal-without-preview");

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
        fromAgentSnapshot("/books/one", persistedProposalState(pendingProposal, pendingProposal.id)),
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

  it("round-trips settled character profile update rows", async () => {
    const updateMessage: AgentUIMessage = {
      id: "assistant-character-update",
      role: "assistant",
      metadata: {
        ...metadata,
        task: { kind: "character-describe", characterId: "c1" },
      },
      parts: [
        {
          type: "tool-update_character_profile",
          toolCallId: "call-character-update",
          state: "output-available",
          input: {
            characterId: "c1",
            profile: {
              appearance: null,
              mannerisms: "Counts every door.",
              motivations: null,
              relationships: null,
              history: null,
              voice: null,
            },
          },
          output: {
            kind: "summary",
            summary: {
              label: "Update character profile",
              target: "Mara",
              detail: "1 field",
              itemCount: 1,
            },
          },
        },
      ],
    };
    useAgentConsoleStore.setState({ messages: [updateMessage] });

    const snapshot = await toAgentSnapshot();
    const restored = await fromAgentSnapshot("/books/reopened", snapshot);

    expect(restored.messages[0].parts[0]).toMatchObject({
      type: "tool-update_character_profile",
      state: "output-available",
      output: {
        kind: "summary",
        summary: {
          label: "Update character profile",
          target: "Mara",
          detail: "1 field",
          itemCount: 1,
        },
      },
    });
  });

  it("round-trips safe failed and denied tool lifecycle rows", async () => {
    const untrustedMarkers = [
      "IGNORE-PREVIOUS-INSTRUCTIONS-PRIVATE-TEXT",
      "RELATIVE-TRAVERSAL-PRIVATE-TEXT",
      "UNICODE-CONTROL-PRIVATE-TEXT",
      "ABSOLUTE-PATH-PRIVATE-TEXT",
      "RAW-APPROVAL-PRIVATE-ID",
      "RAW-ERROR-PRIVATE-TEXT",
      "../../",
      "/Users/author/private/",
      String.fromCodePoint(0x2603),
      String.fromCharCode(0),
      "\\u0000",
    ];
    const untrustedProposalId = [
      "../../RELATIVE-TRAVERSAL-PRIVATE-TEXT/",
      "UNICODE-CONTROL-PRIVATE-TEXT",
      String.fromCodePoint(0x2603),
      String.fromCharCode(0),
    ].join("");
    const unsafeLifecycleMessage = {
      id: "assistant-tool-lifecycle",
      role: "assistant",
      metadata: {
        ...metadata,
        state: "error",
        error: "Tool failed",
        errorCode: "tool",
      },
      parts: [
        {
          type: "tool-run_continuity",
          toolCallId: "call-error",
          state: "output-error",
          input: {
            chapterId: "IGNORE-PREVIOUS-INSTRUCTIONS-PRIVATE-TEXT",
            focus: "RAW-ERROR-PRIVATE-TEXT",
          },
          rawInput: "../../RELATIVE-TRAVERSAL-PRIVATE-TEXT",
          errorText:
            "ENOENT /Users/author/private/ABSOLUTE-PATH-PRIVATE-TEXT RAW-ERROR-PRIVATE-TEXT",
        },
        {
          type: "tool-read_pending_proposal",
          toolCallId: "call-denied",
          state: "output-denied",
          input: { proposalId: untrustedProposalId },
          approval: {
            id: "RAW-APPROVAL-PRIVATE-ID",
            approved: false,
            reason: "RAW-ERROR-PRIVATE-TEXT",
          },
        },
      ],
    } as AgentUIMessage;
    useAgentConsoleStore.setState({ messages: [unsafeLifecycleMessage] });

    const snapshot = await toAgentSnapshot();
    const restored = await fromAgentSnapshot("/books/reopened", snapshot);

    expect(restored.messages[0].parts).toEqual([
      {
        type: "tool-run_continuity",
        toolCallId: "call-error",
        state: "output-error",
        input: { chapterId: "Chapter", focus: null },
        errorText: "Tool execution failed.",
      },
      {
        type: "tool-read_pending_proposal",
        toolCallId: "call-denied",
        state: "output-denied",
        input: { proposalId: "Proposal" },
        approval: { id: "call-denied", approved: false },
      },
    ]);
    const modelMessages = await convertAgentMessagesToModel(
      restored.messages,
      {},
    );
    for (const serialized of [
      JSON.stringify(snapshot),
      JSON.stringify(restored),
      JSON.stringify(modelMessages),
    ]) {
      for (const marker of untrustedMarkers) {
        expect(serialized).not.toContain(marker);
      }
    }
  });

  it.each([
    {
      name: "failed",
      part: {
        type: "tool-run_critique",
        toolCallId: "call-error",
        state: "output-error",
        input: {
          chapterId: "/Users/author/private/chapter.tex",
          focus: "PRIVATE PERSISTED FOCUS",
        },
        errorText: "PRIVATE PERSISTED ERROR",
      },
    },
    {
      name: "denied",
      part: {
        type: "tool-stage_manuscript_proposal",
        toolCallId: "call-denied",
        state: "output-denied",
        input: {
          summary: "PRIVATE PERSISTED SUMMARY",
          changes: [],
        },
        approval: {
          id: "PRIVATE PERSISTED APPROVAL",
          approved: false,
          reason: "PRIVATE PERSISTED DENIAL",
        },
      },
    },
  ])("rejects a raw $name tool lifecycle row on load", async ({ part }) => {
    const raw = persistedState("", [
      {
        id: `assistant-${part.state}`,
        role: "assistant",
        metadata: {
          ...metadata,
          state: "error",
          error: "Tool failed",
          errorCode: "tool",
        },
        parts: [part],
      },
    ] as unknown as AgentUIMessage[]);

    await expect(fromAgentSnapshot("/books/one", raw)).rejects.toMatchObject({
      issue: {
        kind: "corrupt",
        projectRoot: "/books/one",
        message: expect.stringContaining("safe settled projections"),
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

  it.each([
    { kind: "outline", chapterId: "waiting-session" },
    { kind: "character", characterId: "waiting-session" },
  ] satisfies Exclude<AgentSessionId, { kind: "project" }>[])(
    "waits for the old project save before hydrating its new $kind session",
    async (sessionId) => {
      const oldRoot = "/books/scoped-save-old";
      const nextRoot = "/books/scoped-save-new";
      useProjectStore.setState({ project: project(oldRoot), status: "ready" });
      await transitionAgentProject(oldRoot);
      useAgentConsoleStore.getState().setDraftText("Old project draft");
      const oldWrite = deferred<void>();
      tauri.writeAppData.mockReturnValueOnce(oldWrite.promise);
      useProjectStore.setState({
        project: project(nextRoot),
        meta: { ...EMPTY_META, characters: [{
          id: "waiting-session", name: "Mara", role: "Courier", color: "#123456",
          profile: { appearance: "", mannerisms: "", motivations: "", relationships: "", history: "", voice: "" },
        }] },
      });
      const switching = transitionAgentProject(nextRoot);
      await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledWith(
        agentStateKey(oldRoot), expect.objectContaining({ draftText: "Old project draft" }),
      ));
      vi.useFakeTimers();
      let settled = false;
      const hydration = (sessionId.kind === "outline"
        ? hydrateAgentOutlineSession(nextRoot, sessionId.chapterId)
        : hydrateAgentCharacterSession(nextRoot, sessionId.characterId)
      ).then(() => {
        settled = true;
        const store = agentSessionStore(sessionId);
        store.getState().setDraftText("New scoped draft");
        store.getState().beginPreflight();
        return store;
      });
      let settledBeforeSave = false;
      try {
        await vi.advanceTimersByTimeAsync(0);
        settledBeforeSave = settled;
      } finally {
        oldWrite.resolve(undefined);
      }
      const [, hydratedStore] = await Promise.all([switching, hydration]);

      expect(settledBeforeSave).toBe(false);
      expect(agentSessionStore(sessionId)).toBe(hydratedStore);
      expect(hydratedStore.getState()).toMatchObject({
        hydratedProjectRoot: nextRoot,
        draftText: "New scoped draft",
        runStatus: "submitted",
      });
      await saveAgentSessionCollection(nextRoot);
      expect(tauri.writeAppData).toHaveBeenCalledWith(
        agentSessionCollectionKey(nextRoot),
        expect.objectContaining({ sessions: expect.objectContaining({
          [`${sessionId.kind}:waiting-session`]: expect.objectContaining({ draftText: "New scoped draft" }),
        }) }),
      );
    },
  );

  it.each([
    { kind: "outline", chapterId: "waiting-session" },
    { kind: "character", characterId: "waiting-session" },
  ] satisfies Exclude<AgentSessionId, { kind: "project" }>[])(
    "cancels stale $kind hydration when the project changes during its wait",
    async (sessionId) => {
      const oldRoot = "/books/scoped-switch-old";
      const firstRoot = "/books/scoped-switch-first";
      const secondRoot = "/books/scoped-switch-second";
      useProjectStore.setState({ project: project(oldRoot), status: "ready" });
      await transitionAgentProject(oldRoot);
      const oldWrite = deferred<void>();
      tauri.writeAppData.mockReturnValueOnce(oldWrite.promise);
      tauri.readAppData.mockImplementation(async (key: string) =>
        key === agentSessionCollectionKey(secondRoot)
          ? { v: 1, sessions: { [`${sessionId.kind}:waiting-session`]: persistedState("Current scoped draft", []) } }
          : null,
      );
      useProjectStore.setState({ project: project(firstRoot) });
      const firstSwitch = transitionAgentProject(firstRoot);
      await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledWith(
        agentStateKey(oldRoot), expect.anything(),
      ));
      const hydration = sessionId.kind === "outline"
        ? hydrateAgentOutlineSession(firstRoot, sessionId.chapterId)
        : hydrateAgentCharacterSession(firstRoot, sessionId.characterId);
      useProjectStore.setState({ project: project(secondRoot) });
      const secondSwitch = transitionAgentProject(secondRoot);
      oldWrite.resolve(undefined);
      await Promise.all([firstSwitch, secondSwitch, hydration]);

      expect(tauri.readAppData).not.toHaveBeenCalledWith(agentSessionCollectionKey(firstRoot));
      expect(agentSessionStore(sessionId).getState()).toMatchObject({
        hydratedProjectRoot: secondRoot,
        draftText: "Current scoped draft",
        persistenceTransition: null,
      });
    },
  );

  it("closes manuscript review synchronously when switching roots", async () => {
    await transitionAgentProject("/books/review-old");
    useAgentConsoleStore.getState().setDraftText("Draft before review switch");
    tauri.writeAppData.mockClear();
    const write = deferred<void>();
    tauri.writeAppData.mockReturnValueOnce(write.promise);
    useViewStore.getState().openManuscriptReview("proposal-1");

    const switching = transitionAgentProject("/books/review-new");
    const reviewIdImmediately =
      useViewStore.getState().manuscriptReviewProposalId;
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledOnce());
    write.resolve(undefined);
    await switching;

    expect(reviewIdImmediately).toBeNull();
  });

  it("closes manuscript review synchronously when closing the project", async () => {
    await transitionAgentProject("/books/review-close");
    useAgentConsoleStore.getState().setDraftText("Draft before review close");
    tauri.writeAppData.mockClear();
    const write = deferred<void>();
    tauri.writeAppData.mockReturnValueOnce(write.promise);
    useViewStore.getState().openManuscriptReview("proposal-1");

    const closing = transitionAgentProject(null);
    const reviewIdImmediately =
      useViewStore.getState().manuscriptReviewProposalId;
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledOnce());
    write.resolve(undefined);
    await closing;

    expect(reviewIdImmediately).toBeNull();
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
      agentFailureReason: "transition",
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
    expect(transitionRunError).toMatchObject({ reason: "transition" });
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
      agentFailureReason: "transition",
    };
    const mutationErrors = captureMutationErrors([
      () => store.setMode("writing"),
      () => store.setDraftText("Rejected A load draft"),
      () => store.setDraftContextRefs([diskDraftRef]),
      () => store.addDraftContextRefs([removedDuringLoadRef]),
      () => store.removeDraftContextRef(retainedDuringLoadRef),
      () => store.decideProposalChanges("proposal-1", ["change-1"], { status: "dismissed", decidedAt: "2026-10-07T12:00:00.000Z" }),
      () => store.restoreProposalChanges("proposal-1", ["change-1"]),
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
      reason: "transition",
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
      agentFailureReason: "transition",
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

  it("aborts an active planner when the project console is unavailable during a switch", async () => {
    const root = "/books/planner-with-unavailable-console";
    useProjectStore.setState({ project: project(root) });
    useAgentConsoleStore.setState({
      requestedProjectRoot: root,
      activeProjectRoot: root,
      hydratedProjectRoot: null,
      persistenceIssue: {
        kind: "load",
        projectRoot: root,
        message: "Project conversation unavailable",
      },
    });
    const planner = agentSessionStore({
      kind: "outline",
      chapterId: "switch-planner",
    });
    planner.getState().hydrate(root, emptyPersistedAgentState());
    planner.getState().beginPreflight();
    controller.abortAgentRunForProjectSwitch.mockClear();

    await transitionAgentProject("/books/next");

    expect(controller.abortAgentRunForProjectSwitch).toHaveBeenCalledWith(
      root,
      "project-switch",
    );
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
      if (
        key === agentSessionCollectionKey("/books/old") ||
        key === agentSessionCollectionKey("/books/new")
      ) {
        return Promise.resolve(null);
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
    expect(tauri.readAppData).not.toHaveBeenCalledWith(
      agentStateKey("/books/old"),
    );
    expect(tauri.readAppData).toHaveBeenCalledWith(
      agentSessionCollectionKey("/books/old"),
    );

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

  it("aborts an active planner on page hide when the project console is unavailable", async () => {
    const root = "/books/pagehide-planner-with-unavailable-console";
    useProjectStore.setState({ project: project(root) });
    const persistence = renderHook(() => useAgentPersistence());
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState().hydratedProjectRoot).toBe(root),
    );
    useAgentConsoleStore.setState({
      hydratedProjectRoot: null,
      persistenceIssue: {
        kind: "corrupt",
        projectRoot: root,
        message: "Project conversation is corrupt",
      },
    });
    const planner = agentSessionStore({
      kind: "outline",
      chapterId: "pagehide-planner",
    });
    planner.getState().hydrate(root, emptyPersistedAgentState());
    planner.getState().beginPreflight();
    controller.abortAgentRunForProjectSwitch.mockClear();

    window.dispatchEvent(new Event("pagehide"));

    expect(controller.abortAgentRunForProjectSwitch).toHaveBeenCalledWith(
      root,
      "app-exit",
    );
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
        agentFailureReason: "transition",
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

  it("retries an unavailable project read and restores its retained Changes", async () => {
    const root = "/books/retry-unavailable-project";
    useAgentConsoleStore.getState().hydrate(
      root,
      persistedState("Recovered project draft", []),
    );
    useAgentConsoleStore.getState().stageProposal(
      { ...proposal, projectRoot: root },
      { kind: "legacy" },
    );
    const recoveredRecords = structuredClone(
      useAgentConsoleStore.getState().proposalRecords,
    );
    const recovered = await toAgentSnapshot();
    expect(recovered.proposalRecords[0].proposal).not.toHaveProperty("projectRoot");
    useAgentConsoleStore.getState().resetProject();
    let projectReads = 0;
    tauri.readAppData.mockImplementation(async (key: string) => {
      if (key === agentStateKey(root)) {
        projectReads += 1;
        if (projectReads === 1) throw new Error("read temporarily unavailable");
        return structuredClone(recovered);
      }
      if (key === agentSessionCollectionKey(root)) return null;
      throw new Error(`Unexpected persistence key: ${key}`);
    });
    useProjectStore.setState({ project: project(root) });
    const persistence = renderHook(() => useAgentPersistence());
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState()).toMatchObject({
        hydratedProjectRoot: null,
        persistenceTransition: null,
        persistenceIssue: { kind: "load", projectRoot: root },
      }),
    );

    await retryAgentSessionPersistence(root, { kind: "project" });

    expect(projectReads).toBe(2);
    expect(useAgentConsoleStore.getState()).toMatchObject({
      requestedProjectRoot: root,
      activeProjectRoot: root,
      hydratedProjectRoot: root,
      persistenceTransition: null,
      persistenceIssue: null,
      draftText: recovered.draftText,
      currentProposalId: proposal.id,
      proposalRecords: recoveredRecords,
    });
    expect(useAgentConsoleStore.getState().proposalRecords[0].proposal.projectRoot)
      .toBe(root);
    expect(selectPendingProposal(useAgentConsoleStore.getState(), proposal.id)?.id).toBe(
      proposal.id,
    );
    expect(tauri.writeAppData).not.toHaveBeenCalled();
    persistence.unmount();
  });

  it("rejects Retry when the project snapshot remains corrupt without replacing it", async () => {
    const root = "/books/retry-corrupt-project";
    const raw = { ...emptyPersistedAgentState(), draftText: 42 };
    const disk = new Map<string, unknown>([[agentStateKey(root), raw]]);
    tauri.readAppData.mockImplementation(async (key: string) =>
      structuredClone(disk.get(key) ?? null),
    );
    tauri.writeAppData.mockImplementation(async (key: string, value: unknown) => {
      disk.set(key, structuredClone(value));
    });
    useProjectStore.setState({ project: project(root) });
    const persistence = renderHook(() => useAgentPersistence());
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState()).toMatchObject({
        hydratedProjectRoot: null,
        persistenceTransition: null,
        persistenceIssue: { kind: "corrupt", projectRoot: root },
      }),
    );

    await expect(
      retryAgentSessionPersistence(root, { kind: "project" }),
    ).rejects.toMatchObject({
      issue: { kind: "corrupt", projectRoot: root },
    });

    expect(tauri.readAppData.mock.calls.filter(
      ([key]) => key === agentStateKey(root),
    )).toHaveLength(2);
    expect(useAgentConsoleStore.getState()).toMatchObject({
      requestedProjectRoot: root,
      activeProjectRoot: root,
      hydratedProjectRoot: null,
      persistenceTransition: null,
      persistenceIssue: { kind: "corrupt", projectRoot: root },
    });
    expect(tauri.writeAppData).not.toHaveBeenCalled();
    expect(disk.get(agentStateKey(root))).toEqual(raw);
    expect(() => useAgentConsoleStore.getState().setDraftText("Unsafe edit"))
      .toThrowError(expect.objectContaining({ name: "AgentConsoleOwnershipError" }));
    persistence.unmount();
  });

  it("does not hydrate a late project Retry after switching to another project", async () => {
    const root = "/books/retry-switch-old";
    const otherRoot = "/books/retry-switch-new";
    const lateRead = deferred<PersistedAgentState>();
    let projectReads = 0;
    tauri.readAppData.mockImplementation(async (key: string) => {
      if (key === agentStateKey(root)) {
        projectReads += 1;
        if (projectReads === 1) throw new Error("read temporarily unavailable");
        return lateRead.promise;
      }
      if (key === agentStateKey(otherRoot)) {
        return persistedState("Current project draft", []);
      }
      if (
        key === agentSessionCollectionKey(root) ||
        key === agentSessionCollectionKey(otherRoot)
      ) return null;
      throw new Error(`Unexpected persistence key: ${key}`);
    });
    useProjectStore.setState({ project: project(root) });
    const persistence = renderHook(() => useAgentPersistence());
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState()).toMatchObject({
        hydratedProjectRoot: null,
        persistenceTransition: null,
        persistenceIssue: { kind: "load", projectRoot: root },
      }),
    );

    const retrying = capturePromiseError(
      retryAgentSessionPersistence(root, { kind: "project" }),
    );
    await vi.waitFor(() => expect(projectReads).toBe(2));
    useProjectStore.setState({ project: project(otherRoot) });
    lateRead.resolve(persistedState("Late old project draft", []));
    await retrying;

    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState()).toMatchObject({
        requestedProjectRoot: otherRoot,
        activeProjectRoot: otherRoot,
        hydratedProjectRoot: otherRoot,
        persistenceTransition: null,
        persistenceIssue: null,
        draftText: "Current project draft",
      }),
    );
    expect(useProjectStore.getState().project?.root).toBe(otherRoot);
    expect(tauri.writeAppData).not.toHaveBeenCalled();
    persistence.unmount();
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

  it("resets a valid conversation while retaining Changes after an explicit action", async () => {
    const root = "/books/corrupt";
    await transitionAgentProject(root);
    const issue = {
      kind: "corrupt" as const,
      projectRoot: root,
      message: "Malformed agent conversation",
    };
    useAgentConsoleStore.getState().stageProposal({ ...proposal, projectRoot: root }, { kind: "legacy" });
    const retainedSnapshot = await toAgentSnapshot();
    useAgentConsoleStore.setState({
      mode: "edit",
      messages: [textMessage("user-corrupt", "user", "Keep me", "complete")],
      draftText: "Unreadable draft",
      persistenceIssue: issue,
    });

    await resetAgentConversation(root);

    expect(tauri.writeAppData).toHaveBeenCalledWith(
      agentStateKey(root),
      { ...emptyPersistedAgentState(), proposalRecords: retainedSnapshot.proposalRecords },
    );
    expect(useAgentConsoleStore.getState()).toMatchObject({
      mode: "writing",
      messages: [],
      draftText: "",
      pendingProposal: null,
      persistenceIssue: null,
      hydratedProjectRoot: root,
    });
    expect(useAgentConsoleStore.getState().proposalRecords).toHaveLength(1);
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
        expect.objectContaining({
          messages: [],
          draftText: "",
          currentProposalId: null,
          proposalRecords: [expect.objectContaining({ proposal: expect.objectContaining({ id: proposal.id }) })],
        }),
      ),
    );
    const ownershipError = {
      name: "AgentConsoleOwnershipError",
      agentFailureReason: "transition",
    };
    const mutationErrors = captureMutationErrors([
      () => store.setMode("writing"),
      () => store.setDraftText("Rejected A reset draft"),
      () => store.setDraftContextRefs([retainedDuringLoadRef]),
      () => store.addDraftContextRefs([diskDraftRef]),
      () => store.removeDraftContextRef(removedDuringLoadRef),
      () => store.decideProposalChanges("proposal-1", ["change-1"], { status: "dismissed", decidedAt: "2026-10-07T12:00:00.000Z" }),
      () => store.restoreProposalChanges("proposal-1", ["change-1"]),
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
        proposalRecords: [{ proposal: persistedNextProposal, source: { kind: "legacy" }, decisions: {}, replacedByProposalId: null }],
        currentProposalId: persistedNextProposal.id,
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
      draftText: "Next project draft",
      pendingProposal: nextProposal,
      persistenceIssue: null,
    });
    expect(useAgentConsoleStore.getState().messages).toMatchObject([
      {
        id: "user-next",
        parts: [{ type: "text", text: "Keep the next project" }],
        metadata: { failure: null },
      },
    ]);
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

  it("migrates a v3 conversation into only the project session", async () => {
    const legacy = {
      ...emptyPersistedAgentState(),
      draftText: "Existing project chat",
    };
    tauri.readAppData.mockResolvedValueOnce(null);

    const collection = await loadAgentSessionCollection("/books/legacy", legacy);

    expect(collection.project.draftText).toBe("Existing project chat");
    expect(collection.outlines).toEqual({});
  });

  it("isolates one corrupt planner session from the remaining collection", async () => {
    tauri.readAppData.mockResolvedValueOnce({
      v: 1,
      sessions: {
        project: emptyPersistedAgentState(),
        "outline:good": {
          ...emptyPersistedAgentState(),
          draftText: "Good planner",
        },
        "outline:bad": { v: 3, draftText: 42 },
      },
    });

    const collection = await loadAgentSessionCollection(
      "/books/planners",
      emptyPersistedAgentState(),
    );

    expect(collection.outlines.good.draftText).toBe("Good planner");
    expect(collection.outlines.bad).toBeUndefined();
    expect(collection.corruptOutlineChapterIds).toEqual(["bad"]);
  });

  it("keeps overlapping planner hydration from resetting an active run", async () => {
    const root = "/books/overlapping-planner-hydration";
    const chapterId = "overlap-chapter";
    const read = deferred<unknown>();
    tauri.readAppData.mockReturnValue(read.promise);
    useProjectStore.setState({ project: project(root) });
    const planner = agentSessionStore({ kind: "outline", chapterId });
    planner.getState().resetProject();

    const firstHydration = hydrateAgentOutlineSession(root, chapterId);
    const secondHydration = hydrateAgentOutlineSession(root, chapterId);
    await vi.waitFor(() => expect(tauri.readAppData).toHaveBeenCalledOnce());
    planner.getState().hydrate(root, emptyPersistedAgentState());
    planner.getState().beginPreflight();
    read.resolve({
      v: 1,
      sessions: {
        [`outline:${chapterId}`]: {
          ...emptyPersistedAgentState(),
          draftText: "Stale hydration draft",
        },
      },
    });
    await Promise.all([firstHydration, secondHydration]);

    expect(tauri.readAppData).toHaveBeenCalledTimes(1);
    expect(planner.getState()).toMatchObject({
      runStatus: "submitted",
      draftText: "",
    });
  });

  it("round trips character conversations in the scoped session collection", async () => {
    const root = "/book";
    const sessionId = { kind: "character" as const, characterId: "c1" };
    const disk = new Map<string, unknown>();
    tauri.readAppData.mockImplementation(async (key: string) =>
      structuredClone(disk.get(key) ?? null),
    );
    tauri.writeAppData.mockImplementation(async (key, value) => {
      disk.set(key, structuredClone(value));
    });
    useProjectStore.setState({
      project: project(root),
      meta: {
        ...EMPTY_META,
        characters: [
          {
            id: "c1",
            name: "Mara",
            color: "#aabbcc",
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
        ],
      },
    });
    useAgentConsoleStore.getState().hydrate(root, emptyPersistedAgentState());
    const character = agentSessionStore(sessionId);
    character.getState().hydrate(root, emptyPersistedAgentState());
    character.setState({
      messages: [
        {
          ...textMessage(
            "character-user",
            "user",
            "Describe Mara.",
            "complete",
          ),
          metadata: {
            ...metadata,
            task: { kind: "character-describe", characterId: "c1" },
          },
        },
        {
          ...textMessage(
            "character-assistant",
            "assistant",
            "Mara is precise.",
            "complete",
          ),
          metadata: {
            ...metadata,
            task: { kind: "character-describe", characterId: "c1" },
          },
        },
      ],
    });

    await saveAgentSessionCollection(root);
    clearCharacterAgentSessions();
    await hydrateAgentCharacterSession(root, "c1");

    expect(agentSessionStore(sessionId).getState().messages).toHaveLength(2);
  });

  it("does not recreate a deleted character session when an in-flight save settles", async () => {
    const root = "/books/deleted-character-save";
    useProjectStore.setState({
      project: project(root),
      meta: {
        ...EMPTY_META,
        characters: [
          {
            id: "c1",
            name: "Mara",
            color: "#aabbcc",
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
        ],
      },
    });
    const persistence = renderHook(() => useAgentPersistence());
    await vi.waitFor(() =>
      expect(useAgentConsoleStore.getState().hydratedProjectRoot).toBe(root),
    );
    tauri.writeAppData.mockClear();
    const pendingWrite = deferred<void>();
    tauri.writeAppData.mockImplementation((key: string) =>
      key === agentSessionCollectionKey(root)
        ? pendingWrite.promise
        : Promise.resolve(),
    );
    vi.useFakeTimers();
    const session = agentSessionStore({
      kind: "character",
      characterId: "c1",
    });
    session.getState().hydrate(root, emptyPersistedAgentState());
    session.getState().setDraftText("Character draft");
    await vi.advanceTimersByTimeAsync(400);
    await vi.waitFor(() =>
      expect(tauri.writeAppData).toHaveBeenCalledWith(
        agentSessionCollectionKey(root),
        expect.anything(),
      ),
    );

    deleteCharacterAgentSession("c1");
    pendingWrite.resolve(undefined);
    await vi.advanceTimersByTimeAsync(0);

    expect(characterAgentSessionEntries()).toEqual([]);
    vi.useRealTimers();
    persistence.unmount();
  });

  it("flushes planner sessions before switching projects", async () => {
    const firstRoot = "/books/first";
    await transitionAgentProject(firstRoot);
    const sessionId = { kind: "outline" as const, chapterId: "chapter-1" };
    const planner = agentSessionStore(sessionId);
    planner.getState().hydrate(firstRoot, emptyPersistedAgentState());
    planner.getState().setDraftText("Planner draft");
    tauri.writeAppData.mockClear();

    await transitionAgentProject("/books/second");

    const collectionWrite = tauri.writeAppData.mock.calls.find(
      ([key]) => key === agentSessionCollectionKey(firstRoot),
    );
    expect(collectionWrite?.[1]).toMatchObject({
      v: 1,
      sessions: {
        "outline:chapter-1": { draftText: "Planner draft" },
      },
    });
  });

  it("preserves planner sessions that have not been opened since restart", async () => {
    const root = "/books/planners";
    useProjectStore.setState({
      project: {
        ...project(root),
        chapters: [
          {
            id: "chapter-1",
            label: "1",
            title: "One",
            file: "chapters/one.tex",
            wordCount: 10,
          },
          {
            id: "chapter-2",
            label: "2",
            title: "Two",
            file: "chapters/two.tex",
            wordCount: 10,
          },
        ],
      },
      meta: EMPTY_META,
    });
    await transitionAgentProject(root);
    const openPlanner = agentSessionStore({
      kind: "outline",
      chapterId: "chapter-1",
    });
    openPlanner.getState().hydrate(root, {
      ...emptyPersistedAgentState(),
      draftText: "Open planner draft",
    });
    tauri.readAppData.mockResolvedValueOnce({
      v: 1,
      sessions: {
        project: emptyPersistedAgentState(),
        "outline:chapter-2": {
          ...emptyPersistedAgentState(),
          draftText: "Unopened planner draft",
        },
      },
    });
    tauri.writeAppData.mockClear();

    await saveAgentSessionCollection(root);

    expect(tauri.writeAppData).toHaveBeenCalledWith(
      agentSessionCollectionKey(root),
      expect.objectContaining({
        sessions: expect.objectContaining({
          "outline:chapter-1": expect.objectContaining({
            draftText: "Open planner draft",
          }),
          "outline:chapter-2": expect.objectContaining({
            draftText: "Unopened planner draft",
          }),
        }),
      }),
    );
  });

  it("serializes planner writes so an older completion cannot overwrite a newer snapshot", async () => {
    const root = "/books/serialized-planner-saves";
    useProjectStore.setState({ project: project(root) });
    useAgentConsoleStore.getState().hydrate(root, emptyPersistedAgentState());
    const planner = agentSessionStore({
      kind: "outline",
      chapterId: "serialized-planner",
    });
    planner.getState().hydrate(root, emptyPersistedAgentState());
    planner.getState().setDraftText("Older planner draft");
    const disk = new Map<string, unknown>();
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    let writeIndex = 0;
    tauri.readAppData.mockImplementation(async (key: string) =>
      structuredClone(disk.get(key) ?? null),
    );
    tauri.writeAppData.mockImplementation(async (key, value) => {
      const completion = writeIndex === 0 ? firstWrite : secondWrite;
      writeIndex += 1;
      await completion.promise;
      disk.set(key, structuredClone(value));
    });

    const olderSave = saveAgentSessionCollection(root);
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledOnce());
    planner.getState().setDraftText("Newer planner draft");
    const newerSave = saveAgentSessionCollection(root);

    expect(tauri.readAppData).toHaveBeenCalledOnce();
    expect(tauri.writeAppData).toHaveBeenCalledOnce();
    firstWrite.resolve(undefined);
    await vi.waitFor(() => expect(tauri.readAppData).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledTimes(2));
    secondWrite.resolve(undefined);
    await Promise.all([olderSave, newerSave]);

    expect(disk.get(agentSessionCollectionKey(root))).toMatchObject({
      sessions: {
        "outline:serialized-planner": {
          draftText: "Newer planner draft",
        },
      },
    });
  });

  it("removes persisted planner sessions for deleted chapters", async () => {
    const root = "/books/planners";
    useProjectStore.setState({
      project: {
        ...project(root),
        chapters: [
          {
            id: "chapter-1",
            label: "1",
            title: "One",
            file: "chapters/one.tex",
            wordCount: 10,
          },
        ],
      },
      meta: EMPTY_META,
    });
    await transitionAgentProject(root);
    tauri.readAppData.mockResolvedValueOnce({
      v: 1,
      sessions: {
        project: emptyPersistedAgentState(),
        "outline:deleted-chapter": {
          ...emptyPersistedAgentState(),
          draftText: "Deleted planner draft",
        },
      },
    });
    tauri.writeAppData.mockClear();

    await saveAgentSessionCollection(root);

    const collectionWrite = tauri.writeAppData.mock.calls.find(
      ([key]) => key === agentSessionCollectionKey(root),
    );
    expect(collectionWrite?.[1]).not.toHaveProperty(
      "sessions.outline:deleted-chapter",
    );
  });

  it("prunes deleted character sessions while preserving outline sessions", async () => {
    const root = "/books/character-pruning";
    useProjectStore.setState({
      project: {
        ...project(root),
        chapters: [
          {
            id: "chapter-1",
            label: "1",
            title: "One",
            file: "chapters/one.tex",
            wordCount: 10,
          },
        ],
      },
      meta: EMPTY_META,
    });
    await transitionAgentProject(root);
    const deletedCharacter = agentSessionStore({
      kind: "character",
      characterId: "deleted-character",
    });
    deletedCharacter.getState().hydrate(root, {
      ...emptyPersistedAgentState(),
      draftText: "Live deleted character draft",
    });
    tauri.readAppData.mockResolvedValueOnce({
      v: 1,
      sessions: {
        project: emptyPersistedAgentState(),
        "outline:chapter-1": {
          ...emptyPersistedAgentState(),
          draftText: "Retained outline draft",
        },
        "character:deleted-character": {
          ...emptyPersistedAgentState(),
          draftText: "Deleted character draft",
        },
      },
    });
    tauri.writeAppData.mockClear();

    await saveAgentSessionCollection(root);

    const collectionWrite = tauri.writeAppData.mock.calls.find(
      ([key]) => key === agentSessionCollectionKey(root),
    );
    expect(collectionWrite?.[1]).toHaveProperty(
      "sessions.outline:chapter-1.draftText",
      "Retained outline draft",
    );
    expect(collectionWrite?.[1]).not.toHaveProperty(
      "sessions.character:deleted-character",
    );
  });
});

it.each(["load", "corrupt"] as const)("records scoped conversation %s failures", async (kind) => {
  const root = `/books/notification-${kind}`;
  useProjectStore.setState({ project: project(root) });
  const planner = agentSessionStore({ kind: "outline", chapterId: "notification-chapter" });
  planner.getState().resetProject();
  if (kind === "load") tauri.readAppData.mockRejectedValueOnce(new Error("read denied"));
  else tauri.readAppData.mockResolvedValueOnce({ v: 1, sessions: { "outline:notification-chapter": { v: 3, draftText: 42 } } });
  await hydrateAgentOutlineSession(root, "notification-chapter");
  expect(useNotificationStore.getState().notifications).toContainEqual(expect.objectContaining({ type: `conversation-${kind}`, projectRoot: root }));
});

it("records scoped conversation collection save failures", async () => {
  const root = "/books/notification-save";
  tauri.readAppData.mockResolvedValueOnce(null);
  tauri.writeAppData.mockRejectedValueOnce(new Error("disk full"));
  await expect(saveAgentSessionCollection(root)).rejects.toThrow("disk full");
  expect(useNotificationStore.getState().notifications).toContainEqual(expect.objectContaining({ type: "conversation-save", projectRoot: root }));
});

describe("retained Changes persistence", () => {
  it("recovers an unsaved scoped result after a failed flush and project switch", async () => {
    const root = "/books/scoped-save-recovery";
    const otherRoot = "/books/scoped-save-recovery-other";
    const sessionId = { kind: "outline" as const, chapterId: "chapter-1" };
    const disk = new Map<string, unknown>();
    let rejectCollectionWrites = true;
    tauri.readAppData.mockImplementation(async (key: string) => disk.get(key) ?? null);
    tauri.writeAppData.mockImplementation(async (key: string, value: unknown) => {
      if (key === agentSessionCollectionKey(root) && rejectCollectionWrites) throw new Error("scoped disk unavailable");
      disk.set(key, structuredClone(value));
    });
    useProjectStore.setState({ project: project(root) });
    await transitionAgentProject(root);
    const outline = agentSessionStore(sessionId);
    outline.getState().hydrate(root, emptyPersistedAgentState());
    outline.getState().stageProposal({ ...proposal, projectRoot: root }, { kind: "legacy" });
    await expect(saveAgentSessionCollection(root)).rejects.toThrow("scoped disk unavailable");
    useProjectStore.setState({ project: project(otherRoot) });
    await transitionAgentProject(otherRoot);
    useProjectStore.setState({ project: project(root) });
    await transitionAgentProject(root);
    const restored = agentSessionStore(sessionId).getState();
    expect(restored.proposalRecords).toHaveLength(1);
    expect(restored.pendingProposal?.id).toBe(proposal.id);
    expect(restored.persistenceIssue).toMatchObject({ kind: "save", projectRoot: root });
    rejectCollectionWrites = false;
    await retryAgentSessionPersistence(root, sessionId);
    expect(agentSessionStore(sessionId).getState().persistenceIssue).toBeNull();
    const collection = await loadAgentSessionCollection(root, emptyPersistedAgentState());
    expect(collection.outlines[sessionId.chapterId].proposalRecords).toHaveLength(1);
    expect(collection.outlines[sessionId.chapterId].currentProposalId).toBe(proposal.id);
  });

  it("eagerly reloads retained outline results without opening their chapter", async () => {
    const root = "/books/eager-changes";
    useAgentConsoleStore.getState().hydrate(root, emptyPersistedAgentState());
    useAgentConsoleStore.getState().stageProposal({ ...proposal, projectRoot: root }, { kind: "legacy" });
    const outlineSnapshot = await toAgentSnapshot();
    useAgentConsoleStore.getState().resetProject();
    tauri.readAppData.mockImplementation(async (key: string) =>
      key === agentStateKey(root)
        ? emptyPersistedAgentState()
        : { v: 1, sessions: { "outline:unopened": outlineSnapshot } },
    );
    useProjectStore.setState({ project: project(root) });
    await transitionAgentProject(root);
    const outline = agentSessionStore({ kind: "outline", chapterId: "unopened" }).getState();
    expect(outline.hydratedProjectRoot).toBe(root);
    expect(outline.pendingProposal?.id).toBe(proposal.id);
    expect(outline.proposalRecords).toHaveLength(1);
  });

  it("saves edits to an older retained record without changing the chat proposal", async () => {
    const root = "/books/edit-history";
    const disk = new Map<string, unknown>();
    tauri.readAppData.mockImplementation(async (key: string) => disk.get(key) ?? null);
    tauri.writeAppData.mockImplementation(async (key: string, value: unknown) => { disk.set(key, structuredClone(value)); });
    useProjectStore.setState({ project: project(root) });
    const persistence = renderHook(() => useAgentPersistence());
    await vi.waitFor(() => expect(useAgentConsoleStore.getState().hydratedProjectRoot).toBe(root));
    vi.useFakeTimers();
    const store = useAgentConsoleStore.getState();
    store.stageProposal({
      ...proposal,
      projectRoot: root,
      changes: [{ ...proposal.changes[0], change: { ...proposal.changes[0].change, kind: "rewrite", newText: "Original result" } }],
    }, { kind: "legacy" });
    store.stageProposal({ ...proposal, id: "newer", projectRoot: root }, { kind: "legacy" });
    store.updatePendingManuscriptText({ proposalId: proposal.id, changeId: "change-1", newText: "Edited retained result" });
    await vi.advanceTimersByTimeAsync(400);
    const saved = await fromAgentSnapshot(root, disk.get(agentStateKey(root)));
    expect(saved.currentProposalId).toBe("newer");
    expect(saved.proposalRecords[0].proposal).toMatchObject({ changes: [{ change: { newText: "Edited retained result" } }] });
    expect(useAgentConsoleStore.getState().pendingProposal?.id).toBe("newer");
    persistence.unmount();
  });

  it("rebuilds the exact current projection after hydration and preserves records on conversation reset", async () => {
    const root = "/books/projection";
    useProjectStore.setState({ project: project(root) });
    await transitionAgentProject(root);
    const store = useAgentConsoleStore.getState();
    store.stageProposal({ ...proposal, projectRoot: root }, { kind: "legacy" });
    store.decideProposalChanges(proposal.id, ["change-1"], { status: "dismissed", decidedAt: "2026-10-07T12:01:00.000Z" });
    store.stageProposal({ ...proposal, id: "current", projectRoot: root }, { kind: "legacy" });
    const snapshot = await toAgentSnapshot();
    store.resetProject();
    store.hydrate(root, await fromAgentSnapshot(root, snapshot));
    expect(useAgentConsoleStore.getState().pendingProposal?.id).toBe("current");
    expect(selectPendingProposal(useAgentConsoleStore.getState(), proposal.id)).toBeNull();
    await resetAgentConversation(root);
    const reset = useAgentConsoleStore.getState();
    expect(reset.currentProposalId).toBeNull();
    expect(reset.pendingProposal).toBeNull();
    expect(reset.proposalRecords).toHaveLength(2);
    expect(selectPendingProposal(reset, "current")?.id).toBe("current");
  });

  it("retains canonical records and their current projection through failed-save recovery", async () => {
    const root = "/books/record-recovery";
    const otherRoot = "/books/record-recovery-other";
    const disk = new Map<string, unknown>();
    let rejectRootWrites = true;
    tauri.readAppData.mockImplementation(async (key: string) => disk.get(key) ?? null);
    tauri.writeAppData.mockImplementation(async (key: string, value: unknown) => {
      if (key === agentStateKey(root) && rejectRootWrites) throw new Error("disk unavailable");
      disk.set(key, structuredClone(value));
    });
    useProjectStore.setState({ project: project(root) });
    await transitionAgentProject(root);
    const store = useAgentConsoleStore.getState();
    store.stageProposal({ ...proposal, projectRoot: root }, { kind: "legacy" });
    store.decideProposalChanges(proposal.id, ["change-1"], { status: "applied", decidedAt: "2026-10-07T12:01:00.000Z" });
    store.stageProposal({ ...proposal, id: "current", projectRoot: root }, { kind: "legacy" });
    await expect(saveAgentState(root, await toAgentSnapshot())).rejects.toThrow("disk unavailable");
    useProjectStore.setState({ project: project(otherRoot) });
    await transitionAgentProject(otherRoot);
    useProjectStore.setState({ project: project(root) });
    await transitionAgentProject(root);
    expect(useAgentConsoleStore.getState().proposalRecords).toHaveLength(2);
    expect(useAgentConsoleStore.getState().pendingProposal?.id).toBe("current");
    expect(selectPendingProposal(useAgentConsoleStore.getState(), proposal.id)).toBeNull();
    rejectRootWrites = false;
    await retryAgentPersistence();
    const saved = await fromAgentSnapshot(root, disk.get(agentStateKey(root)));
    expect(saved.currentProposalId).toBe("current");
    expect(saved.proposalRecords[0].decisions["change-1"].status).toBe("applied");
  });

  it("migrates a v3 pending proposal and persists its payload only inside records", async () => {
    const raw = {
      v: 3,
      mode: "writing",
      messages: [],
      summary: null,
      draftText: "",
      draftContextRefs: [],
      draftSourceLocators: {},
      pendingProposal: {
        kind: proposal.kind,
        id: proposal.id,
        chapterId: proposal.chapterId,
        summary: proposal.summary,
        createdAt: proposal.createdAt,
        originatingMessageId: proposal.originatingMessageId,
        changes: proposal.changes,
      },
      lastUsage: null,
      interruptedRun: null,
    };
    const restored = await fromAgentSnapshot("/books/reopened", raw);
    useAgentConsoleStore.getState().hydrate("/books/reopened", restored);
    const snapshot = await toAgentSnapshot();
    expect(snapshot.v).toBe(4);
    expect(snapshot).not.toHaveProperty("pendingProposal");
    expect(snapshot.proposalRecords).toHaveLength(1);
    expect(snapshot.proposalRecords[0].proposal).not.toHaveProperty("projectRoot");
    expect(useAgentConsoleStore.getState().pendingProposal?.id).toBe(proposal.id);
  });

  it("keeps standalone project state authoritative over a stale collection project", async () => {
    const root = "/books/authority";
    const standalone = { ...emptyPersistedAgentState(), draftText: "Newer project" };
    tauri.readAppData.mockImplementation(async (key: string) =>
      key === agentStateKey(root)
        ? standalone
        : { v: 1, sessions: { project: { ...standalone, draftText: "Stale project" } } },
    );
    useProjectStore.setState({ project: project(root) });
    await transitionAgentProject(root);
    expect(useAgentConsoleStore.getState().draftText).toBe("Newer project");
    await saveAgentSessionCollection(root);
    const write = tauri.writeAppData.mock.calls.find(([key]) => key === agentSessionCollectionKey(root));
    expect(write?.[1]).not.toHaveProperty("sessions.project");
  });

  it("keeps corrupt scoped state unavailable and preserves it while a sibling is saved", async () => {
    const root = "/books/scoped-corruption";
    const corrupt = { v: 4, draftText: 42 };
    const collection = { v: 1, sessions: { "outline:bad": corrupt } };
    tauri.readAppData.mockImplementation(async (key: string) =>
      key === agentStateKey(root) ? emptyPersistedAgentState() : collection,
    );
    useProjectStore.setState({ project: project(root) });
    await transitionAgentProject(root);
    await hydrateAgentOutlineSession(root, "bad");
    const bad = agentSessionStore({ kind: "outline", chapterId: "bad" });
    expect(bad.getState().hydratedProjectRoot).toBeNull();
    expect(bad.getState().persistenceIssue?.kind).toBe("corrupt");
    expect(() => bad.getState().setDraftText("Must not overwrite corruption")).toThrow();
    const good = agentSessionStore({ kind: "outline", chapterId: "chapter-1" });
    good.getState().hydrate(root, emptyPersistedAgentState());
    good.getState().setDraftText("Valid sibling");
    await saveAgentSessionCollection(root);
    const write = tauri.writeAppData.mock.calls.find(([key]) => key === agentSessionCollectionKey(root));
    expect(write?.[1]).toHaveProperty("sessions.outline:bad", corrupt);
  });

  it("resets only a known corrupt scoped entry and preserves its siblings", async () => {
    const root = "/books/scoped-reset";
    const sessionId = { kind: "outline" as const, chapterId: "bad" };
    const sibling = { ...emptyPersistedAgentState(), draftText: "Keep sibling" };
    const collection = { v: 1, sessions: { "outline:bad": { v: 4, draftText: 42 }, "outline:good": sibling } };
    tauri.readAppData.mockImplementation(async (key: string) => key === agentStateKey(root) ? emptyPersistedAgentState() : collection);
    useProjectStore.setState({ project: project(root) });
    await transitionAgentProject(root);
    const bad = agentSessionStore(sessionId);
    await resetAgentConversation(root, sessionId);
    expect(bad.getState().hydratedProjectRoot).toBe(root);
    const write = tauri.writeAppData.mock.calls.find(([key]) => key === agentSessionCollectionKey(root));
    expect(write?.[1]).toHaveProperty("sessions.outline:good", sibling);
    expect(write?.[1]).toHaveProperty("sessions.outline:bad", emptyPersistedAgentState());
  });

  it("preserves a malformed collection envelope and only permits retry", async () => {
    const root = "/books/collection-corrupt";
    const raw = { v: 1, sessions: "unreadable" };
    tauri.readAppData.mockImplementation(async (key: string) => key === agentStateKey(root) ? emptyPersistedAgentState() : raw);
    useProjectStore.setState({ project: project(root) });
    await transitionAgentProject(root);
    const issue = useAgentConsoleStore.getState().persistenceIssue;
    if (issue === null) throw new Error("Expected a collection persistence issue.");
    expect(canResetAgentSessionPersistence(issue)).toBe(false);
    expect(() => resetAgentConversation(root)).toThrow();
    const sessionId = { kind: "outline" as const, chapterId: "chapter-1" };
    await hydrateAgentOutlineSession(root, sessionId.chapterId);
    await expect(retryAgentSessionPersistence(root, sessionId)).rejects.toThrow();
    expect(tauri.writeAppData).not.toHaveBeenCalled();
    expect(raw).toEqual({ v: 1, sessions: "unreadable" });
  });
});


describe("persisted proposal origin receipts", () => {
  const sourceTask = { kind: "selected-block-edit", chapterId: "chapter-1", blockIds: ["block-1"], operation: "clean" } satisfies AgentTask;

  it.each(["edit", "legacy"] as const)("round-trips the %s original mode and selection in optional v4 receipts", async (mode) => {
    if (proposal.kind !== "manuscript" || proposal.changes[0].precondition.kind !== "target") throw new Error("Expected original source receipt");
    const locator = proposal.changes[0].precondition.target;
    const origin: ProposalOrigin = { kind: "selected-block-edit", mode, chapterId: "chapter-1", operation: "clean", blocks: [locator],
      identity: { generation: "parsed-chapter", blockIds: [locator.sourceId], locators: { [locator.sourceId]: locator } } };
    const record: AgentProposalRecord = { proposal, source: { kind: "run", runId: "original-run", task: sourceTask, text: "Clean", origin }, decisions: {}, replacedByProposalId: null };
    useAgentConsoleStore.setState({ proposalRecords: [record], currentProposalId: proposal.id });
    const snapshot = await toAgentSnapshot();
    const restored = await fromAgentSnapshot("/books/one", JSON.parse(JSON.stringify(snapshot)));
    expect(restored.proposalRecords[0].source).toEqual(record.source);
    expect(snapshot.v).toBe(4);
  });

  it("continues reading v4 run sources that predate origin receipts", async () => {
    const record: AgentProposalRecord = { proposal, source: { kind: "run", runId: "old-run", task: sourceTask, text: "Clean" }, decisions: {}, replacedByProposalId: null };
    useAgentConsoleStore.setState({ proposalRecords: [record], currentProposalId: proposal.id });
    const restored = await fromAgentSnapshot("/books/one", JSON.parse(JSON.stringify(await toAgentSnapshot())));
    expect(restored.proposalRecords[0].source).toEqual(record.source);
    expect(restored.proposalRecords[0].source).not.toHaveProperty("origin");
  });

  it.each([
    { kind: "selected-block-edit", mode: "edit", chapterId: "chapter-1", operation: "invented", blocks: [] },
    { kind: "task", mode: "edit", task: { kind: "proposal-follow-up", proposalId: "itself" } },
    { kind: "bridge", mode: "edit", chapterId: "chapter-1", anchor: { sourceId: "missing-receipt" }, successor: null },
    { kind: "selected-block-edit", mode: "edit", chapterId: "chapter-1", operation: "clean", blocks: [], identity: { generation: "", blockIds: [], locators: {} } },
    { kind: "selected-block-edit", mode: "edit", chapterId: "chapter-1", operation: "clean", blocks: [], identity: { generation: "chapter", blockIds: [], locators: [], invented: true } },
  ])("rejects malformed $kind receipts at the persistence boundary", async (origin) => {
    const { projectRoot: _projectRoot, ...persistedProposal } = proposal;
    const snapshot = { ...emptyPersistedAgentState(), proposalRecords: [{ proposal: persistedProposal, source: { kind: "run", runId: "bad-run", task: sourceTask, text: "Clean", origin }, decisions: {}, replacedByProposalId: null }], currentProposalId: proposal.id };
    await expect(fromAgentSnapshot("/books/one", snapshot)).rejects.toMatchObject({ issue: { kind: "corrupt" } });
  });
});
