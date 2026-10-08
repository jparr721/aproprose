import { describe, expect, it, vi } from "vitest";
import { Book } from "@/book";
import { EMPTY_META } from "@/lib/migration";
import { compileAgentPolicy } from "@/lib/ai/agent-prompts";
import {
  activeAgentTools,
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
import { emptyCharacterProfile } from "@/lib/story-knowledge/model";
import type { Character } from "@/lib/types";

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
      citationText: "Full private chapter text.",
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
    policy: compileAgentPolicy({ mode: run.mode, task: run.task, sessionId: { kind: "project" }, styleGuide: "", editingRules: "" }),
    assertRunOwnership: vi.fn(),
    book: new Book({
      project: {
        root: "/book", name: "A book", mainFile: "main.tex", title: "A book", author: "Author",
        metadata: { title: "A book", subtitle: "", author: "Author", publisher: "", isbn: "" },
        chapters: [{ id: "ch1", title: "One", label: "1", file: "one.tex", wordCount: 4 }],
      },
      meta: structuredClone(EMPTY_META),
      chapter: {
        chapterId: "ch1", title: "One",
        blocks: [{ id: "b1", type: "narration", text: "Full private chapter text.", raw: "Full private chapter text.\n\n", dirty: false }],
      },
      loadChapter: vi.fn(),
    }),
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
    buildOverviewProposal: vi.fn(),
    replacePendingProposal: vi.fn(),
    updateCharacterProfile: vi.fn().mockResolvedValue({
      id: "c1",
      name: "Mara",
      color: "#123456",
      role: "Courier",
      profile: emptyCharacterProfile(),
    } satisfies Character),
  };
}

describe("createAgentTools", () => {
  it("exposes exactly the approved shared tool set", () => {
    expect(Object.keys(createAgentTools(environment())).sort()).toEqual([
      "ask_author",
      "read_book_manifest",
      "read_book_metadata",
      "read_chapter",
      "read_chapter_range",
      "read_character",
      "read_conversation_context",
      "read_lore",
      "read_outline",
      "read_pending_proposal",
      "read_story_knowledge",
      "run_continuity",
      "run_critique",
      "search_book",
      "stage_manuscript_proposal",
      "stage_outline_proposal",
      "stage_overview_proposal",
      "update_character_profile",
    ]);
  });
});

describe("character profile tool", () => {
  const characterRun: AgentRun = {
    ...run,
    task: { kind: "character-describe", characterId: "c1" },
  };

  function characterEnvironment(): AgentToolEnvironment {
    return {
      ...environment(), run: characterRun,
      policy: compileAgentPolicy({ mode: characterRun.mode, task: characterRun.task, sessionId: { kind: "character", characterId: "c1" }, styleGuide: "", editingRules: "" }),
    };
  }

  it("updates only the character frozen into the environment", async () => {
    const env = characterEnvironment();
    const handlers = createAgentToolHandlers(env);

    const output = await handlers.updateCharacterProfile({
      characterId: "c1",
      profile: {
        appearance: null,
        mannerisms: "Counts every door.",
        motivations: null,
        relationships: null,
        history: null,
        voice: null,
      },
    });

    expect(env.updateCharacterProfile).toHaveBeenCalledWith({
      characterId: "c1",
      profile: { mannerisms: "Counts every door." },
    });
    expect(agentToolOutputSummary(output)).toEqual({
      label: "Update character profile",
      target: "Mara",
      detail: "1 field",
      itemCount: 1,
    });
  });

  it("rejects a character outside the frozen task", async () => {
    const env = characterEnvironment();
    const handlers = createAgentToolHandlers(env);

    await expect(
      handlers.updateCharacterProfile({
        characterId: "c2",
        profile: {
          appearance: "Silver coat.",
          mannerisms: null,
          motivations: null,
          relationships: null,
          history: null,
          voice: null,
        },
      }),
    ).rejects.toThrow("Character update is outside the frozen target: c2");
    expect(env.updateCharacterProfile).not.toHaveBeenCalled();
  });

  it("rejects a profile patch with no changed fields", async () => {
    const env = characterEnvironment();
    const handlers = createAgentToolHandlers(env);

    await expect(
      handlers.updateCharacterProfile({
        characterId: "c1",
        profile: {
          appearance: null,
          mannerisms: null,
          motivations: null,
          relationships: null,
          history: null,
          voice: null,
        },
      }),
    ).rejects.toThrow("Character profile update requires at least one field");
    expect(env.updateCharacterProfile).not.toHaveBeenCalled();
  });

  it("rejects a profile patch whose strings are all blank", async () => {
    const env = characterEnvironment();
    const handlers = createAgentToolHandlers(env);

    await expect(
      handlers.updateCharacterProfile({
        characterId: "c1",
        profile: {
          appearance: " ",
          mannerisms: "\t",
          motivations: "\n",
          relationships: "  ",
          history: "\t ",
          voice: " ",
        },
      }),
    ).rejects.toThrow("Character profile update requires at least one field");
    expect(env.updateCharacterProfile).not.toHaveBeenCalled();
  });

  it("drops blank fields from a mixed patch and preserves existing prose", async () => {
    const env = characterEnvironment();
    let liveProfile = {
      ...emptyCharacterProfile(),
      appearance: "Silver braid.",
      voice: "Precise and spare.",
    };
    vi.mocked(env.updateCharacterProfile).mockImplementation(
      async ({ characterId, profile }) => {
        liveProfile = { ...liveProfile, ...profile };
        return {
          id: characterId,
          name: "Mara",
          color: "#123456",
          role: "Courier",
          profile: liveProfile,
        };
      },
    );
    const handlers = createAgentToolHandlers(env);

    await handlers.updateCharacterProfile({
      characterId: "c1",
      profile: {
        appearance: "   ",
        mannerisms: "  Counts every door.  ",
        motivations: null,
        relationships: null,
        history: null,
        voice: "",
      },
    });

    expect(env.updateCharacterProfile).toHaveBeenCalledWith({
      characterId: "c1",
      profile: { mannerisms: "Counts every door." },
    });
    expect(liveProfile).toMatchObject({
      appearance: "Silver braid.",
      mannerisms: "Counts every door.",
      voice: "Precise and spare.",
    });
  });

  it("propagates profile persistence failures", async () => {
    const env = characterEnvironment();
    vi.mocked(env.updateCharacterProfile).mockRejectedValue(
      new Error("profile persistence failed"),
    );
    const handlers = createAgentToolHandlers(env);

    await expect(
      handlers.updateCharacterProfile({
        characterId: "c1",
        profile: {
          appearance: null,
          mannerisms: "Counts every door.",
          motivations: null,
          relationships: null,
          history: null,
          voice: null,
        },
      }),
    ).rejects.toThrow("profile persistence failed");
  });
});

describe("purpose-bound book tool catalog", () => {
  it("persists a visible author question without manufacturing an answer", async () => {
    const env = environment();
    const handlers = createAgentToolHandlers(env);
    const question = { question: "Should the memory remain unreliable?", rationale: "The answer determines whether the contradiction needs explanation.", options: ["Preserve uncertainty", "Clarify the memory"] };
    const output = await handlers.askAuthor(question);
    expect(output.value).toEqual(question);
    expect(output.summary.target).toBe(question.question);
    expect(output.value).not.toHaveProperty("answer");
    await expect(handlers.askAuthor({ ...question, question: " " })).rejects.toThrow();
    await expect(handlers.askAuthor({ ...question, options: Array(7).fill("An option") })).rejects.toThrow();
  });
  it("discovers existing book material without loading manuscript chapters", async () => {
    const env = environment();
    const handlers = createAgentToolHandlers(env);
    const manifest = await handlers.readBookManifest({});
    expect(manifest.value.chapters[0]).toMatchObject({ id: "ch1", title: "One" });
    expect((await handlers.readBookMetadata({})).value.author).toBe("Author");
    expect(env.assertRunOwnership).toHaveBeenCalled();
  });

  it("returns a bounded complete semantic range and reports exact coverage", async () => {
    const env = environment();
    const handlers = createAgentToolHandlers(env);
    const output = await handlers.readChapterRange({ chapterId: "ch1", start: 0, limit: 1 });
    expect(output.value).toMatchObject({ chapterId: "ch1", totalBlocks: 1, start: 0, endExclusive: 1, hasMore: false });
    expect(output.value.blocks[0].citationText).toBe("Full private chapter text.");
    expect(output.value.source.target).toMatchObject({ kind: "chapter", id: "ch1" });
    await expect(handlers.readChapterRange({ chapterId: "ch1", start: 0, limit: 101 })).rejects.toThrow();
    await expect(handlers.readChapterRange({ chapterId: "ch1", start: 2, limit: 1 })).rejects.toThrow("Chapter range starts outside the chapter");
  });

  it("searches the bound Book instance and reports inspected coverage", async () => {
    const handlers = createAgentToolHandlers(environment());
    const output = await handlers.searchBook({ query: "private", chapterIds: null, limit: 5 });
    expect(output.value.inspectedChapterIds).toEqual(["ch1"]);
    expect(output.value.matches[0]).toMatchObject({ blockId: "b1", text: "Full private chapter text." });
    expect(agentToolOutputSummary(output).detail).toBe("1 match");
  });

  it("filters capabilities for inference and rejects unauthorized host calls before mutation", async () => {
    const env = environment();
    env.policy = compileAgentPolicy({ mode: "edit", task: { kind: "chapter-analysis", chapterId: "ch1", analysis: "critique" }, sessionId: { kind: "project" }, styleGuide: "", editingRules: "" });
    const handlers = createAgentToolHandlers(env);
    await expect(handlers.askAuthor({ question: "Can I edit it?", rationale: "Unauthorized ask", options: [] })).rejects.toThrow("Agent tool is not permitted");
    await expect(handlers.stageManuscript({ summary: "Unauthorized edit", changes: [] })).rejects.toThrow("Agent tool is not permitted");
    await expect(handlers.stageOutline({ summary: "Unauthorized cards", changes: [] })).rejects.toThrow("Agent tool is not permitted");
    expect(env.buildManuscriptProposal).not.toHaveBeenCalled();
    expect(env.buildOutlineProposal).not.toHaveBeenCalled();
    expect(env.replacePendingProposal).not.toHaveBeenCalled();
    expect(activeAgentTools(env.policy.capabilities)).toContain("search_book");
    expect(activeAgentTools(env.policy.capabilities)).not.toContain("stage_manuscript_proposal");
  });

  it("checks cancellation and revoked ownership even for cached Book reads", async () => {
    const env = environment();
    const controller = new AbortController();
    controller.abort(new Error("Run cancelled"));
    env.signal = controller.signal;
    await expect(createAgentToolHandlers(env).readBookManifest({})).rejects.toThrow("Run cancelled");
    const revoked = environment();
    vi.mocked(revoked.assertRunOwnership).mockImplementation(() => { throw new Error("Run ownership revoked"); });
    await expect(createAgentToolHandlers(revoked).readBookMetadata({})).rejects.toThrow("Run ownership revoked");
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
