// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const controller = vi.hoisted(() => ({
  submitAgentDraft: vi.fn(),
  stopAgentRun: vi.fn(),
}));

vi.mock("@/lib/ai/agent-controller", () => ({
  submitAgentDraft: controller.submitAgentDraft,
  stopAgentRun: controller.stopAgentRun,
}));

import { AgentComposer } from "@/components/app/agent-console/agent-composer";
import { draftContextRefKey } from "@/lib/ai/agent-context";
import type {
  AgentMessageMetadata,
  AgentRun,
  AgentTask,
  AgentUIMessage,
  DraftContextRef,
  DraftContextSource,
  PendingProposal,
  PersistedUsage,
} from "@/lib/ai/agent-types";
import type { ProjectInfo } from "@/lib/types";
import {
  EMPTY_AGENT_STATE,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import {
  SETTINGS_TABS,
  useSettingsDialogStore,
} from "@/stores/settings-dialog-store";

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

const project: ProjectInfo = {
  root: "/books/quiet-novel",
  name: "Quiet Novel",
  mainFile: "main.tex",
  title: "Quiet Novel",
  author: "Author",
  metadata: {
    title: "Quiet Novel",
    subtitle: "",
    author: "Author",
    publisher: "",
    isbn: "",
  },
  chapters: [
    {
      id: "chapter-1",
      label: "1",
      title: "The Crossing",
      file: "crossing.tex",
      wordCount: 1200,
    },
  ],
};

const firstRef: DraftContextRef = {
  kind: "block",
  chapterId: "chapter-1",
  blockId: "block-1",
};

const secondRef: DraftContextRef = {
  kind: "outline-card",
  chapterId: "chapter-1",
  cardId: "card-1",
};

function source(
  ref: DraftContextRef,
  label: string,
  exactText: string,
  order: number,
): DraftContextSource {
  const sourceId =
    ref.kind === "block"
      ? ref.blockId
      : ref.kind === "outline-card"
        ? ref.cardId
        : ref.findingId;
  return {
    ref,
    available: true,
    label,
    preview: exactText,
    resolved: {
      kind: ref.kind,
      chapterId: ref.chapterId,
      sourceId,
      order,
      sourceType: ref.kind,
      label,
      exactText,
      sourceFingerprint: `fingerprint-${order}`,
    },
  };
}

const sources: Record<string, DraftContextSource> = {
  [draftContextRefKey(firstRef)]: source(
    firstRef,
    "Opening paragraph",
    "Rain crossed the window.",
    0,
  ),
  [draftContextRefKey(secondRef)]: source(
    secondRef,
    "The letter arrives",
    "Force Mara to choose.",
    1,
  ),
};

const pendingProposal: PendingProposal = {
  id: "proposal-1",
  kind: "manuscript",
  projectRoot: project.root,
  chapterId: "chapter-1",
  summary: "Tighten the crossing",
  createdAt: "2026-07-30T12:00:00.000Z",
  originatingMessageId: "assistant-1",
  changes: [],
};

const usage: PersistedUsage = {
  modelId: "gpt-4o",
  inputTokens: 20,
  outputTokens: 10,
  totalTokens: 30,
  contextWindow: 100,
  raw: {
    inputTokens: 20,
    inputTokenDetails: {
      noCacheTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    outputTokens: 10,
    outputTokenDetails: { textTokens: 10, reasoningTokens: 0 },
    totalTokens: 30,
  },
};

function activeRun(mode: AgentRun["mode"]): AgentRun {
  return {
    id: "run-1",
    projectRoot: project.root,
    mode,
    task: { kind: "conversation", targetChapterId: "chapter-1" },
    userMessageId: "user-1",
    attachments: [],
    startedAt: "2026-07-30T12:00:00.000Z",
  };
}

function userMessage(run: AgentRun, text: string): AgentUIMessage {
  const metadata: AgentMessageMetadata = {
    runId: run.id,
    mode: run.mode,
    task: run.task,
    state: "complete",
    createdAt: run.startedAt,
    error: null,
    errorCode: null,
    retryOf: null,
    usage: null,
  };
  return {
    id: run.userMessageId,
    role: "user",
    metadata,
    parts: [{ type: "text", text }],
  };
}

function resetConsoleState(): void {
  useAgentConsoleStore.setState({
    ...EMPTY_AGENT_STATE,
    messages: [],
    draftContextRefs: [],
    draftContextSources: {},
    draftSourceLocators: {},
    requestedProjectRoot: project.root,
    activeProjectRoot: project.root,
    hydratedProjectRoot: project.root,
  });
}

beforeEach(() => {
  resetConsoleState();
  useProjectStore.setState({
    project,
    activeChapterId: "chapter-1",
  });
  useSettingsDialogStore.setState({
    open: false,
    tab: SETTINGS_TABS.APPEARANCE,
  });
  controller.submitAgentDraft.mockReset();
  controller.submitAgentDraft.mockResolvedValue(undefined);
  controller.stopAgentRun.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("AgentComposer mode controls", () => {
  it("uses stock grouped Buttons and mode descendant selectors", () => {
    render(<AgentComposer />);

    const group = screen.getByRole("group", { name: "Agent mode" });
    const writing = within(group).getByRole("button", { name: "Writing" });
    const edit = within(group).getByRole("button", { name: "Edit" });
    const textarea = screen.getByRole("textbox");
    const form = textarea.closest("form");
    const inputGroup = textarea.closest("[data-slot=input-group]");
    if (form === null || inputGroup === null) {
      throw new Error("Stock PromptInput structure is missing");
    }

    expect(group.dataset.slot).toBe("button-group");
    expect(writing.dataset.slot).toBe("button");
    expect(edit.dataset.slot).toBe("button");
    expect(writing.dataset.variant).toBe("default");
    expect(edit.dataset.variant).toBe("outline");
    expect(writing.getAttribute("aria-pressed")).toBe("true");
    expect(edit.getAttribute("aria-pressed")).toBe("false");
    expect(inputGroup.closest("form")).toBe(form);
    expect(form.className).toContain(
      "[&_[data-slot=input-group]]:border-ai-edge",
    );
    expect(form.className).toContain(
      "[&_[data-slot=input-group]]:bg-ai-tint/40",
    );

    fireEvent.click(edit);

    expect(writing.dataset.variant).toBe("outline");
    expect(edit.dataset.variant).toBe("default");
    expect(form.className).toContain(
      "[&_[data-slot=input-group]]:border-accent-ink/40",
    );
    expect(form.className).toContain(
      "[&_[data-slot=input-group]]:bg-accent/40",
    );
  });

  it("changes only the next-turn mode while a run keeps its frozen mode", () => {
    const run = activeRun("writing");
    useAgentConsoleStore.setState({
      mode: "writing",
      activeRun: run,
      runStatus: "streaming",
    });
    render(<AgentComposer />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(useAgentConsoleStore.getState().mode).toBe("edit");
    expect(useAgentConsoleStore.getState().activeRun).toEqual(run);
    expect(useAgentConsoleStore.getState().activeRun?.mode).toBe("writing");
  });
});

describe("AgentComposer draft behavior", () => {
  it("exposes the empty composer as the named AI Console textbox", () => {
    const { container } = render(<AgentComposer />);

    expect(
      screen.getByRole("textbox", { name: "Message AI Console" }),
    ).toBeTruthy();
    expect(
      container.querySelectorAll("[data-slot=input-group-addon]"),
    ).toHaveLength(1);
  });

  it("keeps the AI Console textbox name when it contains text", () => {
    useAgentConsoleStore.getState().setDraftText("Ask about the crossing");
    render(<AgentComposer />);

    const textbox = screen.getByRole("textbox", {
      name: "Message AI Console",
    }) as HTMLTextAreaElement;
    expect(textbox.value).toBe("Ask about the crossing");
  });

  it("keeps textarea text controlled by the console store", () => {
    useAgentConsoleStore.getState().setDraftText("Ask about the crossing");
    render(<AgentComposer />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

    expect(textarea.value).toBe("Ask about the crossing");
    fireEvent.change(textarea, { target: { value: "Ask about the ending" } });
    expect(useAgentConsoleStore.getState().draftText).toBe(
      "Ask about the ending",
    );

    act(() => {
      useAgentConsoleStore.getState().setDraftText("A store-owned revision");
    });
    expect(textarea.value).toBe("A store-owned revision");
  });

  it("disables target-project editing and submit while cross-project hydration is active", () => {
    useAgentConsoleStore.setState({
      hydratedProjectRoot: null,
      draftText: "",
      persistenceTransition: {
        generation: 4,
        kind: "load",
        projectRoot: project.root,
      },
    });
    render(<AgentComposer />);

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole("button", { name: "Writing" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText("AI conversation is loading.")).toBeTruthy();
  });

  it.each([
    {
      name: "a same-project persistence transition",
      state: {
        hydratedProjectRoot: project.root,
        persistenceTransition: {
          generation: 5,
          kind: "load" as const,
          projectRoot: project.root,
        },
      },
    },
    {
      name: "a completed failed load with mismatched hydration",
      state: {
        hydratedProjectRoot: null,
        persistenceTransition: null,
      },
    },
  ])("locks every idle composer mutation during $name", ({ state }) => {
    useAgentConsoleStore.setState({
      ...state,
      draftText: "Owned draft",
      draftContextRefs: [firstRef],
      draftContextSources: sources,
    });
    render(<AgentComposer />);

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole("button", { name: "Writing" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "Remove Opening paragraph",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText("AI conversation is loading.")).toBeTruthy();
  });

  it("removes one of multiple live attachments without submitting", () => {
    useAgentConsoleStore.setState({
      draftText: "Compare these",
      draftContextRefs: [firstRef, secondRef],
      draftContextSources: sources,
    });
    render(<AgentComposer />);

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Opening paragraph" }),
    );

    expect(screen.queryByText("Opening paragraph")).toBeNull();
    expect(screen.getByText("The letter arrives")).toBeTruthy();
    expect(useAgentConsoleStore.getState().draftContextRefs).toEqual([
      secondRef,
    ]);
    expect(controller.submitAgentDraft).not.toHaveBeenCalled();
  });

  it("clears the submitted draft but preserves text typed for the next turn", async () => {
    const completion = deferred<void>();
    useAgentConsoleStore.getState().setDraftText("Sent turn");
    controller.submitAgentDraft.mockImplementation(async () => {
      const state = useAgentConsoleStore.getState();
      const submittedText = state.draftText;
      const run = activeRun(state.mode);
      const submittedDraft = state.captureDraft();
      state.beginDraftRun(
        run,
        userMessage(run, submittedText),
        submittedDraft,
      );
      await completion.promise;
    });
    render(<AgentComposer />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(useAgentConsoleStore.getState().draftText).toBe(""),
    );
    expect(useAgentConsoleStore.getState().messages[0].parts).toEqual([
      { type: "text", text: "Sent turn" },
    ]);

    fireEvent.change(textarea, { target: { value: "Next turn" } });
    act(() => completion.resolve());
    await completion.promise;

    expect(useAgentConsoleStore.getState().draftText).toBe("Next turn");
    expect(textarea.value).toBe("Next turn");
  });

  it("locks typing but keeps Stop enabled during an ownership transition", () => {
    useAgentConsoleStore.setState({
      draftText: "Next turn",
      activeRun: activeRun("writing"),
      runStatus: "streaming",
      persistenceTransition: {
        generation: 7,
        kind: "load",
        projectRoot: project.root,
      },
    });
    render(<AgentComposer />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

    expect(textarea.disabled).toBe(true);
    expect(useAgentConsoleStore.getState().draftText).toBe("Next turn");
    expect(controller.submitAgentDraft).not.toHaveBeenCalled();
    const stop = screen.getByRole("button", { name: "Stop" });
    expect((stop as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    fireEvent.click(stop);
    expect(controller.stopAgentRun).toHaveBeenCalledOnce();
  });

  it("blocks blank submissions and accepts an attachment-only draft", async () => {
    render(<AgentComposer />);
    const textarea = screen.getByRole("textbox");
    const form = textarea.closest("form");
    if (form === null) throw new Error("PromptInput form is missing");
    const submit = screen.getByRole("button", {
      name: "Submit",
    }) as HTMLButtonElement;

    expect(submit.disabled).toBe(true);
    fireEvent.submit(form);
    fireEvent.change(textarea, { target: { value: "   \n\t" } });
    expect(submit.disabled).toBe(true);
    fireEvent.submit(form);
    expect(controller.submitAgentDraft).not.toHaveBeenCalled();

    act(() => {
      useAgentConsoleStore.getState().addDraftContextRefs([firstRef]);
    });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() =>
      expect(controller.submitAgentDraft).toHaveBeenCalledOnce(),
    );
  });

  it("renders safe preflight copy inline and leaves the draft unchanged", async () => {
    useAgentConsoleStore.getState().setDraftText("Keep this draft");
    controller.submitAgentDraft.mockImplementation(async () => {
      const state = useAgentConsoleStore.getState();
      state.beginPreflight();
      state.failPreflight({
        code: "compaction",
        message:
          "Compaction failed at /Users/author/private/book with internal detail.",
      });
    });
    render(<AgentComposer />);

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    const error = await screen.findByRole("alert");
    const form = screen.getByRole("textbox").closest("form");
    if (form === null) throw new Error("PromptInput form is missing");
    expect(error.textContent).toBe(
      "Older conversation context could not be prepared. Retry the request.",
    );
    expect(document.body.textContent).not.toContain("/Users/author");
    expect(document.body.textContent).not.toContain("internal detail");
    const promptFileInput = error.parentElement?.nextElementSibling;
    expect(promptFileInput?.getAttribute("aria-label")).toBe("Upload files");
    expect(promptFileInput?.nextElementSibling?.tagName).toBe("FORM");
    expect(promptFileInput?.nextElementSibling?.className).toBe(form.className);
    expect(useAgentConsoleStore.getState().draftText).toBe("Keep this draft");
  });

  it("hides provider response details and absolute paths from transport errors", () => {
    const rawError =
      "AI_APICallError responseBody {\"error\":\"private provider detail\"} at /Users/author/.config/key from C:\\Users\\author\\.config\\key raw errorText";
    useAgentConsoleStore.setState({
      draftText: "Keep this transport draft",
      runError: {
        code: "transport",
        message: rawError,
      },
    });
    render(<AgentComposer />);

    expect(screen.getByRole("alert").textContent).toBe(
      "The AI request could not be completed. Check your connection and retry.",
    );
    expect(document.body.textContent).not.toContain(rawError);
    expect(document.body.textContent).not.toContain("/Users/author");
    expect(document.body.textContent).not.toContain("C:\\Users\\author");
    expect(document.body.textContent).not.toContain("responseBody");
    expect(document.body.textContent).not.toContain("raw errorText");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Keep this transport draft",
    );
  });

  it("opens AI Settings from a preflight configuration error", async () => {
    useAgentConsoleStore.setState({
      draftText: "Retry this request",
      runError: {
        code: "configuration",
        message:
          "Missing key at /private/book/.env with raw provider response.",
      },
    });
    render(<AgentComposer />);

    expect(screen.getByRole("alert").textContent).toBe(
      "AI is not configured. Open AI Settings to continue.",
    );
    expect(document.body.textContent).not.toContain("/private/book");
    expect(document.body.textContent).not.toContain("raw provider response");

    fireEvent.click(
      screen.getByRole("button", { name: "Open AI Settings" }),
    );

    expect(useSettingsDialogStore.getState()).toMatchObject({
      open: true,
      tab: SETTINGS_TABS.AI,
    });

    const submit = screen.getByRole("button", { name: "Submit" });
    expect(
      submit.querySelector(".lucide-corner-down-left"),
    ).toBeTruthy();
    fireEvent.click(submit);
    await waitFor(() =>
      expect(controller.submitAgentDraft).toHaveBeenCalledOnce(),
    );
  });
});

describe("AgentComposer submission task", () => {
  it("targets the active chapter for a conversation turn", async () => {
    useAgentConsoleStore.getState().setDraftText("What should happen next?");
    render(<AgentComposer />);

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(controller.submitAgentDraft).toHaveBeenCalledWith({
        kind: "conversation",
        targetChapterId: "chapter-1",
      } satisfies AgentTask),
    );
  });

  it("uses the pending proposal workspace for a follow-up turn", async () => {
    useAgentConsoleStore.setState({
      draftText: "Keep the first line but shorten the rest.",
      pendingProposal,
    });
    render(<AgentComposer />);

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(controller.submitAgentDraft).toHaveBeenCalledWith({
        kind: "proposal-follow-up",
        proposalId: "proposal-1",
      } satisfies AgentTask),
    );
  });
});

describe("AgentComposer context usage", () => {
  it("renders latest usage, context window, and a once-prefixed OpenAI model ID", async () => {
    useAgentConsoleStore.setState({ lastUsage: usage });
    const rendered = render(<AgentComposer />);

    const trigger = screen.getByRole("button", { name: /30%/ });
    if (trigger === null) throw new Error("Context trigger is missing");
    fireEvent.pointerEnter(trigger);

    expect(await screen.findByText("30 / 100")).toBeTruthy();
    expect(screen.getByText("Model: openai:gpt-4o")).toBeTruthy();

    act(() => {
      useAgentConsoleStore.setState({
        lastUsage: { ...usage, modelId: "openai:gpt-4o" },
      });
    });
    rendered.rerender(<AgentComposer />);
    fireEvent.pointerEnter(screen.getByRole("button", { name: /30%/ }));

    expect(screen.getByText("Model: openai:gpt-4o")).toBeTruthy();
    expect(screen.queryByText("Model: openai:openai:gpt-4o")).toBeNull();
  });
});
