import { describe, it, expect, beforeEach, vi } from "vitest";

// view-store persists through the Tauri-backed storage adapter; stub the bridge so
// importing it here neither hits native APIs nor matters to these assertions.
vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));

import { useAiActivityStore } from "@/stores/ai-activity-store";
import { useViewStore } from "@/stores/view-store";

function viewingConsole(): void {
  useViewStore.setState({ aiOpen: true, focus: false });
}

beforeEach(() => {
  useAiActivityStore.setState({ status: {} });
  useViewStore.setState({ aiOpen: false, focus: false });
});

describe("ai-activity-store", () => {
  it("start marks a tab running", () => {
    useAiActivityStore.getState().start("suggest");
    expect(useAiActivityStore.getState().status.suggest).toBe("running");
  });

  it("finish while the console is closed flags it done", () => {
    const s = useAiActivityStore.getState();
    s.start("suggest");
    s.finish("suggest", "done");
    expect(useAiActivityStore.getState().status.suggest).toBe("done");
  });

  it("finish with a failed outcome flags it when the console is closed", () => {
    const s = useAiActivityStore.getState();
    s.start("suggest");
    s.finish("suggest", "failed");
    expect(useAiActivityStore.getState().status.suggest).toBe("failed");
  });

  it("finish while the shared console is visible clears it", () => {
    viewingConsole();
    const s = useAiActivityStore.getState();
    s.start("suggest");
    s.finish("suggest", "failed");
    expect(useAiActivityStore.getState().status.suggest).toBeUndefined();
  });

  it("focus mode does not count as watching", () => {
    useViewStore.setState({ aiOpen: true, focus: true });
    const s = useAiActivityStore.getState();
    s.start("suggest");
    s.finish("suggest", "done");
    expect(useAiActivityStore.getState().status.suggest).toBe("done");
  });

  it("a closed console does not count as watching", () => {
    useViewStore.setState({ aiOpen: false, focus: false });
    const s = useAiActivityStore.getState();
    s.start("suggest");
    s.finish("suggest", "done");
    expect(useAiActivityStore.getState().status.suggest).toBe("done");
  });

  it("markSeen clears a done badge", () => {
    const s = useAiActivityStore.getState();
    s.start("critique");
    s.finish("critique", "done");
    s.markSeen("critique");
    expect(useAiActivityStore.getState().status.critique).toBeUndefined();
  });

  it("markSeen clears a failed badge", () => {
    const s = useAiActivityStore.getState();
    s.start("critique");
    s.finish("critique", "failed");
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
