// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMessage } from "@/components/app/agent-console/agent-message";
import type {
  AgentMessageMetadata,
  AgentUIMessage,
  ContextSnapshot,
} from "@/lib/ai/agent-types";
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
});

beforeEach(() => {
  useAgentConsoleStore.setState({
    ...EMPTY_AGENT_STATE,
    messages: [],
    draftContextRefs: [],
    draftContextSources: {},
    draftSourceLocators: {},
  });
  useProjectStore.setState({ project: null });
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

  it("shows a tool error without exposing its input", () => {
    renderAgentMessage(
      assistantMessage(
        "assistant-tool-error",
        [
          {
            type: "tool-read_chapter",
            toolCallId: "call-error",
            state: "output-error",
            input: { chapterId: "chapter-1" },
            errorText: "The chapter could not be read.",
          },
        ],
        metadata({ state: "error", errorCode: "tool" }),
      ),
    );

    expect(screen.getByText("Error")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Read chapter/ }));
    expect(screen.getByText("The chapter could not be read.")).toBeTruthy();
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
  it("renders a failed run inline and retries the original user message", async () => {
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
        error: "The request lost its connection.",
        errorCode: "transport",
      }),
    );
    useAgentConsoleStore.setState({ messages: [user, failed] });
    const { onRetry } = renderAgentMessage(failed);

    expect(screen.getByText("The request lost its connection.")).toBeTruthy();
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
