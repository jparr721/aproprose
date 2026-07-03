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
// APIs happy-dom lacks; stub them to the minimum these tests drive (a send
// button, and per-reply action buttons that keep their label + onClick).
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
  MessageAction: ({
    children,
    label,
    onClick,
  }: {
    children: React.ReactNode;
    label?: string;
    onClick?: () => void;
  }) => (
    <button aria-label={label} onClick={onClick}>
      {children}
    </button>
  ),
  MessageContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageResponse: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { BrainstormTab } from "@/components/app/right-panel/brainstorm-tab";
import { brainstorm } from "@/lib/ai/operations";
import { useProjectStore } from "@/stores/project-store";
import { useBrainstormStore } from "@/stores/brainstorm-store";
import { useAiIntentStore } from "@/stores/ai-intent-store";

const CH = "ch1";
const REPLY = "Kill the lights mid-toast.";

// Yields one chunk, then the stream fails (provider drop / rate-limit mid-stream).
async function* failingStream(): AsyncGenerator<string> {
  yield "Half a thought";
  throw new Error("stream boom");
}

// Yields one chunk, then stays open: a reply still streaming in.
async function* hangingStream(): AsyncGenerator<string> {
  yield "Partial reply";
  await new Promise<never>(() => {});
}

const seedThread = () =>
  useBrainstormStore.setState({
    threads: {
      [CH]: [
        { role: "user", content: "raise the stakes" },
        { role: "assistant", content: REPLY },
      ],
    },
  });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  useProjectStore.setState({ activeChapterId: CH, blocks: [], selectedId: null });
  useBrainstormStore.setState({ threads: {} });
  useAiIntentStore.setState({ pending: null });
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

describe("BrainstormTab reply handoffs", () => {
  it("renders handoff actions on committed assistant replies only", () => {
    seedThread();
    render(<BrainstormTab />);
    // One assistant reply -> exactly one of each action; the user turn gets none.
    expect(screen.getAllByLabelText("Draft this")).toHaveLength(1);
    expect(screen.getAllByLabelText("Apply this")).toHaveLength(1);
    expect(screen.getAllByLabelText("Copy reply")).toHaveLength(1);
  });

  it("Draft this parks a suggest prefill carrying the reply", () => {
    seedThread();
    render(<BrainstormTab />);
    fireEvent.click(screen.getByLabelText("Draft this"));
    expect(useAiIntentStore.getState().pending).toEqual({
      tab: "suggest",
      instruction: REPLY,
      autoRun: false,
    });
  });

  it("Apply this parks a chapter-scope edit prefill carrying the reply", () => {
    seedThread();
    render(<BrainstormTab />);
    fireEvent.click(screen.getByLabelText("Apply this"));
    expect(useAiIntentStore.getState().pending).toEqual({
      tab: "edit",
      instruction: REPLY,
      scope: "chapter",
      autoRun: false,
    });
  });

  it("shows no handoff actions on the in-flight streaming reply", async () => {
    vi.mocked(brainstorm).mockResolvedValue({
      textStream: hangingStream(),
    } as unknown as Awaited<ReturnType<typeof brainstorm>>);
    render(<BrainstormTab />);
    fireEvent.click(screen.getByText("send"));
    await screen.findByText("Partial reply");
    expect(screen.queryByLabelText("Draft this")).toBeNull();
    expect(screen.queryByLabelText("Apply this")).toBeNull();
  });
});
