import { describe, expect, it, vi } from "vitest";
import {
  agentToolOutputSummary,
  createAgentToolHandlers,
  createAgentTools,
  type AgentToolEnvironment,
} from "@/lib/ai/agent-tools";
import type {
  AgentRun,
  ChapterToolValue,
  ManuscriptPendingProposal,
  OutlinePendingProposal,
} from "@/lib/ai/agent-types";

const run: AgentRun = {
  id: "run-1",
  projectRoot: "/book",
  mode: "writing",
  task: { kind: "conversation", targetChapterId: "ch1" },
  userMessageId: "user-1",
  attachments: [],
  startedAt: "2026-07-30T00:00:00.000Z",
};

const chapter: ChapterToolValue = {
  chapterId: "ch1",
  title: "One",
  blocks: [
    {
      id: "b1",
      order: 0,
      type: "narration",
      text: "Full private chapter text.",
      fingerprint: "abc",
    },
  ],
};

const pending: ManuscriptPendingProposal = {
  id: "proposal-1",
  kind: "manuscript",
  projectRoot: "/book",
  chapterId: "ch1",
  summary: "Bridge",
  createdAt: "2026-07-30T00:01:00.000Z",
  originatingMessageId: "assistant-1",
  changes: [
    {
      id: "change-1",
      change: {
        kind: "remove",
        blockId: "dialogue-1",
        afterId: null,
        type: null,
        speaker: null,
        newText: null,
        toIndex: null,
        reason: "Remove the repeated line",
      },
      precondition: {
        kind: "target",
        target: {
          sourceId: "dialogue-1",
          order: 0,
          fingerprint: "dialogue-fingerprint",
          sourceType: "dialogue",
          label: "dialogue block",
          exactText: "The bell rang hard.",
          previewText: "The bell rang hard.\nShe gripped the rope.",
        },
      },
    },
  ],
};

const pendingOutline: OutlinePendingProposal = {
  id: "outline-proposal-1",
  kind: "outline",
  projectRoot: "/book",
  chapterId: "ch1",
  summary: "Add a turn",
  createdAt: "2026-07-30T00:01:00.000Z",
  originatingMessageId: "assistant-1",
  changes: [
    {
      id: "outline-change-1",
      change: {
        kind: "add",
        cardId: null,
        title: "The turn",
        intention: "Force the choice",
        toIndex: null,
        reason: "Complete the arc",
      },
      precondition: {
        kind: "outline-order",
        orderFingerprint: "outline-order",
      },
    },
  ],
};

function environment(): AgentToolEnvironment {
  return {
    run,
    signal: new AbortController().signal,
    readChapter: vi.fn().mockResolvedValue(chapter),
    readOutline: vi.fn().mockResolvedValue({ premise: "", chapters: [] }),
    readLore: vi.fn().mockResolvedValue({ entries: [] }),
    runCritique: vi.fn().mockResolvedValue([]),
    runContinuity: vi.fn().mockResolvedValue([]),
    readConversationContext: vi.fn().mockReturnValue({ messages: [] }),
    getPendingProposal: vi.fn().mockReturnValue(null),
    buildManuscriptProposal: vi.fn().mockReturnValue(pending),
    buildOutlineProposal: vi.fn().mockReturnValue(pendingOutline),
    replacePendingProposal: vi.fn(),
  };
}

describe("createAgentTools", () => {
  it("exposes exactly the approved shared tool set", () => {
    expect(Object.keys(createAgentTools(environment())).sort()).toEqual([
      "read_chapter",
      "read_conversation_context",
      "read_lore",
      "read_outline",
      "read_pending_proposal",
      "run_continuity",
      "run_critique",
      "stage_manuscript_proposal",
      "stage_outline_proposal",
    ]);
  });
});

describe("agent tool outputs", () => {
  it("returns full chapter content to the runtime and a safe UI summary", async () => {
    const handlers = createAgentToolHandlers(environment());
    const output = await handlers.readChapter({ chapterId: "ch1" });
    expect(output.kind).toBe("runtime");
    expect(JSON.stringify(output)).toContain("Full private chapter text.");
    expect(agentToolOutputSummary(output)).toEqual({
      label: "Read chapter",
      target: "One",
      detail: "1 block",
      itemCount: 1,
    });
    expect(JSON.stringify(agentToolOutputSummary(output))).not.toContain(
      "Full private chapter text.",
    );
  });
});

describe("stage tools", () => {
  it("replaces the pending workspace only after a proposal validates", async () => {
    const env = environment();
    const handlers = createAgentToolHandlers(env);
    await handlers.stageManuscript({
      summary: "Bridge",
      changes: [],
    });
    expect(env.buildManuscriptProposal).toHaveBeenCalledOnce();
    expect(env.replacePendingProposal).toHaveBeenCalledWith(pending);
  });

  it("keeps the old workspace when proposal construction fails", async () => {
    const env = environment();
    vi.mocked(env.buildManuscriptProposal).mockImplementation(() => {
      throw new Error("task boundary failed");
    });
    const handlers = createAgentToolHandlers(env);
    await expect(
      handlers.stageManuscript({ summary: "Bad", changes: [] }),
    ).rejects.toThrow("task boundary failed");
    expect(env.replacePendingProposal).not.toHaveBeenCalled();
  });

  it("rejects a mismatched change and precondition before staging", async () => {
    const env = environment();
    vi.mocked(env.buildManuscriptProposal).mockReturnValue({
      ...pending,
      changes: [
        {
          ...pending.changes[0],
          change: {
            ...pending.changes[0].change,
            kind: "rewrite",
            newText: "Rewritten prose.",
          },
          precondition: {
            kind: "insert",
            boundary: "immediate",
            anchor: null,
            expectedNext: null,
          },
        },
      ],
    });
    const handlers = createAgentToolHandlers(env);

    await expect(
      handlers.stageManuscript({ summary: "Malformed", changes: [] }),
    ).rejects.toThrow(/change and precondition/);
    expect(env.replacePendingProposal).not.toHaveBeenCalled();
  });

  it("rejects a mismatched outline pair before staging", async () => {
    const env = environment();
    vi.mocked(env.buildOutlineProposal).mockReturnValue({
      ...pendingOutline,
      changes: [
        {
          ...pendingOutline.changes[0],
          precondition: {
            kind: "card",
            target: {
              sourceId: "card-1",
              order: 0,
              fingerprint: "card-fingerprint",
              sourceType: "outline-card",
              label: "Arrival",
              exactText: "Arrival\nSet the stakes",
              previewText: "Arrival\nSet the stakes",
            },
          },
        },
      ],
    });
    const handlers = createAgentToolHandlers(env);

    await expect(
      handlers.stageOutline({ summary: "Malformed", changes: [] }),
    ).rejects.toThrow(/change and precondition/);
    expect(env.replacePendingProposal).not.toHaveBeenCalled();
  });

  it("reads only the exact pending proposal requested by a follow-up", async () => {
    const env = environment();
    vi.mocked(env.getPendingProposal).mockReturnValue(pending);
    const handlers = createAgentToolHandlers(env);
    await expect(
      handlers.readPendingProposal({ proposalId: "wrong" }),
    ).rejects.toThrow("Pending proposal not found: wrong");
  });

  it("returns both mutable and frozen preview locator text to follow-up tools", async () => {
    const env = environment();
    vi.mocked(env.getPendingProposal).mockReturnValue(pending);
    const handlers = createAgentToolHandlers(env);
    const output = await handlers.readPendingProposal({
      proposalId: pending.id,
    });

    expect(output.value.changes[0].precondition).toMatchObject({
      target: {
        exactText: "The bell rang hard.",
        previewText: "The bell rang hard.\nShe gripped the rope.",
      },
    });
  });
});
