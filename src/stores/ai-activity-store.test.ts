import { describe, it, expect, beforeEach, vi } from "vitest";

// view-store persists through the Tauri-backed storage adapter; stub the bridge so
// importing it here neither hits native APIs nor matters to these assertions.
vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));

import { useAiActivityStore } from "@/stores/ai-activity-store";
import { useViewStore } from "@/stores/view-store";

/** Put the panel in a known viewing state (open + expanded, looking at `aiTab`). */
function viewing(aiTab: "outline" | "suggest"): void {
  useViewStore.setState({ aiOpen: true, focus: false, aiCollapsed: false, aiTab });
}

beforeEach(() => {
  useAiActivityStore.setState({ status: {} });
  // Default: looking at the outline tab, so the generating tabs are all "away".
  viewing("outline");
});

describe("ai-activity-store", () => {
  it("start marks a tab running", () => {
    useAiActivityStore.getState().start("suggest");
    expect(useAiActivityStore.getState().status.suggest).toBe("running");
  });

  it("finish on a tab the author isn't watching flags it done", () => {
    const s = useAiActivityStore.getState();
    s.start("suggest");
    s.finish("suggest");
    expect(useAiActivityStore.getState().status.suggest).toBe("done");
  });

  it("finish while watching the tab clears it -- a visible result needs no badge", () => {
    viewing("suggest");
    const s = useAiActivityStore.getState();
    s.start("suggest");
    s.finish("suggest");
    expect(useAiActivityStore.getState().status.suggest).toBeUndefined();
  });

  it("a collapsed panel does not count as watching, so finish still flags done", () => {
    useViewStore.setState({ aiOpen: true, focus: false, aiCollapsed: true, aiTab: "suggest" });
    const s = useAiActivityStore.getState();
    s.start("suggest");
    s.finish("suggest");
    expect(useAiActivityStore.getState().status.suggest).toBe("done");
  });

  it("markSeen clears a done badge", () => {
    const s = useAiActivityStore.getState();
    s.start("critique");
    s.finish("critique");
    s.markSeen("critique");
    expect(useAiActivityStore.getState().status.critique).toBeUndefined();
  });

  it("markSeen leaves a running job alone so navigating away re-surfaces it", () => {
    const s = useAiActivityStore.getState();
    s.start("edit");
    s.markSeen("edit");
    expect(useAiActivityStore.getState().status.edit).toBe("running");
  });

  it("reset clears every tab", () => {
    const s = useAiActivityStore.getState();
    s.start("suggest");
    s.start("edit");
    s.reset();
    expect(useAiActivityStore.getState().status).toEqual({});
  });
});
