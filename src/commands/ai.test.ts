// @vitest-environment happy-dom
//
// The pick-up command must park an auto-running muse intent carrying the canned
// directive plus a cursor line read from the project store's selectedId, and
// open the panel on the Muse tab. Stores are real (store-test convention); only
// the tauri persistence boundary under project-store is mocked (the established
// edit-tab.test.tsx pattern). registry.test.ts already covers the generic
// invariants (unique ids, leaf-xor-page) for every command including this one.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));

import { aiCommands } from "@/commands/ai";
import { useAiIntentStore } from "@/stores/ai-intent-store";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import { PICK_UP_AND_GO_DIRECTIVE, pickUpCursorSuffix } from "@/lib/ai/prompts";

const runPickUp = () => {
  const cmd = aiCommands.find((c) => c.id === "ai.pick-up");
  if (!cmd?.run) throw new Error("ai.pick-up leaf command not registered");
  void cmd.run({ toggleSidebar: () => {} });
};

describe("pickUpCursorSuffix", () => {
  // Raw literals on purpose: the directive's wording promises exactly these
  // lines, so a drift in the helper must fail here, not be rebuilt by it.
  it("pins the exact cursor-line literals", () => {
    expect(pickUpCursorSuffix("b7")).toBe("\n\nThe cursor block id is [b7].");
    expect(pickUpCursorSuffix(null)).toBe(
      "\n\nNo cursor is set; continue from where the chapter's prose currently ends.",
    );
  });
});

describe("ai.pick-up command", () => {
  beforeEach(() => {
    useAiIntentStore.setState({ pending: null });
    useProjectStore.setState({ selectedId: null });
  });

  it("parks an auto-running muse intent carrying the directive and the cursor line", () => {
    useProjectStore.setState({ selectedId: "b7" });
    runPickUp();

    expect(useAiIntentStore.getState().pending).toEqual({
      tab: "muse",
      instruction: PICK_UP_AND_GO_DIRECTIVE + pickUpCursorSuffix("b7"),
      autoRun: true,
    });
    expect(useViewStore.getState().aiTab).toBe("muse");
  });

  it("appends the no-cursor line when nothing is selected", () => {
    runPickUp();

    expect(useAiIntentStore.getState().pending).toEqual({
      tab: "muse",
      instruction: PICK_UP_AND_GO_DIRECTIVE + pickUpCursorSuffix(null),
      autoRun: true,
    });
  });
});
