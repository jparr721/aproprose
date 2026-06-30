// @vitest-environment happy-dom
//
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ai/operations", () => ({ brainstorm: vi.fn() }));
// The AI-elements chat surface and the shared composer pull in scroll/observer
// APIs happy-dom lacks; stub them to the minimum this test drives (a send button).
vi.mock("@/components/app/right-panel/shared", () => ({
  AiComposer: ({ onSubmit }: { onSubmit: (t: string) => void }) => (
    <button onClick={() => onSubmit("hi")}>send</button>
  ),
  AiError: () => <div>err</div>,
  PanelEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ScopeToggle: () => <div />,
}));
vi.mock("@/components/ai-elements/conversation", () => ({
  Conversation: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ConversationContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ConversationScrollButton: () => <div />,
}));
vi.mock("@/components/ai-elements/message", () => ({
  Message: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageActions: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageAction: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageResponse: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { BrainstormTab } from "@/components/app/right-panel/brainstorm-tab";
import { brainstorm } from "@/lib/ai/operations";
import { useProjectStore } from "@/stores/project-store";
import { useBrainstormStore } from "@/stores/brainstorm-store";

const CH = "ch1";

// Yields one chunk, then the stream fails (provider drop / rate-limit mid-stream).
async function* failingStream(): AsyncGenerator<string> {
  yield "Half a thought";
  throw new Error("stream boom");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  useProjectStore.setState({ activeChapterId: CH, blocks: [], selectedId: null });
  useBrainstormStore.setState({ threads: {} });
  vi.mocked(brainstorm).mockResolvedValue({
    textStream: failingStream(),
  } as unknown as Awaited<ReturnType<typeof brainstorm>>);
});

describe("BrainstormTab stream failure", () => {
  it("does not persist a failed partial stream as a finished reply, and logs the error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<BrainstormTab />);
    fireEvent.click(screen.getByText("send"));

    // The log fires only from the failure catch, after the thread is committed, so
    // it is the deterministic settle signal (the intermediate "user turn only" state
    // is set synchronously in send() before the stream even starts).
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    // The user turn is kept (so "Try again" works), but the half-streamed reply is
    // NOT committed as a finished assistant message that would survive reload.
    expect(useBrainstormStore.getState().threads[CH]).toEqual([
      { role: "user", content: "hi" },
    ]);
  });
});
