// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  readAppData: vi.fn(),
  writeAppData: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return {
    ...actual,
    readAppData: tauri.readAppData,
    writeAppData: tauri.writeAppData,
  };
});

import { AgentConsole } from "@/components/app/agent-console/agent-console";
import type {
  AgentMessageMetadata,
  AgentPersistenceIssue,
  AgentUIMessage,
  DraftContextRef,
  PendingProposal,
} from "@/lib/ai/agent-types";
import { EMPTY_META } from "@/lib/migration";
import type { ProjectInfo } from "@/lib/types";
import {
  EMPTY_AGENT_STATE,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import {
  agentStateKey,
  emptyPersistedAgentState,
  retryAgentPersistence,
  saveAgentState,
  toAgentSnapshot,
  transitionAgentProject,
} from "@/stores/agent-persistence";
import { useProjectStore } from "@/stores/project-store";
import {
  SETTINGS_TABS,
  useSettingsDialogStore,
} from "@/stores/settings-dialog-store";
import { useViewStore } from "@/stores/view-store";

const project: ProjectInfo = {
  root: "/private/books/quiet-novel",
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

const metadata: AgentMessageMetadata = {
  runId: "run-1",
  mode: "edit",
  task: { kind: "conversation", targetChapterId: "chapter-1" },
  state: "complete",
  createdAt: "2026-07-30T12:00:00.000Z",
  error: null,
  errorCode: null,
  retryOf: null,
  usage: null,
};

const message: AgentUIMessage = {
  id: "assistant-1",
  role: "assistant",
  metadata,
  parts: [{ type: "text", text: "The bridge can stay quiet." }],
};

const draftRef: DraftContextRef = {
  kind: "block",
  chapterId: "chapter-1",
  blockId: "block-1",
};

const proposal: PendingProposal = {
  id: "proposal-1",
  kind: "manuscript",
  projectRoot: project.root,
  chapterId: "chapter-1",
  summary: "Tighten the crossing",
  createdAt: "2026-07-30T12:01:00.000Z",
  originatingMessageId: "assistant-1",
  changes: [],
};

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

beforeEach(async () => {
  tauri.readAppData.mockReset();
  tauri.readAppData.mockResolvedValue(null);
  tauri.writeAppData.mockReset();
  tauri.writeAppData.mockResolvedValue(undefined);
  await retryAgentPersistence();
  await transitionAgentProject(null);
  resetConsoleState();
  useProjectStore.setState({
    status: "ready",
    project,
    meta: EMPTY_META,
    activeChapterId: "chapter-1",
    blocks: [],
  });
  useViewStore.setState({ aiOpen: true, focus: false });
  useSettingsDialogStore.setState({
    open: false,
    tab: SETTINGS_TABS.APPEARANCE,
  });
  tauri.readAppData.mockClear();
  tauri.writeAppData.mockClear();
});

afterEach(async () => {
  cleanup();
  tauri.writeAppData.mockResolvedValue(undefined);
  await retryAgentPersistence();
  await transitionAgentProject(null);
});

describe("AgentConsole shell", () => {
  it("renders header, conversation, tray, and composer in fixed DOM order", () => {
    useAgentConsoleStore.setState({ pendingProposal: proposal });
    render(<AgentConsole />);

    const shell = screen.getByRole("region", { name: "AI Console" });
    const header = screen.getByText("AI Console").closest("header");
    const conversation = screen.getByRole("log");
    const tray = shell.querySelector("[data-agent-review-tray]");
    const composer = screen.getByRole("region", { name: "Agent composer" });
    if (header === null || tray === null) {
      throw new Error("Agent console region is missing");
    }
    const children = Array.from(shell.children);

    expect(children.indexOf(header)).toBeLessThan(
      children.indexOf(conversation),
    );
    expect(children.indexOf(conversation)).toBeLessThan(
      children.indexOf(tray),
    );
    expect(children.indexOf(tray)).toBeLessThan(children.indexOf(composer));
    expect(composer.previousElementSibling).toBe(tray);
    expect(tray.parentElement).toBe(shell);
    expect(screen.queryByText(project.root)).toBeNull();
  });

  it("keeps header, banner, tray, and composer outside the scroll contract", () => {
    useAgentConsoleStore.setState({
      pendingProposal: proposal,
      persistenceIssue: {
        kind: "save",
        projectRoot: project.root,
        message: "disk full",
      },
    });
    render(<AgentConsole />);

    const shell = screen.getByRole("region", { name: "AI Console" });
    const conversation = screen.getByRole("log");
    const viewport = screen.getByRole("region", {
      name: "Conversation messages",
    });
    const header = screen.getByText("AI Console").closest("header");
    const banner = screen.getByRole("alert");
    const tray = shell.querySelector<HTMLElement>("[data-agent-review-tray]");
    const composer = screen.getByRole("region", { name: "Agent composer" });
    if (header === null || tray === null) {
      throw new Error("Agent console regions are missing");
    }

    expect(conversation.parentElement).toBe(shell);
    expect(conversation.className.split(" ")).toEqual(
      expect.arrayContaining(["min-h-0", "overflow-y-hidden"]),
    );
    expect(viewport.className.split(" ")).toContain("overflow-y-auto");

    for (const region of [header, banner, tray, composer]) {
      expect(region.parentElement).toBe(shell);
      expect(region.className.split(" ")).not.toContain("overflow-y-auto");
      expect(region.className.split(" ")).not.toContain("overflow-y-scroll");
      expect(getComputedStyle(region).overflowY).not.toBe("auto");
      expect(getComputedStyle(region).overflowY).not.toBe("scroll");
    }
  });

  it("hides and reopens the same conversation, draft, mode, attachments, and proposal", () => {
    useAgentConsoleStore.setState({
      mode: "edit",
      messages: [message],
      draftText: "Preserve this next turn",
      draftContextRefs: [draftRef],
      pendingProposal: proposal,
    });

    function Harness() {
      const aiOpen = useViewStore((state) => state.aiOpen);
      const openAiConsole = useViewStore((state) => state.openAiConsole);
      return aiOpen ? (
        <AgentConsole />
      ) : (
        <button onClick={openAiConsole} type="button">
          Reopen AI Console
        </button>
      );
    }

    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "Close AI Console" }),
    );

    expect(useViewStore.getState().aiOpen).toBe(false);
    expect(screen.queryByRole("region", { name: "AI Console" })).toBeNull();
    expect(useAgentConsoleStore.getState()).toMatchObject({
      mode: "edit",
      messages: [message],
      draftText: "Preserve this next turn",
      draftContextRefs: [draftRef],
      pendingProposal: proposal,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Reopen AI Console" }),
    );

    expect(screen.getByText("The bridge can stay quiet.")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Preserve this next turn",
    );
    expect(
      screen.getByRole("button", { name: "Edit" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText("Tighten the crossing")).toBeTruthy();
  });

  it("hides the old project conversation while the next project is loading", async () => {
    await transitionAgentProject(project.root);
    useAgentConsoleStore.setState({
      mode: "edit",
      messages: [message],
      summary: {
        text: "Book A compacted context",
        throughMessageId: message.id,
      },
      draftText: "Book A draft",
      pendingProposal: proposal,
      persistenceIssue: {
        kind: "save",
        projectRoot: project.root,
        message: "Book A save failed",
      },
    });
    const bookB: ProjectInfo = {
      ...project,
      root: "/private/books/second-novel",
      name: "Second Novel",
      title: "Second Novel",
      metadata: { ...project.metadata, title: "Second Novel" },
    };
    let releaseWrite!: () => void;
    const slowWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    tauri.writeAppData.mockReturnValueOnce(slowWrite);
    useProjectStore.setState({ project: bookB });
    const switching = transitionAgentProject(bookB.root);

    try {
      await waitFor(() => expect(tauri.writeAppData).toHaveBeenCalledOnce());
      render(<AgentConsole />);

      expect(screen.getByText("Second Novel / 1. The Crossing")).toBeTruthy();
      expect(screen.queryByText("The bridge can stay quiet.")).toBeNull();
      expect(screen.queryByText("Older context compacted")).toBeNull();
      expect(screen.queryByText("Tighten the crossing")).toBeNull();
      expect(screen.queryByDisplayValue("Book A draft")).toBeNull();
      expect(screen.queryByRole("log")).toBeNull();
      expect(
        screen.queryByRole("region", { name: "Agent composer" }),
      ).toBeNull();
      expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Close AI Console" }),
      ).toBeTruthy();
    } finally {
      releaseWrite();
      await switching;
    }
  });
});

describe("AgentConsole persistence banner", () => {
  it("keeps a save failure visible until Retry succeeds", async () => {
    await transitionAgentProject(project.root);
    useAgentConsoleStore.getState().setDraftText("Unsaved conversation draft");
    tauri.writeAppData.mockRejectedValueOnce(new Error("disk full"));
    await expect(
      saveAgentState(project.root, await toAgentSnapshot()),
    ).rejects.toMatchObject({
      issue: { kind: "save", projectRoot: project.root },
    });
    render(<AgentConsole />);

    expect(screen.getByRole("alert").textContent).toContain(
      "AI conversation could not be saved.",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(document.body.textContent).not.toContain(project.root);

    tauri.writeAppData.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(useAgentConsoleStore.getState().persistenceIssue).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("requires destructive confirmation before resetting malformed v3 state", async () => {
    await transitionAgentProject(project.root);
    const issue: AgentPersistenceIssue = {
      kind: "corrupt",
      projectRoot: project.root,
      message: `Malformed conversation at ${project.root}`,
    };
    useAgentConsoleStore.setState({
      mode: "edit",
      messages: [message],
      draftText: "Unreadable draft",
      persistenceIssue: issue,
    });
    render(<AgentConsole />);

    expect(
      screen.getByRole("button", { name: "Reset AI Conversation" }),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain(project.root);
    fireEvent.click(
      screen.getByRole("button", { name: "Reset AI Conversation" }),
    );

    expect(tauri.writeAppData).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    const reset = screen.getByRole("button", { name: "Reset Conversation" });
    expect(reset.dataset.variant).toBe("destructive");
    expect(dialog.textContent).not.toContain(project.root);

    fireEvent.click(reset);

    await waitFor(() =>
      expect(tauri.writeAppData).toHaveBeenCalledWith(
        agentStateKey(project.root),
        emptyPersistedAgentState(),
      ),
    );
    expect(useAgentConsoleStore.getState()).toMatchObject({
      mode: "writing",
      messages: [],
      draftText: "",
      pendingProposal: null,
      persistenceIssue: null,
      hydratedProjectRoot: project.root,
    });
  });

  it("reports a stale reset dialog without throwing through the click handler", async () => {
    await transitionAgentProject(project.root);
    const issue: AgentPersistenceIssue = {
      kind: "corrupt",
      projectRoot: project.root,
      message: `Malformed conversation at ${project.root}`,
    };
    useAgentConsoleStore.setState({ persistenceIssue: issue });
    render(<AgentConsole />);

    fireEvent.click(
      screen.getByRole("button", { name: "Reset AI Conversation" }),
    );
    const reset = screen.getByRole("button", { name: "Reset Conversation" });
    useAgentConsoleStore.setState({
      requestedProjectRoot: "/private/books/new-novel",
      activeProjectRoot: "/private/books/new-novel",
      hydratedProjectRoot: "/private/books/new-novel",
    });

    expect(() => fireEvent.click(reset)).not.toThrow();
    expect(tauri.writeAppData).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        "AI conversation could not be reset. Check storage access and try again.",
      ),
    ).toBeTruthy();
  });
});

describe("AgentConsole configuration navigation", () => {
  it("opens the AI settings tab from an inline configuration error", () => {
    useAgentConsoleStore.setState({
      runError: {
        reason: "model-unselected",
        message: "Choose a model for OpenAI, then submit again.",
        action: "choose-model",
        settingsTarget: "model",
      },
    });
    render(<AgentConsole />);

    fireEvent.click(
      screen.getByRole("button", { name: "Choose model" }),
    );

    expect(useSettingsDialogStore.getState()).toMatchObject({
      open: true,
      tab: SETTINGS_TABS.AI,
    });
  });
});
