import { describe, it, expect, beforeEach } from "vitest";
import { useMuseStore } from "@/stores/muse-store";

const step = { tool: "read_chapter", label: "Reading the chapter" };
const chapterRun = { chapterId: "ch1", kind: "chapter" as const };

beforeEach(() => useMuseStore.getState().reset());

describe("muse-store lifecycle", () => {
  it("starts idle with no run, directive, steps, error, or staged/out-of-scope flags", () => {
    const s = useMuseStore.getState();
    expect(s.status).toBe("idle");
    expect(s.run).toBeNull();
    expect(s.directive).toBe("");
    expect(s.steps).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.staged).toBe(false);
    expect(s.outOfScope).toBe(false);
  });

  it("start sets running + directive and clears steps/error/staged from a previous run", () => {
    useMuseStore.getState().start("old run", chapterRun);
    useMuseStore.getState().addStep(step);
    useMuseStore.getState().fail("boom");
    useMuseStore.getState().start("raise the stakes", chapterRun);
    const s = useMuseStore.getState();
    expect(s.status).toBe("running");
    expect(s.run).toEqual({ chapterId: "ch1", kind: "chapter" });
    expect(s.directive).toBe("raise the stakes");
    expect(s.steps).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.staged).toBe(false);
    expect(s.outOfScope).toBe(false);
  });

  it("addStep appends in order", () => {
    useMuseStore.getState().start("go", chapterRun);
    useMuseStore.getState().addStep(step);
    useMuseStore.getState().addStep({ tool: "stage_proposal", label: "Drafting changes" });
    expect(useMuseStore.getState().steps.map((s) => s.label)).toEqual([
      "Reading the chapter",
      "Drafting changes",
    ]);
  });

  it("finishStaged marks done with the staged flag set", () => {
    useMuseStore.getState().start("go", chapterRun);
    useMuseStore.getState().finishStaged();
    expect(useMuseStore.getState().status).toBe("done");
    expect(useMuseStore.getState().staged).toBe(true);
    expect(useMuseStore.getState().outOfScope).toBe(false);
  });

  it("finishEmpty marks done without staging", () => {
    useMuseStore.getState().start("go", chapterRun);
    useMuseStore.getState().finishEmpty();
    expect(useMuseStore.getState().status).toBe("done");
    expect(useMuseStore.getState().staged).toBe(false);
    expect(useMuseStore.getState().outOfScope).toBe(false);
  });

  it("finishOutOfScope marks done, unstaged, with the out-of-scope flag set", () => {
    useMuseStore.getState().start("go", chapterRun);
    useMuseStore.getState().finishOutOfScope();
    expect(useMuseStore.getState().status).toBe("done");
    expect(useMuseStore.getState().staged).toBe(false);
    expect(useMuseStore.getState().outOfScope).toBe(true);
  });

  it("fail records the error and keeps the directive for retry", () => {
    useMuseStore.getState().start("go", chapterRun);
    useMuseStore.getState().fail("HTTP 500");
    const s = useMuseStore.getState();
    expect(s.status).toBe("failed");
    expect(s.error).toBe("HTTP 500");
    expect(s.directive).toBe("go");
  });

  it("reset returns to the fresh idle state", () => {
    useMuseStore.getState().start("go", chapterRun);
    useMuseStore.getState().addStep(step);
    useMuseStore.getState().finishStaged();
    useMuseStore.getState().reset();
    expect(useMuseStore.getState()).toMatchObject({
      status: "idle",
      run: null,
      directive: "",
      steps: [],
      error: null,
      staged: false,
      outOfScope: false,
    });
  });

  it("freezes a selected-block run against later target mutation", () => {
    const targetIds: [string, ...string[]] = ["b1", "b2"];
    useMuseStore.getState().start("tighten", { chapterId: "ch1", kind: "block", targetIds });
    targetIds.push("b3");

    expect(useMuseStore.getState().run).toEqual({
      chapterId: "ch1",
      kind: "block",
      targetIds: ["b1", "b2"],
    });
  });
});
