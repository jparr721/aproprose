import { describe, it, expect, beforeEach } from "vitest";
import { useOutlineBoardStore } from "@/stores/outline-board-store";

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
