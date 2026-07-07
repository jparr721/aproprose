// @vitest-environment happy-dom
//
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ai/agent", () => ({ runAgent: vi.fn() }));
vi.mock("@/lib/ai/model", () => ({ supportsTools: vi.fn(() => true) }));
vi.mock("@/components/ai-elements/prompt-input", () => ({
  PromptInputProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  usePromptInputController: () => ({
    textInput: { value: "", setInput: vi.fn(), clear: vi.fn() },
  }),
}));
vi.mock("@/components/app/right-panel/shared", () => ({
  AiComposer: ({ onSubmit }: { onSubmit: (t: string) => void }) => (
    <button onClick={() => onSubmit("raise the stakes")}>send</button>
  ),
  AiError: () => <div>err</div>,
  AskedCaption: () => <div />,
  PanelEmpty: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div>
      <div>{title}</div>
      <div>{children}</div>
    </div>
  ),
  PanelHint: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { MuseTab } from "@/components/app/right-panel/muse-tab";
import { runAgent } from "@/lib/ai/agent";
import { supportsTools } from "@/lib/ai/model";
import { useMuseStore } from "@/stores/muse-store";
import { useProjectStore } from "@/stores/project-store";
import { useAiCacheStore } from "@/stores/ai-cache-store";
import { useAiActivityStore } from "@/stores/ai-activity-store";
import { useAiIntentStore } from "@/stores/ai-intent-store";
import { useSettingsStore } from "@/stores/settings-store";
import { PICK_UP_AND_GO_DIRECTIVE, pickUpCursorSuffix } from "@/lib/ai/prompts";
import type { ManuscriptProposal } from "@/lib/types";

const PROPOSAL: ManuscriptProposal = {
  chapterId: "ch1",
  summary: "Sharper opening",
  changes: [
    {
      kind: "rewrite",
      blockId: "b1",
      afterId: null,
      type: null,
      speaker: null,
      newText: "Rain hammered the glass.",
      toIndex: null,
      reason: "sharper",
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.mocked(supportsTools).mockReturnValue(true);
  vi.mocked(runAgent).mockReset();
  useMuseStore.getState().reset();
  useProjectStore.setState({ activeChapterId: "ch1", selectedId: null, editing: false, blocks: [] });
  useAiCacheStore.setState({ entries: {} });
  useAiActivityStore.setState({ status: {} });
  useAiIntentStore.setState({ pending: null });
  useSettingsStore.setState({ aiProvider: "openai" });
});

describe("MuseTab", () => {
  it("runs the agent, shows the feed, and stages the proposal into the Edit cache", async () => {
    vi.mocked(runAgent).mockImplementation(async (_directive, { onStep }) => {
      onStep({ tool: "read_chapter", label: "Reading the chapter" });
      onStep({ tool: "stage_proposal", label: "Drafting changes" });
      return PROPOSAL;
    });

    render(<MuseTab />);
    fireEvent.click(screen.getByText("send"));

    await waitFor(() => expect(screen.getByText("Review in Edit")).toBeTruthy());
    expect(screen.getByText("Reading the chapter")).toBeTruthy();
    expect(screen.getByText("Drafting changes")).toBeTruthy();
    expect(useAiCacheStore.getState().entries["edit:ch1:chapter:"]).toMatchObject({
      data: PROPOSAL,
      loading: false,
      error: null,
      instruction: "raise the stakes",
    });
    expect(useMuseStore.getState().status).toBe("done");
    expect(useMuseStore.getState().staged).toBe(true);
    expect(useAiActivityStore.getState().status.edit).toBe("done");
  });

  it("Review in Edit parks a chapter-scope intent for the Edit tab", async () => {
    vi.mocked(runAgent).mockResolvedValue(PROPOSAL);
    render(<MuseTab />);
    fireEvent.click(screen.getByText("send"));
    await waitFor(() => expect(screen.getByText("Review in Edit")).toBeTruthy());
    fireEvent.click(screen.getByText("Review in Edit"));
    expect(useAiIntentStore.getState().pending).toMatchObject({ tab: "edit", scope: "chapter" });
  });

  it("Stop aborts the run and returns to idle", async () => {
    vi.mocked(runAgent).mockImplementation(
      (_directive, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    render(<MuseTab />);
    fireEvent.click(screen.getByText("send"));
    await waitFor(() => expect(useMuseStore.getState().status).toBe("running"));
    fireEvent.click(screen.getByText("Stop"));
    await waitFor(() => expect(useMuseStore.getState().status).toBe("idle"));
  });

  it("Stop still aborts after the tab is unmounted and remounted mid-run", async () => {
    vi.mocked(runAgent).mockImplementation(
      (_directive, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    // ActivePanel unmounts inactive tabs. Start a run, leave (unmount), come
    // back (remount): the fresh mount must still own the in-flight controller.
    const { unmount } = render(<MuseTab />);
    fireEvent.click(screen.getByText("send"));
    await waitFor(() => expect(useMuseStore.getState().status).toBe("running"));
    unmount();
    render(<MuseTab />);
    fireEvent.click(screen.getByText("Stop"));
    await waitFor(() => expect(useMuseStore.getState().status).toBe("idle"));
  });

  it("shows the error state when the run fails", async () => {
    vi.mocked(runAgent).mockRejectedValue(new Error("boom"));
    render(<MuseTab />);
    fireEvent.click(screen.getByText("send"));
    await waitFor(() => expect(screen.getByText("err")).toBeTruthy());
    expect(useMuseStore.getState().status).toBe("failed");
  });

  it("an autoRun intent starts the run immediately", async () => {
    vi.mocked(runAgent).mockResolvedValue(null);
    useAiIntentStore.setState({
      pending: { tab: "muse", instruction: "pick up the scene", autoRun: true },
    });
    render(<MuseTab />);
    await waitFor(() =>
      expect(runAgent).toHaveBeenCalledWith("pick up the scene", expect.anything()),
    );
  });

  it("renders the disabled explanation instead of the composer when tools are unsupported", () => {
    vi.mocked(supportsTools).mockReturnValue(false);
    useSettingsStore.setState({ aiProvider: "claude" });
    render(<MuseTab />);
    expect(screen.getByText("Muse needs the OpenAI provider")).toBeTruthy();
    expect(screen.queryByText("send")).toBeNull();
  });

  it("offers Pick up and go in the idle state, which starts a cursor-anchored run", async () => {
    vi.mocked(runAgent).mockResolvedValue(null);
    useProjectStore.setState({ selectedId: "b2", editing: true });
    render(<MuseTab />);
    fireEvent.click(screen.getByText("Pick up and go"));
    await waitFor(() =>
      expect(runAgent).toHaveBeenCalledWith(
        PICK_UP_AND_GO_DIRECTIVE + pickUpCursorSuffix("b2"),
        expect.anything(),
      ),
    );
  });

  it("does not use a nav-only highlight for Pick up and go", async () => {
    vi.mocked(runAgent).mockResolvedValue(null);
    useProjectStore.setState({ selectedId: "b2", editing: false });
    render(<MuseTab />);
    fireEvent.click(screen.getByText("Pick up and go"));
    await waitFor(() =>
      expect(runAgent).toHaveBeenCalledWith(
        PICK_UP_AND_GO_DIRECTIVE + pickUpCursorSuffix(null),
        expect.anything(),
      ),
    );
  });

  it("can discard staged changes before running Muse again", async () => {
    vi.mocked(runAgent).mockResolvedValue(PROPOSAL);
    render(<MuseTab />);
    fireEvent.click(screen.getByText("send"));
    await waitFor(() => expect(screen.getByText("Review in Edit")).toBeTruthy());

    fireEvent.click(screen.getByText("Discard changes"));

    expect(useMuseStore.getState().status).toBe("idle");
    expect(useAiCacheStore.getState().entries["edit:ch1:chapter:"]?.data).toBeNull();
    vi.mocked(runAgent).mockClear();

    fireEvent.click(screen.getByText("send"));
    await waitFor(() =>
      expect(runAgent).toHaveBeenCalledWith("raise the stakes", expect.anything()),
    );
  });
});
