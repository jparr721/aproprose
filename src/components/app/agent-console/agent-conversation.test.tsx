// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentConversation } from "@/components/app/agent-console/agent-conversation";
import type {
  AgentMessageMetadata,
  AgentUIMessage,
  ConversationSummary,
} from "@/lib/ai/agent-types";

function metadata(runId: string): AgentMessageMetadata {
  return {
    runId,
    mode: "writing",
    task: { kind: "conversation", targetChapterId: "ch1" },
    state: "complete",
    createdAt: "2026-07-30T00:00:00.000Z",
    error: null,
    errorCode: null,
    retryOf: null,
    usage: null,
  };
}

function textMessage(
  id: string,
  role: "user" | "assistant",
  text: string,
): AgentUIMessage {
  return {
    id,
    role,
    metadata: metadata(`run-${id}`),
    parts: [{ type: "text", text }],
  };
}

function renderConversation(
  messages: AgentUIMessage[],
  summary: ConversationSummary | null,
) {
  return render(
    <AgentConversation
      messages={messages}
      summary={summary}
      onNavigateSnapshot={vi.fn().mockResolvedValue(true)}
      onRetry={vi.fn().mockResolvedValue(undefined)}
      onOpenSettings={vi.fn()}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AgentConversation", () => {
  it("renders the project question empty state", () => {
    renderConversation([], null);

    expect(screen.getByText("Ask about this project")).toBeTruthy();
    expect(
      screen.getByText("Add manuscript context or ask a project question."),
    ).toBeTruthy();
  });

  it("renders persisted messages in chronological order", () => {
    renderConversation(
      [
        textMessage("user-1", "user", "First question"),
        textMessage("assistant-1", "assistant", "First answer"),
        textMessage("user-2", "user", "Second question"),
      ],
      null,
    );

    const first = screen.getByText("First question");
    const answer = screen.getByText("First answer");
    const second = screen.getByText("Second question");
    expect(first.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(answer.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("interleaves one saved compaction marker after its boundary message", () => {
    renderConversation(
      [
        textMessage("user-old", "user", "Older question"),
        textMessage("assistant-boundary", "assistant", "Boundary answer"),
        textMessage("user-new", "user", "Newer question"),
      ],
      {
        throughMessageId: "assistant-boundary",
        text: "Saved private summary",
      },
    );

    const marker = screen.getByText("Older context compacted");
    const transcript = marker.parentElement;
    if (transcript === null) throw new Error("Conversation content is missing");
    const rows = Array.from(transcript.children);
    const markerIndex = rows.indexOf(marker);

    expect(screen.getAllByText("Older context compacted")).toHaveLength(1);
    expect(rows).toHaveLength(4);
    expect(rows[markerIndex - 1].textContent).toContain("Boundary answer");
    expect(rows[markerIndex + 1].textContent).toContain("Newer question");
    expect(screen.queryByText("Saved private summary")).toBeNull();
  });

  it("renders the stock scroll-to-latest control when the transcript is scrolled up", async () => {
    renderConversation(
      [textMessage("assistant-long", "assistant", "A long transcript")],
      null,
    );
    const scrollRegion = screen.getByRole("region", {
      name: "Conversation messages",
    });
    Object.defineProperty(scrollRegion, "scrollHeight", { value: 300 });
    Object.defineProperty(scrollRegion, "clientHeight", { value: 100 });

    scrollRegion.scrollTop = 120;
    fireEvent.scroll(scrollRegion);
    scrollRegion.scrollTop = 20;
    fireEvent.scroll(scrollRegion);

    expect(
      await screen.findByRole("button", { name: "Scroll to latest message" }),
    ).toBeTruthy();
  });

  it("scrolls independently while a sibling tray or composer stays mounted", async () => {
    const siblingUnmounted = vi.fn();
    function Sibling() {
      useEffect(
        () => () => {
          siblingUnmounted();
        },
        [],
      );
      return <aside aria-label="Review tray">Review stays here</aside>;
    }

    render(
      <div className="flex h-48 flex-col">
        <AgentConversation
          messages={[textMessage("assistant-scroll", "assistant", "Transcript row")]}
          summary={null}
          onNavigateSnapshot={vi.fn().mockResolvedValue(true)}
          onRetry={vi.fn().mockResolvedValue(undefined)}
          onOpenSettings={vi.fn()}
        />
        <Sibling />
      </div>,
    );
    const sibling = screen.getByRole("complementary", { name: "Review tray" });
    const conversation = screen.getByRole("log");
    const scrollRegion = screen.getByRole("region", {
      name: "Conversation messages",
    });
    expect(conversation.contains(scrollRegion)).toBe(true);
    Object.defineProperty(scrollRegion, "scrollHeight", { value: 300 });
    Object.defineProperty(scrollRegion, "clientHeight", { value: 100 });
    scrollRegion.scrollTop = 40;

    fireEvent.scroll(scrollRegion);

    await waitFor(() => expect(scrollRegion.scrollTop).toBe(40));
    expect(screen.getByRole("complementary", { name: "Review tray" })).toBe(sibling);
    expect(siblingUnmounted).not.toHaveBeenCalled();
  });
});
