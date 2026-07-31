import { beforeEach, describe, expect, it } from "vitest";
import type { GuidedOutlinePlan } from "@/lib/types";
import { useOutlineGuideStore } from "@/stores/outline-guide-store";

const plan: GuidedOutlinePlan = {
  chapterId: "ch1",
  summary: "Mara takes Oren's place.",
  act: "setup",
  plotPoint: "inciting",
  premise: "A summons corners Mara.",
  goal: "Keep Oren home.",
  conflict: "The queen names him directly.",
  turn: "Mara answers in his place.",
  characterIds: ["mara", "oren"],
  beats: [],
};

beforeEach(() => {
  useOutlineGuideStore.getState().reset();
});

describe("outline-guide-store", () => {
  it("starts a turn without discarding the current plan preview", () => {
    useOutlineGuideStore.getState().hydrate({
      ch1: {
        messages: [{ role: "assistant", content: "What does Mara risk?" }],
        plan,
      },
    });

    useOutlineGuideStore.getState().startTurn("ch1", [
      { role: "assistant", content: "What does Mara risk?" },
      { role: "user", content: "Her freedom." },
    ]);

    expect(useOutlineGuideStore.getState().sessions.ch1).toEqual({
      messages: [
        { role: "assistant", content: "What does Mara risk?" },
        { role: "user", content: "Her freedom." },
      ],
      plan,
    });
    expect(useOutlineGuideStore.getState().running.ch1).toBe(true);
    expect(useOutlineGuideStore.getState().errors.ch1).toBeUndefined();
  });

  it("finishes a turn with the assistant reply and revised preview", () => {
    const turnId = useOutlineGuideStore.getState().startTurn("ch1", [
      { role: "user", content: "Her freedom." },
    ]);

    useOutlineGuideStore.getState().finishTurn("ch1", turnId, {
      messages: [
        { role: "user", content: "Her freedom." },
        { role: "assistant", content: "That gives the choice a cost." },
      ],
      plan,
    });

    expect(useOutlineGuideStore.getState().sessions.ch1.plan).toEqual(plan);
    expect(useOutlineGuideStore.getState().running.ch1).toBeUndefined();
    expect(useOutlineGuideStore.getState().errors.ch1).toBeUndefined();
  });

  it("keeps the committed user turn and exposes an error when generation fails", () => {
    const turnId = useOutlineGuideStore.getState().startTurn("ch1", [
      { role: "user", content: "Her freedom." },
    ]);

    useOutlineGuideStore.getState().failTurn("ch1", turnId, "Model unavailable");

    expect(useOutlineGuideStore.getState().sessions.ch1.messages).toEqual([
      { role: "user", content: "Her freedom." },
    ]);
    expect(useOutlineGuideStore.getState().running.ch1).toBeUndefined();
    expect(useOutlineGuideStore.getState().errors.ch1).toBe("Model unavailable");
  });
});
