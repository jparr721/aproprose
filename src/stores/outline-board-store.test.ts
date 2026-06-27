import { describe, it, expect, beforeEach } from "vitest";
import { useOutlineBoardStore } from "@/stores/outline-board-store";
import type { SculptProposal } from "@/lib/types";

beforeEach(() => {
  useOutlineBoardStore.setState({ selectedBeatId: null });
});

describe("outline-board-store", () => {
  it("selectBeat sets and clears the selected beat", () => {
    useOutlineBoardStore.getState().selectBeat("b1");
    expect(useOutlineBoardStore.getState().selectedBeatId).toBe("b1");
    useOutlineBoardStore.getState().selectBeat(null);
    expect(useOutlineBoardStore.getState().selectedBeatId).toBeNull();
  });
});

const proposal: SculptProposal = {
  actKind: "setup",
  summary: "s",
  changes: [
    { kind: "add", beatId: null, title: "T", intention: "i", type: "action", toIndex: null, reason: "r" },
  ],
};

describe("outline-board-store sculpt fields", () => {
  beforeEach(() => {
    useOutlineBoardStore.getState().rejectAll();
    useOutlineBoardStore.getState().setSculptError(null);
  });

  it("startSculpt sets the act and clears any prior proposal/error", () => {
    useOutlineBoardStore.getState().setProposal(proposal);
    useOutlineBoardStore.getState().setSculptError("boom");
    useOutlineBoardStore.getState().startSculpt("confrontation");
    const s = useOutlineBoardStore.getState();
    expect(s.sculptingAct).toBe("confrontation");
    expect(s.proposal).toBeNull();
    expect(s.sculptError).toBeNull();
  });

  it("setProposal stores the proposal and resets decisions", () => {
    useOutlineBoardStore.getState().setDecision(0, "skip");
    useOutlineBoardStore.getState().setProposal(proposal);
    const s = useOutlineBoardStore.getState();
    expect(s.proposal).toEqual(proposal);
    expect(s.decisions).toEqual({});
  });

  it("setDecision records a per-index choice", () => {
    useOutlineBoardStore.getState().setProposal(proposal);
    useOutlineBoardStore.getState().setDecision(0, "skip");
    expect(useOutlineBoardStore.getState().decisions[0]).toBe("skip");
  });

  it("rejectAll clears proposal, decisions, and sculptingAct", () => {
    useOutlineBoardStore.getState().startSculpt("setup");
    useOutlineBoardStore.getState().setProposal(proposal);
    useOutlineBoardStore.getState().setDecision(0, "skip");
    useOutlineBoardStore.getState().rejectAll();
    const s = useOutlineBoardStore.getState();
    expect(s.proposal).toBeNull();
    expect(s.decisions).toEqual({});
    expect(s.sculptingAct).toBeNull();
  });

  it("clearProposal clears the proposal and decisions but not sculptingAct semantics", () => {
    useOutlineBoardStore.getState().setProposal(proposal);
    useOutlineBoardStore.getState().setDecision(0, "keep");
    useOutlineBoardStore.getState().clearProposal();
    const s = useOutlineBoardStore.getState();
    expect(s.proposal).toBeNull();
    expect(s.decisions).toEqual({});
  });
});
