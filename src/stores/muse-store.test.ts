import { describe, it, expect, beforeEach } from "vitest";
import { useMuseStore } from "@/stores/muse-store";

const step = { tool: "read_chapter", label: "Reading the chapter" };

beforeEach(() => useMuseStore.getState().reset());

describe("muse-store lifecycle", () => {
  it("starts idle with no directive, steps, error, or staged flag", () => {
    const s = useMuseStore.getState();
    expect(s.status).toBe("idle");
    expect(s.directive).toBe("");
    expect(s.steps).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.staged).toBe(false);
  });

  it("start sets running + directive and clears steps/error/staged from a previous run", () => {
    useMuseStore.getState().start("old run");
    useMuseStore.getState().addStep(step);
    useMuseStore.getState().fail("boom");
    useMuseStore.getState().start("raise the stakes");
    const s = useMuseStore.getState();
    expect(s.status).toBe("running");
    expect(s.directive).toBe("raise the stakes");
    expect(s.steps).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.staged).toBe(false);
  });

  it("addStep appends in order", () => {
    useMuseStore.getState().start("go");
    useMuseStore.getState().addStep(step);
    useMuseStore.getState().addStep({ tool: "stage_proposal", label: "Drafting changes" });
    expect(useMuseStore.getState().steps.map((s) => s.label)).toEqual([
      "Reading the chapter",
      "Drafting changes",
    ]);
  });

  it("finishStaged marks done with the staged flag set", () => {
    useMuseStore.getState().start("go");
    useMuseStore.getState().finishStaged();
    expect(useMuseStore.getState().status).toBe("done");
    expect(useMuseStore.getState().staged).toBe(true);
  });

  it("finishEmpty marks done without staging", () => {
    useMuseStore.getState().start("go");
    useMuseStore.getState().finishEmpty();
    expect(useMuseStore.getState().status).toBe("done");
    expect(useMuseStore.getState().staged).toBe(false);
  });

  it("fail records the error and keeps the directive for retry", () => {
    useMuseStore.getState().start("go");
    useMuseStore.getState().fail("HTTP 500");
    const s = useMuseStore.getState();
    expect(s.status).toBe("failed");
    expect(s.error).toBe("HTTP 500");
    expect(s.directive).toBe("go");
  });

  it("reset returns to the fresh idle state", () => {
    useMuseStore.getState().start("go");
    useMuseStore.getState().addStep(step);
    useMuseStore.getState().finishStaged();
    useMuseStore.getState().reset();
    expect(useMuseStore.getState()).toMatchObject({
      status: "idle",
      directive: "",
      steps: [],
      error: null,
      staged: false,
    });
  });
});
