import { describe, it, expect, beforeEach } from "vitest";
import { useOutlineBoardStore } from "@/stores/outline-board-store";
import type { SculptProposal } from "@/lib/types";

const proposal: SculptProposal = {
  chapterId: "ch1",
  summary: "s",
  changes: [
    { kind: "add", cardId: null, title: "T", intention: "i", toIndex: null, reason: "r" },
  ],
};

beforeEach(() => {
  useOutlineBoardStore.setState({
    openChapterId: null,
    sculptingChapterId: null,
    proposal: null,
    decisions: {},
    sculptError: null,
  });
});

describe("outline-board-store chapter nav", () => {
  it("openChapter sets openChapterId", () => {
    useOutlineBoardStore.getState().openChapter("ch1");
    expect(useOutlineBoardStore.getState().openChapterId).toBe("ch1");
  });

  it("closeChapter clears openChapterId to null", () => {
    useOutlineBoardStore.getState().openChapter("ch1");
    useOutlineBoardStore.getState().closeChapter();
    expect(useOutlineBoardStore.getState().openChapterId).toBeNull();
  });
});

describe("outline-board-store sculpt fields", () => {
  it("startSculpt sets sculptingChapterId and resets proposal/error/decisions", () => {
    useOutlineBoardStore.getState().setProposal(proposal);
    useOutlineBoardStore.getState().setSculptError("boom");
    useOutlineBoardStore.getState().setDecision(0, "keep");
    useOutlineBoardStore.getState().startSculpt("ch2");
    const s = useOutlineBoardStore.getState();
    expect(s.sculptingChapterId).toBe("ch2");
    expect(s.proposal).toBeNull();
    expect(s.sculptError).toBeNull();
    expect(s.decisions).toEqual({});
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

  it("rejectAll clears proposal, decisions, and sculptingChapterId", () => {
    useOutlineBoardStore.getState().startSculpt("ch1");
    useOutlineBoardStore.getState().setProposal(proposal);
    useOutlineBoardStore.getState().setDecision(0, "skip");
    useOutlineBoardStore.getState().rejectAll();
    const s = useOutlineBoardStore.getState();
    expect(s.proposal).toBeNull();
    expect(s.decisions).toEqual({});
    expect(s.sculptingChapterId).toBeNull();
  });

  it("clearProposal clears proposal and decisions but leaves sculptingChapterId", () => {
    useOutlineBoardStore.getState().startSculpt("ch1");
    useOutlineBoardStore.getState().setProposal(proposal);
    useOutlineBoardStore.getState().setDecision(0, "keep");
    useOutlineBoardStore.getState().clearProposal();
    const s = useOutlineBoardStore.getState();
    expect(s.proposal).toBeNull();
    expect(s.decisions).toEqual({});
    expect(s.sculptingChapterId).toBe("ch1");
  });
});
