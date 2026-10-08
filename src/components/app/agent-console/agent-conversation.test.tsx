// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentConversation } from "@/components/app/agent-console/agent-conversation";
import type {
  AgentMessageMetadata,
  AgentUIMessage,
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

function renderConversation(messages: AgentUIMessage[]) {
  return render(
    <AgentConversation
      emptyDescription="Add manuscript context or ask a project question."
      emptyTitle="Ask about this project"
      messages={messages}
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
    renderConversation([]);

    expect(screen.getByText("Ask about this project")).toBeTruthy();
    expect(
      screen.getByText("Add manuscript context or ask a project question."),
    ).toBeTruthy();
  });

  it("renders persisted messages in chronological order", () => {
    renderConversation([
      textMessage("user-1", "user", "First question"),
      textMessage("assistant-1", "assistant", "First answer"),
      textMessage("user-2", "user", "Second question"),
    ]);

    const first = screen.getByText("First question");
    const answer = screen.getByText("First answer");
    const second = screen.getByText("Second question");
    expect(first.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(answer.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps older messages unmounted until the writer requests them", () => {
    const messages = Array.from({ length: 10 }, (_, index) =>
      textMessage(`message-${index}`, index % 2 === 0 ? "user" : "assistant", `Message ${index}`),
    );
    renderConversation(messages);

    expect(screen.queryByText("Message 0")).toBeNull();
    expect(screen.queryByText("Message 1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show 2 earlier messages" }));
    expect(screen.getByText("Message 0")).toBeTruthy();
    expect(screen.getByText("Message 1")).toBeTruthy();
  });


  it("renders the stock scroll-to-latest control when the transcript is scrolled up", async () => {
    renderConversation([
      textMessage("assistant-long", "assistant", "A long transcript"),
    ]);
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

  it("reveals a new follow-up after scrolling up, then respects manual scrolling during the reply", async () => {
    const messages = Array.from({ length: 8 }, (_, index) =>
      textMessage(`message-${index}`, index % 2 === 0 ? "user" : "assistant", `Message ${index}`),
    );
    const { rerender } = renderConversation(messages);
    const viewport = screen.getByRole("region", { name: "Conversation messages" });
    Object.defineProperty(viewport, "scrollHeight", { value: 600 });
    Object.defineProperty(viewport, "clientHeight", { value: 100 });
    viewport.scrollTop = 499;
    fireEvent.scroll(viewport);
    viewport.scrollTop = 20;
    fireEvent.scroll(viewport);
    await screen.findByRole("button", { name: "Scroll to latest message" });
    const followUp = textMessage("follow-up", "user", "Keep the dry sarcasm");
    const props = {
      emptyDescription: "Add manuscript context or ask a project question.",
      emptyTitle: "Ask about this project",
      onRetry: vi.fn().mockResolvedValue({ status: "success" }),
      onOpenSettings: vi.fn(),
    };

    rerender(<AgentConversation {...props} messages={[...messages, followUp]} />);

    await waitFor(() => expect(viewport.scrollTop).toBe(499));
    expect(screen.getByText("Keep the dry sarcasm")).toBeTruthy();
    viewport.scrollTop = 20;
    fireEvent.scroll(viewport);
    await screen.findByRole("button", { name: "Scroll to latest message" });

    rerender(<AgentConversation {...props} messages={[...messages, followUp, textMessage("reply", "assistant", "Updated edit")]} />);

    await waitFor(() => expect(viewport.scrollTop).toBe(20));
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
          emptyDescription="Add manuscript context or ask a project question."
          emptyTitle="Ask about this project"
          messages={[textMessage("assistant-scroll", "assistant", "Transcript row")]}
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
