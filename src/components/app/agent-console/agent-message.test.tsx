// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMessage } from "@/components/app/agent-console/agent-message";
import type {
  AgentMessageMetadata,
  AgentUIMessage,
  ContextSnapshot,
} from "@/lib/ai/agent-types";
import { EMPTY_META } from "@/lib/migration";
import { EMPTY_AGENT_STATE, useAgentConsoleStore } from "@/stores/agent-console-store";
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
  const onNavigateSnapshot = vi.fn().mockResolvedValue(true);
  const onRetry = vi.fn().mockResolvedValue(undefined);
  const onOpenSettings = vi.fn();
  render(
    <AgentMessage
      message={message}
      onNavigateSnapshot={onNavigateSnapshot}
      onRetry={onRetry}
      onOpenSettings={onOpenSettings}
    />,
  );
  return { onNavigateSnapshot, onRetry, onOpenSettings };
}

const snapshot: ContextSnapshot = {
  id: "snapshot-1",
  kind: "block",
  chapterId: "ch1",
  sourceId: "block-1",
  order: 0,
  sourceType: "narration",
  label: "Narration block",
  exactText: "Frozen source text.",
  sourceFingerprint: "fingerprint-1",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  useAgentConsoleStore.setState({
    ...EMPTY_AGENT_STATE,
    messages: [],
    draftContextRefs: [],
    draftContextSources: {},
    draftSourceLocators: {},
  });
  useProjectStore.setState({ project: null, meta: EMPTY_META });
});

describe("AgentMessage content", () => {
  it("renders message text as a markdown response", () => {
    renderAgentMessage(
      assistantMessage(
        "assistant-text",
        [{ type: "text", text: "A **quiet answer**." }],
        metadata({}),
      ),
    );

    expect(screen.getByText("quiet answer").dataset.streamdown).toBe("strong");
  });

  it("renders non-null model usage through the stock context view", async () => {
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

    const trigger = screen.getByRole("button", {
      name: /Model context usage/,
    });
    expect(trigger.textContent).toContain("15%");
    fireEvent.pointerEnter(trigger);

    expect(await screen.findByText("1.5K / 10K")).toBeTruthy();
    expect(screen.getByText("Model: gpt-4.1")).toBeTruthy();
    const inputUsage = screen.getByText("Input").parentElement;
    const outputUsage = screen.getByText("Output").parentElement;
    if (inputUsage === null || outputUsage === null) {
      throw new Error("Rendered token usage rows are missing.");
    }
    expect(inputUsage.textContent).toContain("1K - ");
    expect(outputUsage.textContent).toContain("500 - ");
    expect(`${inputUsage.textContent}${outputUsage.textContent}`).not.toMatch(
      /[^\x00-\x7F]/,
    );
  });

  it("never renders model reasoning from a malformed message", () => {
    const malformed = assistantMessage(
      "assistant-reasoning",
      [
        { type: "reasoning", text: "Private chain of thought", state: "done" },
        { type: "text", text: "Visible answer" },
      ],
      metadata({}),
    );

    renderAgentMessage(malformed);

    expect(screen.getByText("Visible answer")).toBeTruthy();
    expect(screen.queryByText("Private chain of thought")).toBeNull();
  });

  it("renders immutable context data as sent attachments", () => {
    renderAgentMessage(
      assistantMessage(
        "assistant-context",
        [{ type: "data-context", data: { snapshots: [snapshot] } }],
        metadata({}),
      ),
    );

    expect(
      screen.getByRole("button", { name: "Open Narration block context" }),
    ).toBeTruthy();
  });

  it("renders finding cards whose actions add stable finding context without submitting", async () => {
    const message = assistantMessage(
      "assistant-findings",
      [
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
                blockIds: ["block-2"],
              },
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
      metadata({}),
    );
    useAgentConsoleStore.setState({ messages: [message] });

    renderAgentMessage(message);

    expect(screen.getByRole("group", { name: "Pacing finding" })).toBeTruthy();
    expect(screen.getByText("The middle stalls.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Add to Chat" })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: "Add to Chat" })[0]);
    await waitFor(() =>
      expect(useAgentConsoleStore.getState().draftContextRefs).toEqual([
        {
          kind: "finding",
          chapterId: "ch1",
          findingId: "assistant-findings:0",
        },
      ]),
    );
    expect(useAgentConsoleStore.getState().messages).toEqual([message]);
  });

  it("uses one finding index across every findings part in a message", async () => {
    useProjectStore.setState({
      project: {
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
      },
    });
    useAgentConsoleStore.setState({ hydratedProjectRoot: "/book" });
    const message = assistantMessage(
      "assistant-split-findings",
      [
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
                blockIds: ["block-2"],
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
      metadata({}),
    );
    useAgentConsoleStore.setState({ messages: [message] });

    renderAgentMessage(message);
    fireEvent.click(screen.getAllByRole("button", { name: "Add to Chat" })[1]);

    await waitFor(() =>
      expect(useAgentConsoleStore.getState().draftContextRefs).toEqual([
        {
          kind: "finding",
          chapterId: "ch1",
          findingId: "assistant-split-findings:1",
        },
      ]),
    );
    await waitFor(() =>
      expect(
        useAgentConsoleStore.getState().draftContextSources[
          "finding:ch1:assistant-split-findings:1"
        ],
      ).toMatchObject({
        available: true,
        label: "Voice",
        preview: "The restraint lands.",
      }),
    );
  });

  it("renders proposal and compaction data as compact status rows", () => {
    renderAgentMessage(
      assistantMessage(
        "assistant-status",
        [
          {
            type: "data-proposal-event",
            data: {
              proposalId: "proposal-1",
              action: "accepted",
              changeCount: 1,
              text: "Accepted one manuscript change.",
            },
          },
          {
            type: "data-compaction",
            data: {
              throughMessageId: "assistant-old",
              text: "Private compaction summary",
            },
          },
        ],
        metadata({}),
      ),
    );

    expect(screen.getByText("Accepted one manuscript change.")).toBeTruthy();
    expect(screen.getByText("Older context compacted")).toBeTruthy();
    expect(screen.queryByText("Private compaction summary")).toBeNull();
  });
});

describe("AgentMessage safe tool activity", () => {
  it("shows pending and running tool states with target IDs only", () => {
    renderAgentMessage(
      assistantMessage(
        "assistant-tools",
        [
          {
            type: "tool-read_chapter",
            toolCallId: "call-pending",
            state: "input-streaming",
            input: { chapterId: "chapter-pending" },
          },
          {
            type: "tool-run_critique",
            toolCallId: "call-running",
            state: "input-available",
            input: {
              chapterId: "chapter-running",
              focus: "Never render this model instruction",
            },
          },
        ],
        metadata({ state: "streaming" }),
      ),
    );

    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Read chapter/ }));
    fireEvent.click(screen.getByRole("button", { name: /Run critique/ }));
    expect(screen.getByText("chapter-pending")).toBeTruthy();
    expect(screen.getByText("chapter-running")).toBeTruthy();
    expect(screen.queryByText("Never render this model instruction")).toBeNull();
  });

  it("never renders an absolute path supplied as a tool target", () => {
    renderAgentMessage(
      assistantMessage(
        "assistant-path-tool",
        [
          {
            type: "tool-read_chapter",
            toolCallId: "call-path",
            state: "input-available",
            input: { chapterId: "/Users/author/novel/chapter.tex" },
          },
        ],
        metadata({ state: "streaming" }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /Read chapter/ }));
    expect(screen.getByText("Chapter")).toBeTruthy();
    expect(document.body.textContent).not.toContain("/Users/author");
  });

  it("renders only a completed tool summary and never its runtime value", () => {
    renderAgentMessage(
      assistantMessage(
        "assistant-complete-tool",
        [
          {
            type: "tool-read_chapter",
            toolCallId: "call-complete",
            state: "output-available",
            input: { chapterId: "chapter-1" },
            output: {
              kind: "runtime",
              summary: {
                label: "Read chapter",
                target: "Chapter One",
                detail: "2 blocks",
                itemCount: 2,
              },
              value: {
                chapterId: "chapter-1",
                title: "Chapter One",
                blocks: [
                  {
                    id: "block-1",
                    order: 0,
                    type: "narration",
                    text: "RAW PRIVATE CHAPTER BODY",
                    fingerprint: "fingerprint-1",
                  },
                ],
              },
            },
          },
        ],
        metadata({}),
      ),
    );

    expect(screen.getByText("Completed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Read chapter/ }));
    expect(screen.getByText("Chapter One")).toBeTruthy();
    expect(screen.getByText("2 blocks")).toBeTruthy();
    expect(screen.queryByText("RAW PRIVATE CHAPTER BODY")).toBeNull();
    expect(document.body.textContent).not.toContain("fingerprint-1");
  });

  it("reconstructs completed tool copy without raw errors or absolute paths", () => {
    renderAgentMessage(
      assistantMessage(
        "assistant-unsafe-summary",
        [
          {
            type: "tool-read_chapter",
            toolCallId: "call-unsafe-summary",
            state: "output-available",
            input: { chapterId: "chapter-1" },
            output: {
              kind: "summary",
              summary: {
                label: "APICallError C:\\Users\\author\\private\\chapter.tex",
                target: "Result at /Users/author/private/chapter.tex",
                detail: "ENOENT /private/book/chapter.tex",
                itemCount: 1,
              },
            },
          },
        ],
        metadata({}),
      ),
    );

    expect(screen.getByText("Read chapter")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Read chapter/ }));
    expect(screen.getByText("Chapter")).toBeTruthy();
    expect(screen.getByText("1 block")).toBeTruthy();
    expect(document.body.textContent).not.toContain("APICallError");
    expect(document.body.textContent).not.toContain("/Users/author");
    expect(document.body.textContent).not.toContain("C:\\Users\\author");
  });

  it("shows safe tool error copy without exposing raw Unix or Windows paths", () => {
    const rawError =
      "ENOENT at /Users/author/private/chapter.tex from C:\\Users\\author\\private\\chapter.tex";
    renderAgentMessage(
      assistantMessage(
        "assistant-tool-error",
        [
          {
            type: "tool-read_chapter",
            toolCallId: "call-error",
            state: "output-error",
            input: { chapterId: "chapter-1" },
            errorText: rawError,
          },
        ],
        metadata({ state: "error", errorCode: "tool" }),
      ),
    );

    expect(screen.getByText("Error")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Read chapter/ }));
    expect(
      screen.getByText("Read chapter could not be completed. Retry the request."),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain(rawError);
    expect(document.body.textContent).not.toContain("/Users/author");
    expect(document.body.textContent).not.toContain("C:\\Users\\author");
  });

  it("uses safe copy when a production tool projection throws", () => {
    vi.stubEnv("DEV", false);
    const rawError = "ENOENT /Users/author/private/chapter.tex";
    const output = {} as {
      kind: "summary";
      summary: never;
    };
    Object.defineProperty(output, "summary", {
      get: () => {
        throw new Error(rawError);
      },
    });
    const malformedPart = {
      type: "tool-read_chapter",
      toolCallId: "call-malformed",
      state: "output-available",
      input: { chapterId: "chapter-1" },
      output,
    } as AgentUIMessage["parts"][number];

    renderAgentMessage(
      assistantMessage(
        "assistant-malformed-tool",
        [malformedPart],
        metadata({}),
      ),
    );

    expect(screen.getByRole("alert").textContent).toBe(
      "Tool activity could not be displayed.",
    );
    expect(document.body.textContent).not.toContain(rawError);
  });

  it("marks a stopped unfinished tool without inventing a result", () => {
    renderAgentMessage(
      assistantMessage(
        "assistant-stopped",
        [
          {
            type: "tool-read_chapter",
            toolCallId: "call-stopped",
            state: "input-available",
            input: { chapterId: "chapter-1" },
          },
        ],
        metadata({ state: "stopped" }),
      ),
    );

    expect(screen.getByText("Read chapter - Stopped")).toBeTruthy();
    expect(screen.getAllByText("Stopped").length).toBeGreaterThan(0);
    expect(screen.queryByText("Completed")).toBeNull();
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
        error:
          "APICallError at /Users/author/.config/key from C:\\Users\\author\\.config\\key",
        errorCode: "transport",
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
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(onRetry).toHaveBeenCalledWith("original-user"));
  });

  it("offers AI Settings only for a typed configuration error", () => {
    const configuration = assistantMessage(
      "configuration-error",
      [],
      metadata({
        state: "error",
        error: "A required setting is unavailable.",
        errorCode: "configuration",
      }),
    );
    const { onOpenSettings } = renderAgentMessage(configuration);

    expect(
      screen.getByText("AI is not configured. Open AI Settings to continue."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open AI Settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();

    cleanup();
    renderAgentMessage(
      assistantMessage(
        "transport-error",
        [],
        metadata({
          state: "error",
          error: "OpenAI key or model could not be reached.",
          errorCode: "transport",
        }),
      ),
    );
    expect(screen.queryByRole("button", { name: "Open AI Settings" })).toBeNull();
  });
});
