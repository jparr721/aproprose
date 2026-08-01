// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

import { Workspace } from "@/App";
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

beforeEach(() => {
  useViewStore.setState({
    aiOpen: true,
    pdfOpen: true,
    outlineOpen: false,
    focus: false,
    rightPanelWidth: 388,
  });
  useProjectStore.setState({
    project,
    activeChapterId: "chapter-1",
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

describe("Workspace", () => {
  it("co-docks Editor, PDF, and AI Console with AI as the rightmost panel", () => {
    const { container } = render(<Workspace />);

    expect(screen.getByText("Editor Pane")).toBeTruthy();
    expect(screen.getByText("PDF Pane")).toBeTruthy();
    expect(screen.getByRole("region", { name: "AI Console" })).toBeTruthy();

    const panels = Array.from(
      container.querySelectorAll("[data-slot=resizable-panel]"),
    );
    expect(panels).toHaveLength(2);
    expect(panels[0].textContent).toContain("Editor Pane");
    expect(panels[0].textContent).toContain("PDF Pane");
    expect(panels[1].textContent).toContain("AI Console");
    expect(container.querySelector("[data-slot=sheet]")).toBeNull();
    expect(container.querySelector("[data-slot=drawer]")).toBeNull();
    expect(container.querySelector("[data-slot=sidebar-provider]")).toBeNull();
  });

  it("keeps Editor and PDF mounted when the AI Console closes", () => {
    render(<Workspace />);

    fireEvent.click(
      screen.getByRole("button", { name: "Close AI Console" }),
    );

    expect(screen.getByText("Editor Pane")).toBeTruthy();
    expect(screen.getByText("PDF Pane")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "AI Console" })).toBeNull();
    expect(useViewStore.getState().aiOpen).toBe(false);
  });
});
