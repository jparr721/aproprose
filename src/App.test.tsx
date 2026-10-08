// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

vi.mock("@/components/app/editor", () => ({
  Editor: () => <div>Editor Pane</div>,
}));

vi.mock("@/components/app/pdf-pane", () => ({
  PdfPane: () => <div>PDF Pane</div>,
}));

vi.mock("@/components/app/outline/outline-pane", () => ({
  OutlinePane: () => <div>Outline Pane</div>,
}));

vi.mock("@/components/ui/resizable", async (importOriginal) => {
  const resizable = await importOriginal<typeof import("@/components/ui/resizable")>();
  return {
    ...resizable,
    ResizablePanel: vi.fn(resizable.ResizablePanel),
    ResizablePanelGroup: vi.fn(resizable.ResizablePanelGroup),
  };
});

import { TooltipProvider } from "@/components/ui/tooltip";
import App, { Workspace } from "@/App";
import { useSettingsDialogStore } from "@/stores/settings-dialog-store";
import { AppSidebar } from "@/components/app/app-sidebar";
import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SidebarProvider } from "@/components/ui/sidebar";
import { EMPTY_META } from "@/lib/migration";
import type { ProjectInfo } from "@/lib/types";
import {
  EMPTY_AGENT_STATE,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";

const project: ProjectInfo = {
  root: "/books/quiet-novel",
  name: "Quiet Novel",
  mainFile: "main.tex",
  title: "Quiet Novel",
  author: "Author",
  metadata: {
    title: "Quiet Novel",
    subtitle: "",
    author: "Author",
    publisher: "",
    isbn: "",
  },
  chapters: [
    {
      id: "chapter-1",
      label: "1",
      title: "The Crossing",
      file: "crossing.tex",
      wordCount: 1200,
    },
  ],
};

beforeEach(async () => {
  vi.clearAllMocks();
  await useViewStore.persist.rehydrate();
  useViewStore.setState({
    aiOpen: true,
    changesOpen: false,
    selectedChange: null,
    pdfOpen: true,
    outlineOpen: false,
    focus: false,
    pending: null,
    rightPanelWidth: 388,
  });
  useProjectStore.setState({
    status: "ready",
    project,
    meta: EMPTY_META,
    activeChapterId: "chapter-1",
    chapterDirty: false,
    error: null,
  });
  useAgentConsoleStore.setState({
    ...EMPTY_AGENT_STATE,
    messages: [],
    draftContextRefs: [],
    draftContextSources: {},
    draftSourceLocators: {},
    requestedProjectRoot: project.root,
    activeProjectRoot: project.root,
    hydratedProjectRoot: project.root,
  });
});

afterEach(() => {
  cleanup();
});

describe("App notifications", () => {
  it("opens notification settings after a project fails to open", () => {
    useProjectStore.setState({ status: "empty", project: null, error: "Project unavailable" });
    useSettingsDialogStore.setState({ open: false, tab: "appearance" });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "View notifications" }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^Notifications/ }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("Workspace", () => {
  it("finishes a collapse drag before hiding the dock", () => {
    render(<TooltipProvider><Workspace /></TooltipProvider>);
    const panel = vi.mocked(ResizablePanel).mock.calls.find(([props]) => props.id === "right")?.[0];
    const group = vi.mocked(ResizablePanelGroup).mock.calls[0][0];
    if (!panel?.onResize || !group.onLayoutChanged) {
      throw new Error("Workspace must register panel resize and layout completion callbacks");
    }

    act(() => {
      panel.onResize?.({ asPercentage: 0, inPixels: 0 }, "right", {
        asPercentage: 30,
        inPixels: 388,
      });
    });

    expect(useViewStore.getState().aiOpen).toBe(true);

    act(() => { group.onLayoutChanged?.({ main: 100, right: 0 }); });

    expect(useViewStore.getState().aiOpen).toBe(false);
    expect(useViewStore.getState().rightPanelWidth).toBe(388);
  });

  it("co-docks Editor, PDF, and AI Console with AI as the rightmost panel", () => {
    const { container } = render(<TooltipProvider><Workspace /></TooltipProvider>);

    expect(screen.getByText("Editor Pane")).toBeTruthy();
    expect(screen.getByText("PDF Pane")).toBeTruthy();
    expect(screen.getByRole("region", { name: "AI Console" })).toBeTruthy();

    const panels = Array.from(
      container.querySelectorAll("[data-slot=resizable-panel]"),
    );
    expect(panels).toHaveLength(2);
    expect(panels[0].textContent).toContain("Editor Pane");
    expect(panels[0].textContent).toContain("PDF Pane");
    expect(panels[1].contains(screen.getByRole("region", { name: "AI Console" }))).toBe(true);
    expect(container.querySelector("[data-slot=sheet]")).toBeNull();
    expect(container.querySelector("[data-slot=drawer]")).toBeNull();
    expect(container.querySelector("[data-slot=sidebar-provider]")).toBeNull();
  });

  it("keeps Editor and PDF mounted when the AI Console closes", () => {
    render(<TooltipProvider><Workspace /></TooltipProvider>);
    const editor = screen.getByText("Editor Pane");
    const pdf = screen.getByText("PDF Pane");
    const console = screen.getByRole("region", { name: "AI Console" });
    const rightPanel = console.closest("[data-panel]");

    act(() => { useViewStore.getState().toggleAi(); });

    expect(screen.getByText("Editor Pane")).toBe(editor);
    expect(screen.getByText("PDF Pane")).toBe(pdf);
    expect(screen.queryByRole("region", { name: "AI Console" })).toBeNull();
    expect(useViewStore.getState().aiOpen).toBe(false);
    expect(console.isConnected).toBe(true);
    expect(rightPanel?.hasAttribute("inert")).toBe(true);
    expect(useViewStore.getState().rightPanelWidth).toBe(388);

    act(() => { useViewStore.getState().toggleAi(); });

    expect(screen.getByRole("region", { name: "AI Console" })).toBe(console);
    expect(rightPanel?.hasAttribute("inert")).toBe(false);
    expect(screen.getByText("Editor Pane")).toBe(editor);
    expect(screen.getByText("PDF Pane")).toBe(pdf);
  });

  it("keeps the same dock through focus mode and rapid toggles", () => {
    render(<TooltipProvider><Workspace /></TooltipProvider>);
    const console = screen.getByRole("region", { name: "AI Console" });
    const editor = screen.getByText("Editor Pane");

    act(() => { useViewStore.getState().applyLayoutPreset("focus"); });
    expect(screen.queryByRole("region", { name: "AI Console" })).toBeNull();
    expect(console.isConnected).toBe(true);

    act(() => { useViewStore.getState().applyLayoutPreset("two"); });
    act(() => { useViewStore.getState().toggleAi(); });
    act(() => { useViewStore.getState().toggleAi(); });

    expect(screen.getByRole("region", { name: "AI Console" })).toBe(console);
    expect(screen.getByText("Editor Pane")).toBe(editor);
    expect(useViewStore.getState().rightPanelWidth).toBe(388);
  });

  it("opens an initially hidden dock without remounting it", () => {
    useViewStore.setState({ aiOpen: false });
    const { container } = render(<TooltipProvider><Workspace /></TooltipProvider>);
    const console = container.querySelector("[data-agent-console]");

    expect(console).not.toBeNull();
    expect(screen.queryByRole("region", { name: "AI Console" })).toBeNull();

    act(() => { useViewStore.getState().toggleAi(); });

    expect(screen.getByRole("region", { name: "AI Console" })).toBe(console);
    expect(useViewStore.getState().rightPanelWidth).toBe(388);
  });

  it("keeps the editor mounted behind Outline while the AI Console remains open", () => {
    useProjectStore.setState({ chapterDirty: true });
    useViewStore.setState({ outlineOpen: true, aiOpen: true });

    render(<TooltipProvider><Workspace /></TooltipProvider>);

    const editor = screen.getByText("Editor Pane");
    expect(editor.parentElement?.classList.contains("hidden")).toBe(true);
    expect(screen.getByText("Outline Pane")).toBeTruthy();
    expect(screen.getByRole("region", { name: "AI Console" })).toBeTruthy();
    expect(useProjectStore.getState().chapterDirty).toBe(true);
  });

  it("switches AI and Changes inside one retained dock while preserving editor and PDF", async () => {
    useAgentConsoleStore.getState().stageProposal({
      id: "retained-overview", kind: "overview", projectRoot: project.root, chapterId: null,
      summary: "Keep the stakes clear", createdAt: "2026-10-08T00:00:00.000Z", originatingMessageId: "assistant-1", changes: [],
      overviewChange: { id: "overview-change", before: "Old story", after: "Saved proposed story", reason: "Focus the stakes", sourceFingerprint: "overview-fingerprint" },
    }, { kind: "legacy" });
    const retained = useAgentConsoleStore.getState().proposalRecords;
    const { container } = render(<TooltipProvider><Workspace /></TooltipProvider>);
    const editor = screen.getByText("Editor Pane");
    const pdf = screen.getByText("PDF Pane");
    const console = screen.getByRole("region", { name: "AI Console" });
    const changes = container.querySelector("[data-changes-panel]");
    await act(async () => { useViewStore.getState().openChanges(); });
    expect(screen.getByRole("region", { name: "Changes" })).toBe(changes);
    expect(screen.queryByRole("region", { name: "AI Console" })).toBeNull();
    expect(console.isConnected).toBe(true);
    expect(screen.getByText("Editor Pane")).toBe(editor);
    expect(screen.getByText("PDF Pane")).toBe(pdf);
    await act(async () => { useViewStore.getState().setChangesOpen(false); });
    expect(screen.queryByRole("region", { name: "Changes" })).toBeNull();
    expect(changes?.isConnected).toBe(true);
    await act(async () => { useViewStore.getState().openChanges(); });
    expect(screen.getByRole("region", { name: "Changes" })).toBe(changes);
    await act(async () => { useViewStore.getState().openAiConsole(); });
    expect(screen.getByRole("region", { name: "AI Console" })).toBe(console);
    expect(screen.getByText("Editor Pane")).toBe(editor);
    expect(useAgentConsoleStore.getState().proposalRecords).toBe(retained);
    await act(async () => { useViewStore.getState().openChanges(); });
    expect(screen.getByRole("region", { name: "Changes" })).toBe(changes);
    expect(screen.getByText("Saved proposed story")).toBeTruthy();
  });
});

describe("AppSidebar", () => {
  it("opens Outline without guarding a dirty editor", () => {
    useProjectStore.setState({ chapterDirty: true });
    render(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Outline" }));

    expect(useViewStore.getState()).toMatchObject({
      outlineOpen: true,
      pending: null,
    });
    expect(useProjectStore.getState().chapterDirty).toBe(true);
  });
});
