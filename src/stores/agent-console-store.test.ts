import { beforeEach, describe, expect, it } from "vitest";
import type {
  AgentErrorCode,
  AgentMessageState,
  AgentRun,
  AgentRunError,
  AgentUIMessage,
  DraftContextRef,
  DraftContextSource,
  InterruptedRun,
  PendingProposal,
  PersistedAgentState,
  PersistedUsage,
} from "@/lib/ai/agent-types";
import {
  agentConsoleOwnershipStatus,
  EMPTY_AGENT_STATE,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";

const run: AgentRun = {
  id: "run-1",
  projectRoot: "/book",
  mode: "writing",
  task: { kind: "conversation", targetChapterId: "ch1" },
  userMessageId: "user-1",
  attachments: [],
  startedAt: "2026-07-30T12:00:00.000Z",
};

const message = (id: string): AgentUIMessage => ({
  id,
  role: "user",
  metadata: {
    runId: "run-1",
    mode: "writing",
    task: run.task,
    state: "complete",
    createdAt: "2026-07-30T12:00:00.000Z",
    error: null,
    errorCode: null,
    retryOf: null,
    usage: null,
  },
  parts: [{ type: "text", text: "Continue." }],
});

const proposal: PendingProposal = {
  id: "proposal-1",
  kind: "manuscript",
  projectRoot: "/book",
  chapterId: "ch1",
  summary: "Bridge the scene",
  createdAt: "2026-07-30T12:00:00.000Z",
  originatingMessageId: "assistant-1",
  changes: [],
};

const blockRef = (blockId: string): DraftContextRef => ({
  kind: "block",
  chapterId: "ch1",
  blockId,
});

const source = (
  ref: DraftContextRef,
  sourceId: string,
  order: number,
  sourceFingerprint: string,
): DraftContextSource => ({
  ref,
  available: true,
  label: `Block ${sourceId}`,
  preview: `Preview ${sourceId}`,
  resolved: {
    kind: ref.kind,
    chapterId: ref.chapterId,
    sourceId,
    order,
    sourceType: ref.kind,
    label: `Block ${sourceId}`,
    exactText: `Text ${sourceId}`,
    sourceFingerprint,
  },
});

const assistantMessage = (
  id: string,
  state: AgentMessageState,
  errorCode: AgentErrorCode | null,
): AgentUIMessage => ({
  ...message(id),
  role: "assistant",
  metadata: {
    ...message(id).metadata,
    state,
    error: state === "error" ? "Request failed" : null,
    errorCode,
  },
  parts: [{ type: "text", text: "Response" }],
});

const usage: PersistedUsage = {
  modelId: "gpt-5",
  inputTokens: 8,
  outputTokens: 4,
  totalTokens: 12,
  contextWindow: 400000,
  raw: {} as PersistedUsage["raw"],
};

const interrupted: InterruptedRun = {
  runId: "run-1",
  userMessageId: "user-1",
  assistantMessageId: "assistant-1",
  reason: "stopped",
  interruptedAt: "2026-07-30T12:01:00.000Z",
};

const emptyPersistedState = (): PersistedAgentState => ({
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
});

const proposalWithChanges: PendingProposal = {
  ...proposal,
  changes: [
    {
      id: "change-1",
      change: {
        kind: "remove",
        blockId: "b1",
        afterId: null,
        type: null,
        speaker: null,
        newText: null,
        toIndex: null,
        reason: "Remove repetition",
      },
      precondition: {
        kind: "target",
        target: {
          sourceId: "b1",
          order: 0,
          fingerprint: "fp-1",
          sourceType: "narration",
          label: "Narration block",
          exactText: "First",
          previewText: "First",
        },
      },
    },
    {
      id: "change-2",
      change: {
        kind: "remove",
        blockId: "b2",
        afterId: null,
        type: null,
        speaker: null,
        newText: null,
        toIndex: null,
        reason: "Remove duplicate",
      },
      precondition: {
        kind: "target",
        target: {
          sourceId: "b2",
          order: 1,
          fingerprint: "fp-2",
          sourceType: "narration",
          label: "Narration block",
          exactText: "Second",
          previewText: "Second",
        },
      },
    },
  ],
};

describe("agent console store", () => {
  beforeEach(() => {
    useAgentConsoleStore.setState(EMPTY_AGENT_STATE);
    useAgentConsoleStore.getState().hydrate("/book", emptyPersistedState());
  });

  it("freezes the active run while later mode changes prepare the next turn", () => {
    const store = useAgentConsoleStore.getState();
    store.beginRun(run, message("user-1"));
    store.setMode("edit");

    expect(useAgentConsoleStore.getState().mode).toBe("edit");
    expect(useAgentConsoleStore.getState().activeRun?.mode).toBe("writing");
  });

  it("clears only the submitted draft and permits drafting during a run", () => {
    const store = useAgentConsoleStore.getState();
    store.setDraftText("First request");
    store.addDraftContextRefs([
      { kind: "block", chapterId: "ch1", blockId: "b1" },
    ]);
    const submittedDraft = store.captureDraft();
    store.beginDraftRun(run, message("user-1"), submittedDraft);
    useAgentConsoleStore.getState().setDraftText("Next request");
    useAgentConsoleStore.getState().addDraftContextRefs([
      { kind: "block", chapterId: "ch1", blockId: "b2" },
    ]);

    expect(useAgentConsoleStore.getState().draftText).toBe("Next request");
    expect(useAgentConsoleStore.getState().draftContextRefs).toEqual([
      { kind: "block", chapterId: "ch1", blockId: "b2" },
    ]);
  });

  it("deduplicates live context and replaces the whole proposal", () => {
    const ref = { kind: "block" as const, chapterId: "ch1", blockId: "b1" };
    const store = useAgentConsoleStore.getState();
    store.addDraftContextRefs([ref, ref]);
    store.replacePendingProposal(proposal);
    store.replacePendingProposal({ ...proposal, id: "proposal-2" });

    expect(useAgentConsoleStore.getState().draftContextRefs).toEqual([ref]);
    expect(useAgentConsoleStore.getState().pendingProposal?.id).toBe(
      "proposal-2",
    );
  });

  it("preserves an unsent composer draft for an immediate external run", () => {
    const store = useAgentConsoleStore.getState();
    store.setDraftText("Question I am still composing");
    store.beginRun(run, message("user-1"));
    expect(useAgentConsoleStore.getState().draftText).toBe(
      "Question I am still composing",
    );
  });

  it("rejects a second concurrent run", () => {
    const store = useAgentConsoleStore.getState();
    store.beginRun(run, message("user-1"));
    expect(() =>
      useAgentConsoleStore.getState().beginRun(
        { ...run, id: "run-2" },
        message("user-2"),
      ),
    ).toThrow("An agent run is already active");
  });

  it("resets all project-scoped state when the project changes", () => {
    const store = useAgentConsoleStore.getState();
    store.setDraftText("Unsaved prompt");
    store.replacePendingProposal(proposal);
    store.resetProject();
    expect(useAgentConsoleStore.getState()).toMatchObject({
      mode: "writing",
      messages: [],
      summary: null,
      draftText: "",
      draftContextRefs: [],
      draftContextSources: {},
      draftSourceLocators: {},
      pendingProposal: null,
      lastUsage: null,
      interruptedRun: null,
      activeRun: null,
      runStatus: "idle",
      runError: null,
      persistenceIssue: null,
      hydratedProjectRoot: null,
      persistenceTransition: null,
    });
    expect(useAgentConsoleStore.getState().draftRevision).toBeGreaterThan(0);
  });

  it("reports stale transition completion without mutating current bookkeeping", () => {
    const store = useAgentConsoleStore.getState();
    store.hydrate("/book", {
      v: 3,
      mode: "writing",
      messages: [],
      summary: null,
      draftText: "Current draft",
      draftContextRefs: [],
      draftSourceLocators: {},
      pendingProposal: null,
      lastUsage: null,
      interruptedRun: null,
    });
    const stale = store.beginPersistenceTransition("/book", "load");
    const current = store.beginPersistenceTransition("/book", "reset");
    useAgentConsoleStore.setState({
      persistenceIssue: {
        kind: "save",
        projectRoot: "/book",
        message: "Keep the current issue",
      },
    });
    const before = useAgentConsoleStore.getState();

    const staleResult = store.completePersistenceTransition(stale, {
      v: 3,
      mode: "edit",
      messages: [message("stale-message")],
      summary: null,
      draftText: "Stale draft",
      draftContextRefs: [],
      draftSourceLocators: {},
      pendingProposal: null,
      lastUsage: null,
      interruptedRun: null,
    });

    expect(staleResult).toEqual({ status: "stale" });
    expect(useAgentConsoleStore.getState()).toMatchObject({
      hydratedProjectRoot: before.hydratedProjectRoot,
      draftRevision: before.draftRevision,
      draftText: before.draftText,
      messages: before.messages,
      persistenceIssue: before.persistenceIssue,
      persistenceTransition: before.persistenceTransition,
    });

    const currentResult = store.completePersistenceTransition(current, {
      v: 3,
      mode: "writing",
      messages: [],
      summary: null,
      draftText: "Current draft",
      draftContextRefs: [],
      draftSourceLocators: {},
      pendingProposal: null,
      lastUsage: null,
      interruptedRun: null,
    });
    expect(currentResult).toEqual({
      status: "current",
    });
  });

  it("requires exact requested, active, and hydrated ownership", () => {
    expect(
      agentConsoleOwnershipStatus(
        useAgentConsoleStore.getState(),
        "/book",
      ),
    ).toBe("ready");
    expect(
      agentConsoleOwnershipStatus(
        useAgentConsoleStore.getState(),
        "/books/other",
      ),
    ).toBe("unavailable");

    const store = useAgentConsoleStore.getState();
    const transition = store.beginPersistenceTransition("/book", "load");
    expect(
      agentConsoleOwnershipStatus(
        useAgentConsoleStore.getState(),
        "/book",
      ),
    ).toBe("transition");

    store.finishPersistenceTransition(transition);
    expect(
      agentConsoleOwnershipStatus(
        useAgentConsoleStore.getState(),
        "/book",
      ),
    ).toBe("unavailable");
  });

  it.each([
    {
      name: "a same-root load is active",
      arrange: () => {
        useAgentConsoleStore
          .getState()
          .beginPersistenceTransition("/book", "load");
      },
    },
    {
      name: "a failed load leaves hydration ownership mismatched",
      arrange: () => {
        const store = useAgentConsoleStore.getState();
        const transition = store.beginPersistenceTransition(
          "/books/new",
          "load",
        );
        store.activatePersistenceTransition(transition);
        store.finishPersistenceTransition(transition);
      },
    },
  ])("rejects every author mutation when $name", ({ arrange }) => {
    const store = useAgentConsoleStore.getState();
    store.setDraftText("Owned draft");
    store.addDraftContextRefs([blockRef("old")]);
    store.replacePendingProposal(proposalWithChanges);
    const submittedDraft = store.captureDraft();
    const attachment = submittedDraft.attachments[0];
    arrange();
    const mutationError = {
      name: "AgentConsoleOwnershipError",
      agentErrorCode: "transition",
    };
    const authorMutations = [
      () => store.setMode("edit"),
      () => store.setDraftText("Rejected draft"),
      () => store.setDraftContextRefs([blockRef("replacement")]),
      () => store.addDraftContextRefs([blockRef("new")]),
      () => store.removeDraftContextRef(blockRef("old")),
      () =>
        store.setDraftContextSources([
          source(blockRef("old"), "old", 0, "fp-old"),
        ]),
      () =>
        store.applyDraftContextResolution(
          [attachment],
          [
            {
              attachment,
              ref: blockRef("old"),
              source: source(blockRef("old"), "old", 0, "fp-old"),
            },
          ],
        ),
      () => store.removePendingChanges(["change-1"]),
      () => store.clearPendingProposal(),
      () => store.appendLocalMessage(message("local-message")),
      () => store.beginPreflight(),
      () => store.beginRun(run, message("user-1")),
      () => store.beginDraftRun(run, message("user-1"), submittedDraft),
    ];

    for (const mutate of authorMutations) {
      expect(mutate).toThrowError(expect.objectContaining(mutationError));
    }

    expect(useAgentConsoleStore.getState()).toMatchObject({
      mode: "writing",
      draftText: "Owned draft",
      draftContextRefs: [blockRef("old")],
      pendingProposal: proposalWithChanges,
      messages: [],
      runStatus: "idle",
    });
  });

  it("hydrates persisted fields while clearing transient and active run state", () => {
    const persisted: PersistedAgentState = {
      v: 3,
      mode: "edit",
      messages: [message("persisted-user")],
      summary: { text: "Earlier context", throughMessageId: "persisted-user" },
      draftText: "Persisted draft",
      draftContextRefs: [blockRef("b1")],
      draftSourceLocators: {
        "block:ch1:b1": { order: 0, sourceFingerprint: "fp-1" },
      },
      pendingProposal: proposal,
      lastUsage: usage,
      interruptedRun: interrupted,
    };
    useAgentConsoleStore.setState({
      draftContextSources: {
        "block:ch1:stale": source(blockRef("stale"), "stale", 3, "stale"),
      },
      activeRun: run,
      runStatus: "streaming",
      runError: { code: "transport", message: "Old error" },
      persistenceIssue: {
        kind: "save",
        projectRoot: "/old-book",
        message: "Old save error",
      },
    });

    useAgentConsoleStore.getState().hydrate("/book", persisted);

    expect(useAgentConsoleStore.getState()).toMatchObject({
      mode: persisted.mode,
      messages: persisted.messages,
      summary: persisted.summary,
      draftText: persisted.draftText,
      draftContextRefs: persisted.draftContextRefs,
      draftSourceLocators: persisted.draftSourceLocators,
      pendingProposal: persisted.pendingProposal,
      lastUsage: persisted.lastUsage,
      interruptedRun: persisted.interruptedRun,
      draftContextSources: {},
      activeRun: null,
      runStatus: "idle",
      runError: null,
      persistenceIssue: null,
      hydratedProjectRoot: "/book",
    });
    expect("v" in useAgentConsoleStore.getState()).toBe(false);
  });

  it("caches resolved sources by ref key and refreshes locator hints", () => {
    const firstRef = blockRef("b1");
    const secondRef = blockRef("b2");
    const store = useAgentConsoleStore.getState();
    store.setDraftContextSources([
      source(firstRef, "b1", 0, "fp-1"),
      source(secondRef, "b2", 1, "fp-2"),
    ]);
    store.setDraftContextSources([source(firstRef, "b1", 2, "fp-1-new")]);

    expect(Object.keys(useAgentConsoleStore.getState().draftContextSources)).toEqual([
      "block:ch1:b1",
      "block:ch1:b2",
    ]);
    expect(useAgentConsoleStore.getState().draftSourceLocators).toEqual({
      "block:ch1:b1": { order: 2, sourceFingerprint: "fp-1-new" },
      "block:ch1:b2": { order: 1, sourceFingerprint: "fp-2" },
    });
  });

  it("keeps unavailable source records visible until their ref is removed", () => {
    const ref = blockRef("b1");
    const store = useAgentConsoleStore.getState();
    store.addDraftContextRefs([ref]);
    store.setDraftContextSources([source(ref, "b1", 0, "fp-1")]);
    store.setDraftContextSources([
      {
        ref,
        available: false,
        label: "Unavailable block",
        preview: "",
        resolved: null,
      },
    ]);

    expect(useAgentConsoleStore.getState().draftContextSources).toEqual({
      "block:ch1:b1": {
        ref,
        available: false,
        label: "Unavailable block",
        preview: "",
        resolved: null,
      },
    });
    expect(useAgentConsoleStore.getState().draftSourceLocators).toEqual({
      "block:ch1:b1": { order: 0, sourceFingerprint: "fp-1" },
    });

    store.removeDraftContextRef(ref);
    expect(useAgentConsoleStore.getState().draftContextRefs).toEqual([]);
    expect(useAgentConsoleStore.getState().draftContextSources).toEqual({});
    expect(useAgentConsoleStore.getState().draftSourceLocators).toEqual({});
  });

  it("locks preflight without changing the draft or transcript", () => {
    const store = useAgentConsoleStore.getState();
    store.setDraftText("Keep this request");
    store.addDraftContextRefs([blockRef("b1")]);

    store.beginPreflight();

    expect(useAgentConsoleStore.getState()).toMatchObject({
      runStatus: "submitted",
      runError: null,
      draftText: "Keep this request",
      draftContextRefs: [blockRef("b1")],
      messages: [],
    });
    expect(() => useAgentConsoleStore.getState().beginPreflight()).toThrow(
      "An agent run is already active",
    );
  });

  it("returns a failed preflight to idle with a typed inline error", () => {
    const error: AgentRunError = {
      code: "configuration",
      message: "Choose a model",
    };
    const store = useAgentConsoleStore.getState();
    store.beginPreflight();
    store.failPreflight(error);

    expect(useAgentConsoleStore.getState()).toMatchObject({
      activeRun: null,
      runStatus: "idle",
      runError: error,
    });
  });

  it("preserves draft edits and new refs made during asynchronous preflight", () => {
    const firstRef = blockRef("b1");
    const nextRef = blockRef("b2");
    const store = useAgentConsoleStore.getState();
    store.setDraftText("First request");
    store.addDraftContextRefs([firstRef]);
    store.setDraftContextSources([source(firstRef, "b1", 0, "fp-1")]);
    const submittedDraft = store.captureDraft();
    store.beginPreflight();
    store.setDraftText("Revised next request");
    store.addDraftContextRefs([nextRef]);
    store.setDraftContextSources([source(nextRef, "b2", 1, "fp-2")]);

    store.beginDraftRun(run, message("user-1"), submittedDraft);

    expect(useAgentConsoleStore.getState()).toMatchObject({
      draftText: "Revised next request",
      draftContextRefs: [nextRef],
      draftContextSources: {
        "block:ch1:b2": source(nextRef, "b2", 1, "fp-2"),
      },
      draftSourceLocators: {
        "block:ch1:b2": { order: 1, sourceFingerprint: "fp-2" },
      },
      activeRun: run,
      runStatus: "submitted",
      messages: [message("user-1")],
    });
  });

  it("preserves text edited away and back after draft capture", () => {
    const store = useAgentConsoleStore.getState();
    store.setDraftText("First request");
    const submittedDraft = store.captureDraft();
    store.beginPreflight();

    store.setDraftText("Temporary request");
    store.setDraftText("First request");
    store.beginDraftRun(run, message("user-1"), submittedDraft);

    expect(useAgentConsoleStore.getState().draftText).toBe("First request");
  });

  it("preserves a removed and re-added attachment after draft capture", () => {
    const submittedRef = blockRef("b1");
    const store = useAgentConsoleStore.getState();
    store.addDraftContextRefs([submittedRef]);
    const submittedDraft = store.captureDraft();
    store.beginPreflight();

    store.removeDraftContextRef(submittedRef);
    store.addDraftContextRefs([submittedRef]);
    store.beginDraftRun(run, message("user-1"), submittedDraft);

    expect(useAgentConsoleStore.getState().draftContextRefs).toEqual([
      submittedRef,
    ]);
  });

  it("upserts one streaming assistant message by stable id", () => {
    const store = useAgentConsoleStore.getState();
    store.beginRun(run, message("user-1"));
    store.markStreaming();
    store.upsertAssistantMessage(
      assistantMessage("assistant-1", "streaming", null),
    );
    const replacement = {
      ...assistantMessage("assistant-1", "streaming", null),
      parts: [{ type: "text" as const, text: "Longer response" }],
    };
    store.upsertAssistantMessage(replacement);

    expect(useAgentConsoleStore.getState().runStatus).toBe("streaming");
    expect(useAgentConsoleStore.getState().messages).toEqual([
      message("user-1"),
      replacement,
    ]);
  });

  it("finishes a run with final usage and clears active run state", () => {
    const store = useAgentConsoleStore.getState();
    store.beginRun(run, message("user-1"));
    store.markStreaming();
    const finalMessage = assistantMessage("assistant-1", "complete", null);

    store.finishRun(finalMessage, usage);

    expect(useAgentConsoleStore.getState()).toMatchObject({
      activeRun: null,
      runStatus: "idle",
      runError: null,
      lastUsage: usage,
    });
    expect(useAgentConsoleStore.getState().messages[1]).toEqual({
      ...finalMessage,
      metadata: { ...finalMessage.metadata, usage },
    });
  });

  it("rejects a final run message without required agent metadata", () => {
    const malformed = {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "Response" }],
    } as AgentUIMessage;
    const store = useAgentConsoleStore.getState();
    store.beginRun(run, message("user-1"));

    expect(() => store.finishRun(malformed, usage)).toThrow(
      "Agent message metadata is missing: assistant-1",
    );
  });

  it("records an interrupted run and clears active run state", () => {
    const store = useAgentConsoleStore.getState();
    store.beginRun(run, message("user-1"));
    store.interruptRun(interrupted);

    expect(useAgentConsoleStore.getState()).toMatchObject({
      activeRun: null,
      runStatus: "idle",
      runError: null,
      interruptedRun: interrupted,
    });
  });

  it("stores a failed assistant turn and a typed inline run error", () => {
    const store = useAgentConsoleStore.getState();
    store.beginRun(run, message("user-1"));
    const failed = assistantMessage("assistant-1", "streaming", "transport");
    store.failRun(failed, "Network unavailable");

    expect(useAgentConsoleStore.getState()).toMatchObject({
      activeRun: null,
      runStatus: "idle",
      runError: { code: "transport", message: "Network unavailable" },
    });
    expect(useAgentConsoleStore.getState().messages[1]).toEqual({
      ...failed,
      metadata: {
        ...failed.metadata,
        state: "error",
        error: "Network unavailable",
      },
    });
  });

  it("removes selected pending changes and clears an empty proposal", () => {
    const store = useAgentConsoleStore.getState();
    store.replacePendingProposal(proposalWithChanges);
    store.removePendingChanges(["change-1"]);
    expect(
      useAgentConsoleStore.getState().pendingProposal?.changes.map(
        (change) => change.id,
      ),
    ).toEqual(["change-2"]);

    store.removePendingChanges(["change-2"]);
    expect(useAgentConsoleStore.getState().pendingProposal).toBeNull();
  });

  it("appends local data messages and updates summary and persistence issues", () => {
    const localMessage = assistantMessage("local-1", "complete", null);
    const summary = { text: "Earlier turns", throughMessageId: "local-1" };
    const issue = {
      kind: "save" as const,
      projectRoot: "/book",
      message: "Write failed",
    };
    const store = useAgentConsoleStore.getState();
    store.appendLocalMessage(localMessage);
    store.setSummary(summary);
    store.setPersistenceIssue(issue);

    expect(useAgentConsoleStore.getState()).toMatchObject({
      messages: [localMessage],
      summary,
      persistenceIssue: issue,
    });
    store.clearPendingProposal();
    store.setPersistenceIssue(null);
    expect(useAgentConsoleStore.getState().persistenceIssue).toBeNull();
  });
});
