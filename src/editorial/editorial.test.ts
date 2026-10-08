import { describe, expect, it, vi } from "vitest";
import { Editorial, type EditorialDependencies } from "@/editorial";
import { EMPTY_AGENT_STATE, type AgentConsoleData } from "@/stores/agent-console-store";

function fixture(): { editorial: Editorial; dependencies: EditorialDependencies; state: AgentConsoleData } {
  const state: AgentConsoleData = structuredClone(EMPTY_AGENT_STATE);
  const dependencies: EditorialDependencies = {
    hydrate: vi.fn(async () => {}),
    read: () => state,
    ownsProject: () => true,
    isReady: () => true,
    start: vi.fn(async () => {
      state.runStatus = "submitted";
      return { status: "success" };
    }),
  };
  return { editorial: new Editorial(dependencies), dependencies, state };
}

describe("Editorial chapter investigation", () => {
  it("hydrates before starting once and preserves composer text", async () => {
    const { editorial, dependencies, state } = fixture();
    state.draftText = "My unfinished answer";
    const input = { projectRoot: "/book", chapterId: "one", signal: new AbortController().signal };
    await Promise.all([editorial.investigateChapter(input), editorial.investigateChapter(input)]);
    expect(dependencies.start).toHaveBeenCalledOnce();
    expect(state.draftText).toBe("My unfinished answer");
  });

  it("does not start after cancelled hydration or a project switch", async () => {
    const { editorial, dependencies } = fixture();
    const controller = new AbortController();
    dependencies.hydrate = async () => { controller.abort(); };
    expect(await editorial.investigateChapter({ projectRoot: "/book", chapterId: "one", signal: controller.signal })).toEqual({ kind: "cancelled" });
    dependencies.ownsProject = () => false;
    expect(await editorial.investigateChapter({ projectRoot: "/book", chapterId: "one", signal: new AbortController().signal })).toEqual({ kind: "cancelled" });
    expect(dependencies.start).not.toHaveBeenCalled();
  });

  it("preserves a reopened conversation and waits for persistence recovery", async () => {
    const { editorial, dependencies, state } = fixture();
    const input = { projectRoot: "/book", chapterId: "one", signal: new AbortController().signal };
    state.summary = { text: "Unanswered author question", throughMessageId: "q1" };
    expect(await editorial.investigateChapter(input)).toEqual({ kind: "resumed" });
    state.summary = null;
    dependencies.isReady = () => false;
    expect(await editorial.investigateChapter(input)).toEqual({ kind: "unavailable" });
    expect(dependencies.start).not.toHaveBeenCalled();
  });
});
