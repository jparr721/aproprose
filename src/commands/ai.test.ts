// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentIntent,
  AgentUIMessage,
  ManuscriptPendingProposal,
} from "@/lib/ai/agent-types";

const controller = vi.hoisted(() => ({
  dispatchAgentIntent: vi.fn<(intent: AgentIntent) => Promise<void>>(),
}));

vi.mock("@/lib/ai/agent-controller", () => ({
  dispatchAgentIntent: controller.dispatchAgentIntent,
}));

vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));

import { aiCommands } from "@/commands/ai";
import type { Command } from "@/commands/types";
import {
  EMPTY_AGENT_STATE,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import type { Block, ProjectInfo, ProjectMeta } from "@/lib/types";

const PICK_UP_DIRECTIVE =
  "Continue from the anchor. If later prose exists, propose only the minimum bridge into it and preserve that later prose. If the anchor is final prose, continue after it.";

const project: ProjectInfo = {
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
  chapters: [
    {
      id: "chapter-1",
      label: "1",
      title: "The Crossing",
      file: "chapter-1.tex",
      wordCount: 12,
    },
  ],
};

const block = (id: string, type: Block["type"]): Block => ({
  id,
  type,
  text: `${id} text`,
  raw: "",
  dirty: false,
});

const blocks: Block[] = [
  block("block-1", "narration"),
  block("note", "scratchpad"),
  block("block-2", "dialogue"),
];

const meta: ProjectMeta = {
  version: 3,
  characters: [],
  lore: [],
  statuses: {},
  outline: { premise: "", overview: "" },
  chapters: {
    "chapter-1": {
      act: null,
      plotPoint: null,
      premise: "",
      goal: "",
      conflict: "",
      turn: "",
      characterIds: [],
      cards: [],
    },
  },
};

const message: AgentUIMessage = {
  id: "message-1",
  role: "assistant",
  metadata: {
    runId: "run-1",
    mode: "writing",
    task: { kind: "conversation", targetChapterId: "chapter-1" },
    state: "complete",
    createdAt: "2026-07-30T12:00:00.000Z",
    error: null,
    errorCode: null,
    retryOf: null,
    usage: null,
  },
  parts: [{ type: "text", text: "Existing conversation" }],
};

const proposal: ManuscriptPendingProposal = {
  id: "proposal-1",
  kind: "manuscript",
  projectRoot: "/book",
  chapterId: "chapter-1",
  summary: "Existing proposal",
  changes: [],
  createdAt: "2026-07-30T12:00:00.000Z",
  originatingMessageId: "message-1",
};

function command(id: string): Command {
  const found = aiCommands.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`Command not registered: ${id}`);
  return found;
}

async function runCommand(id: string): Promise<void> {
  const run = command(id).run;
  if (run === undefined) throw new Error(`Leaf command not registered: ${id}`);
  await run({ toggleSidebar: () => undefined });
}

beforeEach(() => {
  controller.dispatchAgentIntent.mockReset().mockImplementation(async (intent) => {
    useViewStore.getState().openAiConsole();
    if (intent.kind === "focus" || intent.kind === "prefill" || intent.kind === "run") {
      useAgentConsoleStore.getState().setMode(intent.mode);
    }
  });
  useViewStore.setState({ aiOpen: false, focus: false });
  useAgentConsoleStore.setState({
    ...EMPTY_AGENT_STATE,
    mode: "writing",
    messages: [message],
    pendingProposal: proposal,
    requestedProjectRoot: "/book",
    activeProjectRoot: "/book",
    hydratedProjectRoot: "/book",
  });
  useProjectStore.setState({
    project,
    meta,
    activeChapterId: "chapter-1",
    blocks,
    selectedId: "block-1",
    selectedIds: ["block-2", "block-1"],
    editing: false,
  });
});

describe("AI command catalog", () => {
  it("registers the exact seven unique commands and titles", () => {
    expect(aiCommands.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: "ai.open", title: "Open AI Console" },
      { id: "ai.mode-writing", title: "Use Writing Mode" },
      { id: "ai.mode-edit", title: "Use Edit Mode" },
      { id: "ai.suggest", title: "Suggest From Context" },
      { id: "ai.pick-up", title: "Pick Up From Here" },
      { id: "ai.critique", title: "Critique Chapter" },
      { id: "ai.continuity", title: "Check Continuity" },
    ]);
    const ids = aiCommands.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains no screen terminology", () => {
    for (const entry of aiCommands) {
      expect(entry.title).not.toMatch(/tab/i);
    }
  });

  it("opens the existing console without dispatching or clearing state", async () => {
    const messages = useAgentConsoleStore.getState().messages;
    const pendingProposal = useAgentConsoleStore.getState().pendingProposal;

    await runCommand("ai.open");

    expect(useViewStore.getState().aiOpen).toBe(true);
    expect(controller.dispatchAgentIntent).not.toHaveBeenCalled();
    expect(useAgentConsoleStore.getState().messages).toBe(messages);
    expect(useAgentConsoleStore.getState().pendingProposal).toBe(pendingProposal);
  });

  it.each([
    ["ai.mode-writing", "writing"],
    ["ai.mode-edit", "edit"],
  ] as const)("%s focuses %s without clearing the conversation", async (id, mode) => {
    const messages = useAgentConsoleStore.getState().messages;
    const pendingProposal = useAgentConsoleStore.getState().pendingProposal;

    await runCommand(id);

    expect(controller.dispatchAgentIntent).toHaveBeenCalledWith({
      kind: "focus",
      mode,
    });
    expect(useAgentConsoleStore.getState().mode).toBe(mode);
    expect(useAgentConsoleStore.getState().messages).toBe(messages);
    expect(useAgentConsoleStore.getState().pendingProposal).toBe(pendingProposal);
  });

  it.each(["narration", "dialogue"] as const)(
    "enables Pick Up for selected %s prose",
    (type) => {
      useProjectStore.setState({
        blocks: [block("selected", type)],
        selectedId: "selected",
        selectedIds: [],
      });
      expect(command("ai.pick-up").enabled?.()).toBe(true);
    },
  );

  it.each(["lore", "scratchpad", "latex", "chapter"] as const)(
    "disables Pick Up for selected %s content",
    (type) => {
      useProjectStore.setState({
        blocks: [block("selected", type)],
        selectedId: "selected",
        selectedIds: [],
      });
      expect(command("ai.pick-up").enabled?.()).toBe(false);
    },
  );

  it("disables Pick Up when there is no selected source", () => {
    useProjectStore.setState({ selectedId: null, selectedIds: [] });
    expect(command("ai.pick-up").enabled?.()).toBe(false);
  });

  it.each(["ai.critique", "ai.continuity"])(
    "%s requires an active chapter",
    (id) => {
      expect(command(id).enabled?.()).toBe(true);
      useProjectStore.setState({ activeChapterId: null });
      expect(command(id).enabled?.()).toBe(false);
    },
  );
});

describe("AI run commands", () => {
  it.each([
    {
      id: "ai.suggest",
      intent: {
        kind: "run",
        mode: "writing",
        text: "Suggest what should come next from the selected context.",
        refs: [
          {
            kind: "block",
            chapterId: "chapter-1",
            blockId: "block-2",
          },
          {
            kind: "block",
            chapterId: "chapter-1",
            blockId: "block-1",
          },
        ],
        task: { kind: "conversation", targetChapterId: "chapter-1" },
      },
    },
    {
      id: "ai.pick-up",
      intent: {
        kind: "run",
        mode: "writing",
        text: PICK_UP_DIRECTIVE,
        refs: [
          {
            kind: "block",
            chapterId: "chapter-1",
            blockId: "block-1",
          },
        ],
        task: {
          kind: "bridge",
          chapterId: "chapter-1",
          anchorBlockId: "block-1",
          successorBlockId: "block-2",
        },
      },
    },
    {
      id: "ai.critique",
      intent: {
        kind: "run",
        mode: "edit",
        text: "Critique this chapter with concrete, block-linked craft notes.",
        refs: [
          {
            kind: "block",
            chapterId: "chapter-1",
            blockId: "block-2",
          },
          {
            kind: "block",
            chapterId: "chapter-1",
            blockId: "block-1",
          },
        ],
        task: {
          kind: "chapter-analysis",
          chapterId: "chapter-1",
          analysis: "critique",
        },
      },
    },
    {
      id: "ai.continuity",
      intent: {
        kind: "run",
        mode: "edit",
        text: "Check this chapter for continuity issues with concrete, block-linked findings.",
        refs: [
          {
            kind: "block",
            chapterId: "chapter-1",
            blockId: "block-2",
          },
          {
            kind: "block",
            chapterId: "chapter-1",
            blockId: "block-1",
          },
        ],
        task: {
          kind: "chapter-analysis",
          chapterId: "chapter-1",
          analysis: "continuity",
        },
      },
    },
  ] satisfies Array<{ id: string; intent: AgentIntent }>)(
    "$id snapshots the active chapter and live selected references",
    async ({ id, intent }) => {
      await runCommand(id);
      useProjectStore.setState({
        activeChapterId: null,
        selectedId: null,
        selectedIds: [],
      });

      expect(controller.dispatchAgentIntent).toHaveBeenCalledWith(intent);
    },
  );

});
