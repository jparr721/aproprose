// @vitest-environment happy-dom
//
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/operations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/operations")>();
  return { ...actual, guideChapterOutline: vi.fn() };
});
vi.mock("@/components/ai-elements/conversation", () => ({
  Conversation: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ConversationContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ConversationScrollButton: () => null,
}));
vi.mock("@/components/ai-elements/message", () => ({
  Message: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageResponse: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ai-elements/prompt-input", () => ({
  PromptInput: ({
    children,
    onSubmit,
  }: {
    children: React.ReactNode;
    onSubmit: (message: { text: string }) => void;
  }) => (
    <div>
      {children}
      <button onClick={() => onSubmit({ text: "Mara signs Oren's name." })}>
        Send guided message
      </button>
    </div>
  ),
  PromptInputBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PromptInputTextarea: ({ placeholder }: { placeholder: string }) => <div>{placeholder}</div>,
  PromptInputFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PromptInputSubmit: () => null,
}));

import { GuidedOutline } from "@/components/app/outline/guided-outline";
import { guideChapterOutline, type GuidedOutlineTurn } from "@/lib/ai/operations";
import { useOutlineGuideStore } from "@/stores/outline-guide-store";
import { useProjectStore } from "@/stores/project-store";

const turn: GuidedOutlineTurn = {
  reply: "That gives the chapter an irreversible choice.",
  plan: {
    chapterId: "ch1",
    summary: "Mara takes her brother's place at the winter court.",
    act: "setup",
    plotPoint: "inciting",
    premise: "A royal summons corners Mara.",
    goal: "Keep Oren out of the queen's service.",
    conflict: "The summons names Oren and the courier waits for an answer.",
    turn: "Mara signs Oren's name and goes in his place.",
    characterIds: ["mara", "oren"],
    beats: [
      {
        sourceCardId: null,
        title: "The false signature",
        intention: "Make Mara's substitution concrete and irreversible.",
        characterIds: ["mara", "oren"],
        loreIds: ["winter-court"],
      },
    ],
  },
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

afterEach(() => cleanup());

beforeEach(() => {
  useOutlineGuideStore.getState().reset();
  useProjectStore.setState({
    project: {
      root: "/novel",
      name: "Northbound",
      mainFile: "main.tex",
      title: "Northbound",
      author: "A. Writer",
      metadata: {
        title: "Northbound",
        subtitle: "",
        author: "A. Writer",
        publisher: "",
        isbn: "",
      },
      chapters: [
        {
          id: "ch1",
          label: "I",
          title: "The Winter Letter",
          file: "content/ch1.tex",
          wordCount: 0,
        },
      ],
    },
    activeChapterId: "ch1",
    blocks: [],
    meta: {
      version: 3,
      statuses: {},
      outline: { premise: "A courier carries a treasonous letter north." },
      characters: [
        { id: "mara", name: "Mara", color: "#111111", role: "Courier" },
        { id: "oren", name: "Oren", color: "#222222", role: "Brother" },
      ],
      lore: [
        {
          id: "winter-court",
          title: "Winter Court",
          description: "The queen's northern seat.",
          characterIds: [],
          tags: ["place"],
        },
      ],
      chapters: {},
    },
  } as never);
  vi.mocked(guideChapterOutline).mockReset();
  vi.mocked(guideChapterOutline).mockResolvedValue(turn);
});

describe("GuidedOutline", () => {
  it("turns the conversation into a reviewable plan and applies it atomically", async () => {
    render(<GuidedOutline chapterId="ch1" />);
    expect(screen.getByText("Talk the chapter through")).toBeTruthy();

    fireEvent.click(screen.getByText("Send guided message"));

    await screen.findByText("That gives the chapter an irreversible choice.");
    expect(screen.getByText("The false signature")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Apply plan" }));

    await waitFor(() => {
      expect(useProjectStore.getState().meta.chapters.ch1.goal).toBe(
        "Keep Oren out of the queen's service.",
      );
    });
    expect(useProjectStore.getState().meta.chapters.ch1.cards[0].title).toBe(
      "The false signature",
    );
    expect(screen.getByRole("button", { name: "Applied" }).hasAttribute("disabled")).toBe(true);
  });

  it("keeps Build preview from submitting and clearing a dictated draft", () => {
    useOutlineGuideStore.getState().hydrate({
      ch1: {
        messages: [{ role: "user", content: "The summons arrives at dawn." }],
        plan: null,
      },
    });

    render(<GuidedOutline chapterId="ch1" />);

    expect(screen.getByRole("button", { name: "Build preview" }).getAttribute("type")).toBe(
      "button",
    );
  });

  it("ignores a turn started before the project is reopened", async () => {
    const oldTurn = deferred<GuidedOutlineTurn>();
    vi.mocked(guideChapterOutline).mockReturnValueOnce(oldTurn.promise);

    render(<GuidedOutline chapterId="ch1" />);
    fireEvent.click(screen.getByText("Send guided message"));

    await waitFor(() => {
      expect(guideChapterOutline).toHaveBeenCalledTimes(1);
    });

    act(() => {
      useProjectStore.setState({ project: { ...useProjectStore.getState().project!, root: "/other" } });
      useProjectStore.setState({ project: { ...useProjectStore.getState().project!, root: "/novel" } });
      useOutlineGuideStore.getState().hydrate({
        ch1: {
          messages: [{ role: "user", content: "A newer session belongs here." }],
          plan: turn.plan,
        },
      });
    });

    await act(async () => {
      oldTurn.resolve({ ...turn, reply: "A stale reply." });
      await oldTurn.promise;
    });

    expect(useOutlineGuideStore.getState().sessions.ch1).toEqual({
      messages: [{ role: "user", content: "A newer session belongs here." }],
      plan: turn.plan,
    });
  });
});
