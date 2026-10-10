// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  copyText: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({ copyText: mocks.copyText }));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

import { AgentMessage } from "@/components/app/agent-console/agent-message";
import { sanitizeAgentMessages } from "@/lib/ai/agent-messages";
import type {
  AgentMessageMetadata,
  AgentUIMessage,
} from "@/lib/ai/agent-types";
import { EMPTY_META } from "@/lib/migration";
import {
  clearOutlineAgentSessions,
  EMPTY_AGENT_STATE,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";

function metadata(
  overrides: Partial<AgentMessageMetadata>,
): AgentMessageMetadata {
  return {
    runId: "run-1",
    mode: "writing",
    task: { kind: "conversation", targetChapterId: "ch1" },
    state: "complete",
    createdAt: "2026-07-30T00:00:00.000Z",
    error: null,
    errorCode: null,
    retryOf: null,
    usage: null,
    ...overrides,
  };
}

function assistantMessage(
  id: string,
  parts: AgentUIMessage["parts"],
  messageMetadata: AgentMessageMetadata,
): AgentUIMessage {
  return {
    id,
    role: "assistant",
    metadata: messageMetadata,
    parts,
  };
}

function renderAgentMessage(message: AgentUIMessage) {
  const onRetry = vi.fn().mockResolvedValue({ status: "success" });
  const onOpenSettings = vi.fn();
  render(
    <AgentMessage
      message={message}
      onRetry={onRetry}
      onOpenSettings={onOpenSettings}
    />,
  );
  return { onRetry, onOpenSettings };
}

const messageProject = {
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
  chapters: [],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

beforeEach(() => {
  clearOutlineAgentSessions();
  mocks.copyText.mockReset();
  mocks.copyText.mockResolvedValue(true);
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
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
  useProjectStore.setState({ project: messageProject, meta: EMPTY_META });
});

describe("AgentMessage content", () => {
  it("renders a tool-only author question and its choices without an assistant text response", () => {
    const input = {
      question: "Should Dad's memory remain unreliable?",
      rationale: "This determines whether to clarify the contradiction.",
      options: ["Preserve uncertainty", "Clarify the memory"],
    };
    renderAgentMessage(assistantMessage("assistant-question", [{
      type: "tool-ask_author", toolCallId: "question-1", state: "output-available", input,
      output: { kind: "runtime", summary: { label: "Question for author", target: input.question, detail: input.rationale, itemCount: 1 }, value: input },
    }], metadata({})));
    expect(screen.getByText(input.question)).toBeTruthy();
    expect(screen.getByText(input.rationale)).toBeTruthy();
    for (const option of input.options) expect(screen.getByText(option)).toBeTruthy();
    expect(screen.getByText(input.question).closest('[data-slot="card"]')).toBeTruthy();
    expect(screen.queryByRole("button", { name: input.options[0] })).toBeNull();
  });

  it("renders a reopened summary-only author question from its preserved input", () => {
    const input = { question: "What changes for the narrator in this scene?", rationale: "A turn will determine which card belongs here.", options: [] };
    const messages = sanitizeAgentMessages([assistantMessage("reopened-question", [{
      type: "tool-ask_author", toolCallId: "reopened-question-1", state: "output-available", input,
      output: { kind: "runtime", summary: { label: "Question for author", target: input.question, detail: input.rationale, itemCount: 1 }, value: input },
    }], metadata({}))]);
    renderAgentMessage(messages[0]);
    expect(screen.getByText(input.question)).toBeTruthy();
    expect(screen.getByText(input.rationale)).toBeTruthy();
  });

  it("shows dynamic completed questions and hides failed or unexecuted question attempts", () => {
    const input = { question: "What should the reader distrust?", rationale: "The choice determines which evidence to preserve.", options: [] };
    renderAgentMessage(assistantMessage("dynamic-question", [{
      type: "dynamic-tool", toolName: "ask_author", toolCallId: "dynamic-question-1", state: "output-available", input,
      output: { kind: "summary", summary: { label: "Question for author", target: input.question, detail: "1 question", itemCount: 1 } },
    }], metadata({})));
    expect(screen.getByText(input.question)).toBeTruthy();
    cleanup();
    renderAgentMessage(assistantMessage("failed-questions", [
      { type: "tool-ask_author", toolCallId: "unexecuted-question", state: "input-available", input },
      { type: "tool-ask_author", toolCallId: "failed-question", state: "output-error", input, errorText: "Tool execution failed" },
    ], metadata({})));
    expect(screen.queryByText(input.question)).toBeNull();
    expect(screen.queryByText(input.rationale)).toBeNull();
  });
  it("copies all text parts and confirms the copy", async () => {
    renderAgentMessage(
      assistantMessage(
        "assistant-copy",
        [
          { type: "text", text: "First paragraph." },
          { type: "text", text: "Second paragraph." },
        ],
        metadata({}),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() =>
      expect(mocks.copyText).toHaveBeenCalledWith(
        "First paragraph.\n\nSecond paragraph.",
      ),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Message copied");
  });

  it("aligns user message actions with the trailing edge of the message", () => {
    renderAgentMessage({
      id: "user-copy",
      role: "user",
      metadata: metadata({}),
      parts: [{ type: "text", text: "A user message." }],
    });

    const copyButton = screen.getByRole("button", { name: "Copy" });

    expect(copyButton.parentElement?.classList.contains("group-[.is-user]:self-end")).toBe(true);
  });

  it("renders message text as a markdown response", () => {
    renderAgentMessage(
      assistantMessage(
        "assistant-text",
        [{ type: "text", text: "A **quiet answer**." }],
        metadata({}),
      ),
    );

    expect(screen.getByText("quiet answer").tagName).toBe("STRONG");
  });

  it("does not render model usage for a message", () => {
    renderAgentMessage(
      assistantMessage(
        "assistant-usage",
        [{ type: "text", text: "Measured answer." }],
        metadata({
          usage: {
            modelId: "gpt-4.1",
            inputTokens: 1_000,
            outputTokens: 500,
            totalTokens: 1_500,
            contextWindow: 10_000,
            raw: {
              inputTokens: 1_000,
              inputTokenDetails: {
                noCacheTokens: 1_000,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
              },
              outputTokens: 500,
              outputTokenDetails: { textTokens: 500, reasoningTokens: 0 },
              totalTokens: 1_500,
            },
          },
        }),
      ),
    );

    expect(
      screen.queryByRole("button", { name: /Model context usage/ }),
    ).toBeNull();
  });

  it("renders only reply text and hides reasoning and tool activity", () => {
    renderAgentMessage(
      assistantMessage(
        "assistant-reply-only",
        [
          { type: "reasoning", text: "Private model reasoning", state: "done" },
          {
            type: "tool-read_chapter",
            toolCallId: "call-read",
            state: "output-available",
            input: { chapterId: "chapter-1" },
            output: {
              kind: "summary",
              summary: {
                label: "Read chapter",
                target: "Chapter One",
                detail: "2 blocks",
                itemCount: 2,
              },
            },
          },
          {
            type: "data-proposal-event",
            data: {
              proposalId: "proposal-1",
              action: "accepted",
              changeCount: 1,
              text: "Accepted one manuscript change.",
            },
          },
          { type: "text", text: "Visible answer" },
        ],
        metadata({}),
      ),
    );

    expect(screen.getByText("Visible answer")).toBeTruthy();
    expect(screen.queryByText("Private model reasoning")).toBeNull();
    expect(screen.queryByText("Read chapter")).toBeNull();
    expect(screen.queryByText("Accepted one manuscript change.")).toBeNull();
  });

  it("keeps the thinking indicator out of streaming replies", () => {
    renderAgentMessage(
      assistantMessage(
        "assistant-thinking",
        [{ type: "tool-read_chapter", toolCallId: "call-read", state: "input-available", input: { chapterId: "chapter-1" } }],
        metadata({ state: "streaming", createdAt: "2026-08-25T12:00:00.000Z" }),
      ),
    );

    expect(screen.queryByText(/Thinking/)).toBeNull();
  });

});

describe("AgentMessage errors", () => {
  it("renders safe run error copy and retries the original user message", async () => {
    const runMetadata = metadata({ runId: "failed-run" });
    const user: AgentUIMessage = {
      id: "original-user",
      role: "user",
      metadata: runMetadata,
      parts: [{ type: "text", text: "Continue the scene." }],
    };
    const failed = assistantMessage(
      "failed-assistant",
      [],
      metadata({
        runId: "failed-run",
        state: "error",
        failure: {
          reason: "transport",
          message: "The AI request could not be completed. Check your connection and retry.",
          action: "retry",
          settingsTarget: null,
        },
      }),
    );
    useAgentConsoleStore.setState({ messages: [user, failed] });
    const { onRetry } = renderAgentMessage(failed);

    expect(
      screen.getByText(
        "The AI request could not be completed. Check your connection and retry.",
      ),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("/Users/author");
    expect(document.body.textContent).not.toContain("C:\\Users\\author");
    const retry = screen.getByRole("button", {
      name: "Retry",
    }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    fireEvent.click(retry);

    await waitFor(() => expect(onRetry).toHaveBeenCalledWith("original-user"));
  });

  it.each([
    {
      name: "a same-project persistence transition",
      state: {
        hydratedProjectRoot: "/book",
        persistenceTransition: {
          generation: 12,
          kind: "load" as const,
          projectRoot: "/book",
        },
      },
    },
    {
      name: "a token-null hydration mismatch",
      state: {
        hydratedProjectRoot: null,
        persistenceTransition: null,
      },
    },
  ])("disables failed-turn Retry during $name", ({ state }) => {
    const runMetadata = metadata({ runId: "locked-run" });
    const user: AgentUIMessage = {
      id: "locked-user",
      role: "user",
      metadata: runMetadata,
      parts: [{ type: "text", text: "Continue the scene." }],
    };
    const failed = assistantMessage(
      "locked-assistant",
      [],
      metadata({
        runId: "locked-run",
        state: "error",
        failure: {
          reason: "transport",
          message: "The AI request could not be completed. Check your connection and retry.",
          action: "retry",
          settingsTarget: null,
        },
      }),
    );
    useAgentConsoleStore.setState({ messages: [user, failed], ...state });
    const { onRetry } = renderAgentMessage(failed);

    const retry = screen.getByRole("button", {
      name: "Retry",
    }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("renders safe feedback when Retry loses an ownership race", async () => {
    const runMetadata = metadata({ runId: "racing-run" });
    const user: AgentUIMessage = {
      id: "racing-user",
      role: "user",
      metadata: runMetadata,
      parts: [{ type: "text", text: "Continue the scene." }],
    };
    const failed = assistantMessage(
      "racing-assistant",
      [],
      metadata({
        runId: "racing-run",
        state: "error",
        failure: {
          reason: "transport",
          message: "The AI request could not be completed. Check your connection and retry.",
          action: "retry",
          settingsTarget: null,
        },
      }),
    );
    useAgentConsoleStore.setState({ messages: [user, failed] });
    const { onRetry } = renderAgentMessage(failed);
    onRetry.mockResolvedValueOnce({
      status: "failure",
      failure: {
        reason: "transition",
        message: "The AI conversation is loading for this project. Retry when loading finishes.",
        action: "retry",
        settingsTarget: null,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "The AI conversation is loading for this project. Retry when loading finishes.",
        ),
      ).toBeTruthy(),
    );
    expect(document.body.textContent).not.toContain(
      "AI conversation is not ready",
    );
  });

  it("offers AI Settings only for a typed configuration error", () => {
    const configuration = assistantMessage(
      "configuration-error",
      [],
      metadata({
        state: "error",
        failure: {
          reason: "key-missing",
          message: "Add an OpenAI key, then submit again.",
          action: "add-key",
          settingsTarget: "key",
        },
      }),
    );
    const { onOpenSettings } = renderAgentMessage(configuration);

    expect(
      screen.getByText("Add an OpenAI key, then submit again."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add key" }));
    expect(onOpenSettings).toHaveBeenCalledWith("key");

    cleanup();
    renderAgentMessage(
      assistantMessage(
        "transport-error",
        [],
        metadata({
          state: "error",
          failure: {
            reason: "transport",
            message: "The AI request could not be completed. Check your connection and retry.",
            action: "retry",
            settingsTarget: null,
          },
        }),
      ),
    );
    expect(screen.queryByRole("button", { name: "Add key" })).toBeNull();
  });
});
