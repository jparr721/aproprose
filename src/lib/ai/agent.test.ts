import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider";

vi.mock("@/lib/tauri", () => ({
  compileProject: vi.fn(),
  openProject: vi.fn(),
  pickProjectDir: vi.fn(),
  readAppData: vi.fn().mockResolvedValue(null),
  readPdf: vi.fn().mockRejectedValue(new Error("no pdf")),
  readTextFile: vi.fn(),
  writeAppData: vi.fn().mockResolvedValue(undefined),
  writeTextFile: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/ai/model", () => ({ getModel: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));
// Partial mock: critique is stubbed (its own tests cover it); sanitizeProposal
// stays real so the staging tests exercise the genuine sanitize rules.
vi.mock("@/lib/ai/operations", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/ai/operations")>();
  return { ...mod, critique: vi.fn() };
});

import { runAgent, type AgentStep } from "@/lib/ai/agent";
import { getModel } from "@/lib/ai/model";
import { critique } from "@/lib/ai/operations";
import { useProjectStore } from "@/stores/project-store";
import { useAiCacheStore } from "@/stores/ai-cache-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { Block, CritiqueNote } from "@/lib/types";

const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};

const toolCall = (toolName: string, input: unknown): LanguageModelV3GenerateResult => ({
  content: [
    { type: "tool-call", toolCallId: `call-${toolName}`, toolName, input: JSON.stringify(input) },
  ],
  finishReason: { unified: "tool-calls", raw: "tool_calls" },
  usage: USAGE,
  warnings: [],
});

const prose = (text: string): LanguageModelV3GenerateResult => ({
  content: [{ type: "text", text }],
  finishReason: { unified: "stop", raw: "stop" },
  usage: USAGE,
  warnings: [],
});

const mk = (id: string, text: string): Block => ({
  id,
  type: "narration",
  text,
  raw: "",
  dirty: false,
});

const rewrite = (blockId: string, newText: string) => ({
  kind: "rewrite" as const,
  blockId,
  afterId: null,
  type: null,
  speaker: null,
  newText,
  toIndex: null,
  reason: "sharper",
});

// Closure-based dispatch: the installed mock's array form of doGenerate is
// off by one (it pushes to doGenerateCalls before indexing), so queue results
// manually - the first call returns results[0], one result per loop step.
const useModel = (results: LanguageModelV3GenerateResult[]): MockLanguageModelV3 => {
  let i = 0;
  const model = new MockLanguageModelV3({ doGenerate: async () => results[i++] });
  vi.mocked(getModel).mockResolvedValue(model);
  return model;
};

beforeEach(() => {
  vi.mocked(getModel).mockReset();
  vi.mocked(critique).mockReset();
  useProjectStore.setState({
    activeChapterId: "ch1",
    selectedId: null,
    blocks: [mk("b1", "The rain fell."), mk("b2", "She waited.")],
  });
  useAiCacheStore.setState({ entries: {} });
  useSettingsStore.setState({ styleGuide: "", editingRules: "" });
});

describe("runAgent tool loop", () => {
  it("runs read_chapter then stage_proposal and returns the sanitized proposal", async () => {
    const model = useModel([
      toolCall("read_chapter", {}),
      toolCall("stage_proposal", {
        summary: "Tighten the opening",
        changes: [rewrite("b1", "Rain hammered the glass.")],
      }),
    ]);
    const steps: AgentStep[] = [];
    const { proposal } = await runAgent("tighten the opening", {
      signal: new AbortController().signal,
      onStep: (s) => steps.push(s),
      scope: { kind: "chapter" },
    });
    expect(proposal).toEqual({
      chapterId: "ch1",
      summary: "Tighten the opening",
      changes: [rewrite("b1", "Rain hammered the glass.")],
    });
    expect(steps.map((s) => s.label)).toEqual(["Reading the chapter", "Drafting changes"]);
    // The abort signal is plumbed into every model call.
    expect(model.doGenerateCalls[0].abortSignal).toBeDefined();
  });

  it("returns null when the model answers in prose without staging", async () => {
    useModel([prose("The chapter already delivers this; no changes needed.")]);
    const steps: AgentStep[] = [];
    const { proposal } = await runAgent("check the pacing", {
      signal: new AbortController().signal,
      onStep: (s) => steps.push(s),
      scope: { kind: "chapter" },
    });
    expect(proposal).toBeNull();
    expect(steps).toEqual([]);
  });

  it("drops staged changes whose blockId was never offered", async () => {
    useModel([
      toolCall("stage_proposal", {
        summary: "Tighten the opening",
        changes: [rewrite("b1", "New."), rewrite("ghost", "X.")],
      }),
    ]);
    const { proposal } = await runAgent("tighten", {
      signal: new AbortController().signal,
      onStep: () => {},
      scope: { kind: "chapter" },
    });
    expect(proposal?.changes.map((c) => c.blockId)).toEqual(["b1"]);
  });

  it("keeps full chapter grounding but drops unselected Muse changes", async () => {
    const model = useModel([
      toolCall("read_chapter", {}),
      toolCall("stage_proposal", {
        summary: "Local revision",
        changes: [rewrite("b1", "Allowed."), rewrite("b2", "Blocked.")],
      }),
    ]);

    const { proposal, outOfScope } = await runAgent("tighten this", {
      signal: new AbortController().signal,
      onStep: () => {},
      scope: { kind: "block", targetIds: ["b1"] },
    });

    expect(proposal?.changes.map((change) => change.blockId)).toEqual(["b1"]);
    expect(outOfScope).toBe(false);
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain("[b2] (narration): She waited.");
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain("LOCAL CHANGE TARGETS");
    expect(model.doGenerateCalls[0].prompt.find((message) => message.role === "system")?.content).toContain(
      "LOCAL CHANGE BOUNDARY",
    );
  });

  it("flags a block run whose staged changes all fell outside the selection", async () => {
    useModel([
      toolCall("stage_proposal", {
        summary: "Neighbor revision",
        changes: [rewrite("b2", "Only the neighbor changes.")],
      }),
    ]);

    const { proposal, outOfScope } = await runAgent("tighten b1", {
      signal: new AbortController().signal,
      onStep: () => {},
      scope: { kind: "block", targetIds: ["b1"] },
    });

    expect(proposal?.changes).toEqual([]);
    expect(outOfScope).toBe(true);
  });

  it("does not flag out-of-scope when the model simply had nothing to change", async () => {
    // A no-op rewrite (newText equals the current block text) is dropped by the
    // sanitizer with or without the allowlist, so this is empty, not out of scope.
    useModel([
      toolCall("stage_proposal", {
        summary: "No change",
        changes: [rewrite("b1", "The rain fell.")],
      }),
    ]);

    const { proposal, outOfScope } = await runAgent("tighten b1", {
      signal: new AbortController().signal,
      onStep: () => {},
      scope: { kind: "block", targetIds: ["b1"] },
    });

    expect(proposal?.changes).toEqual([]);
    expect(outOfScope).toBe(false);
  });

  it("fails the run when the active chapter changes between steps", async () => {
    const results = [
      toolCall("read_chapter", {}),
      toolCall("stage_proposal", {
        summary: "Tighten the opening",
        changes: [rewrite("b1", "Rain hammered the glass.")],
      }),
    ];
    let i = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        // The author switches chapters after read_chapter, just before staging.
        if (i === 1) useProjectStore.setState({ activeChapterId: "ch2" });
        return results[i++];
      },
    });
    vi.mocked(getModel).mockResolvedValue(model);
    await expect(
      runAgent("tighten", {
        signal: new AbortController().signal,
        onStep: () => {},
        scope: { kind: "chapter" },
      }),
    ).rejects.toThrow("Chapter changed during the Muse run.");
  });

  it("rejects when the signal aborts before the model answers", async () => {
    vi.mocked(getModel).mockResolvedValue(
      new MockLanguageModelV3({
        doGenerate: async (options) => {
          if (options.abortSignal?.aborted) throw new DOMException("Aborted", "AbortError");
          return prose("unreachable");
        },
      }),
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      runAgent("go", { signal: controller.signal, onStep: () => {}, scope: { kind: "chapter" } }),
    ).rejects.toThrow();
  });
});

describe("runAgent get_critique", () => {
  const notes: CritiqueNote[] = [
    { kind: "watch", tag: "Pacing", text: "The middle drags.", blockIds: ["b2"] },
  ];

  it("reads the cached critique without re-running the op", async () => {
    useAiCacheStore.setState({
      entries: { "critique:ch1:chapter:": { data: notes, loading: false, error: null } },
    });
    useModel([toolCall("get_critique", {}), prose("no changes needed")]);
    const steps: AgentStep[] = [];
    const { proposal } = await runAgent("check pacing", {
      signal: new AbortController().signal,
      onStep: (s) => steps.push(s),
      scope: { kind: "chapter" },
    });
    expect(proposal).toBeNull();
    expect(critique).not.toHaveBeenCalled();
    expect(steps.map((s) => s.label)).toEqual(["Critiquing"]);
  });

  it("runs a fresh critique with the signal and patches the Critique cache entry", async () => {
    vi.mocked(critique).mockResolvedValue(notes);
    useModel([toolCall("get_critique", {}), prose("no changes needed")]);
    const signal = new AbortController().signal;
    await runAgent("check pacing", { signal, onStep: () => {}, scope: { kind: "chapter" } });
    expect(vi.mocked(critique).mock.calls[0][1]).toEqual({ signal });
    expect(useAiCacheStore.getState().entries["critique:ch1:chapter:"]).toMatchObject({
      data: notes,
      loading: false,
      error: null,
      instruction: "check pacing",
    });
  });
});

describe("runAgent author preferences", () => {
  it("injects the author voice and editing rules into the Muse system prompt", async () => {
    useSettingsStore.setState({ styleGuide: "Gibson voice", editingRules: "No adverbs" });
    const model = useModel([prose("no changes needed")]);
    await runAgent("go", {
      signal: new AbortController().signal,
      onStep: () => {},
      scope: { kind: "chapter" },
    });
    const system = model.doGenerateCalls[0].prompt.find((m) => m.role === "system")?.content;
    expect(system).toContain("AUTHOR VOICE");
    expect(system).toContain("Gibson voice");
    expect(system).toContain("AUTHOR EDITING RULES");
    expect(system).toContain("No adverbs");
  });
});
