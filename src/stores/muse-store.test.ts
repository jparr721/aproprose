import { describe, it, expect, beforeEach } from "vitest";
import { useMuseStore } from "@/stores/muse-store";

const step = { tool: "read_chapter", label: "Reading the chapter" };
const chapterRun = { chapterId: "ch1", scope: "chapter" as const, targetIds: [] };

beforeEach(() => useMuseStore.getState().reset());

describe("muse-store lifecycle", () => {
  it("starts idle with no run metadata, directive, steps, error, or staged flag", () => {
    const s = useMuseStore.getState();
    expect(s.status).toBe("idle");
    expect(s.chapterId).toBeNull();
    expect(s.scope).toBe("chapter");
    expect(s.targetIds).toEqual([]);
    expect(s.directive).toBe("");
    expect(s.steps).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.staged).toBe(false);
  });

  it("start sets running + directive and clears steps/error/staged from a previous run", () => {
    useMuseStore.getState().start("old run", chapterRun);
    useMuseStore.getState().addStep(step);
    useMuseStore.getState().fail("boom");
    useMuseStore.getState().start("raise the stakes", chapterRun);
    const s = useMuseStore.getState();
    expect(s.status).toBe("running");
    expect(s.chapterId).toBe("ch1");
    expect(s.scope).toBe("chapter");
    expect(s.targetIds).toEqual([]);
    expect(s.directive).toBe("raise the stakes");
    expect(s.steps).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.staged).toBe(false);
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
  });

  it("finishEmpty marks done without staging", () => {
    useMuseStore.getState().start("go", chapterRun);
    useMuseStore.getState().finishEmpty();
    expect(useMuseStore.getState().status).toBe("done");
    expect(useMuseStore.getState().staged).toBe(false);
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
      chapterId: null,
      scope: "chapter",
      targetIds: [],
      directive: "",
      steps: [],
      error: null,
      staged: false,
    });
  });

  it("stores a frozen selected-block run", () => {
    const targetIds = ["b1", "b2"];
    useMuseStore.getState().start("tighten", {
      chapterId: "ch1",
      scope: "block",
      targetIds,
    });
    targetIds.push("b3");

    expect(useMuseStore.getState()).toMatchObject({
      chapterId: "ch1",
      scope: "block",
      targetIds: ["b1", "b2"],
    });
  });
});
