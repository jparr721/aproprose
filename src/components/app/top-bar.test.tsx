// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/app/backup-review-dialog", () => ({
  BackupReviewDialog: () => null,
}));

vi.mock("@/components/app/backup-setup-dialog", () => ({
  BackupSetupDialog: () => null,
}));

vi.mock("@/components/app/build-errors-dialog", () => ({
  BuildErrorsDialog: () => null,
}));

vi.mock("@/components/app/keybinding-hint", () => ({
  KeybindingHint: () => <span data-testid="keybinding-hint">keybinding</span>,
}));

vi.mock("@/components/app/sync-status", () => ({
  SyncStatus: () => <span data-testid="sync-status" />,
}));

vi.mock("@/components/app/window-controls", () => ({
  WindowControls: () => null,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button type="button" aria-label="Toggle Sidebar" />,
  useSidebar: () => ({ state: "expanded" }),
}));

vi.mock("@/hooks/use-keybinding", () => ({
  useKeybinding: vi.fn(),
}));

vi.mock("@/lib/platform", () => ({
  IS_MAC: false,
}));

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

import { TopBar } from "@/components/app/top-bar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ProjectInfo } from "@/lib/types";
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

const compileNow = vi.fn(async () => undefined);

function renderTopBar(): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <TopBar />
    </TooltipProvider>,
  );
}

function saveStatus(label: string): HTMLElement {
  const status = screen
    .getAllByRole("status")
    .find((element) => element.getAttribute("aria-label") === label);
  if (status === undefined) throw new Error(`Expected ${label} save status`);
  return status;
}

function expectSaveIcon(label: string, icon: string): void {
  const status = saveStatus(label);
  const svg = status.querySelector("svg");
  if (svg === null) throw new Error("Expected a save icon");
  expect(svg.getAttribute("class")).toContain(`lucide-${icon}`);
}

afterEach(cleanup);

beforeEach(() => {
  compileNow.mockClear();
  useProjectStore.setState({
    project,
    activeChapterId: "chapter-1",
    chapterDirty: false,
    saving: false,
    saveError: null,
    compile: {
      status: "clean",
      pdfBase64: null,
      log: "",
      errors: [],
      durationMs: 0,
      at: null,
    },
    compileNow,
  });
  useViewStore.setState({
    aiOpen: false,
    pdfOpen: false,
    focus: false,
    buildErrorsOpen: false,
  });
});

describe("TopBar save status", () => {
  it("renders the clean save state as an icon-only accessible status", () => {
    renderTopBar();

    expectSaveIcon("Saved", "save-check");
  });

  it.each([
    ["saved", { chapterDirty: false, saving: false, saveError: null }, "Saved"],
    ["unsaved", { chapterDirty: true, saving: false, saveError: null }, "Unsaved changes"],
    ["saving", { chapterDirty: true, saving: true, saveError: null }, "Saving"],
    ["failed", { chapterDirty: true, saving: false, saveError: "Error: disk full" }, "Save failed"],
  ] as const)("uses a 14px top-bar glyph when %s", (_state, state, label) => {
    useProjectStore.setState(state);
    renderTopBar();

    const svg = saveStatus(label).querySelector("svg");
    if (svg === null) throw new Error("Expected a save status glyph");
    expect(svg.getAttribute("class")).toContain("size-3.5");
  });

  it("renders unsaved edits as an icon-only accessible status", () => {
    useProjectStore.setState({ chapterDirty: true });
    renderTopBar();

    expectSaveIcon("Unsaved changes", "save");
  });

  it("renders an in-progress save with the Spinner", () => {
    useProjectStore.setState({ saving: true, chapterDirty: true });
    renderTopBar();

    expect(saveStatus("Saving").querySelector('[data-slot="spinner"]')).not.toBeNull();
  });

  it("renders a failed save with its error in a tooltip", async () => {
    useProjectStore.setState({
      saving: false,
      chapterDirty: true,
      saveError: "Error: disk full",
    });
    renderTopBar();

    const status = saveStatus("Save failed");
    const svg = status.querySelector("svg");
    if (svg === null) throw new Error("Expected a save error icon");
    expect(svg.getAttribute("class")).toContain("lucide-save-off");

    fireEvent.pointerMove(status);
    expect(
      (await screen.findByRole("tooltip", { hidden: true })).textContent,
    ).toBe("Error: disk full");
  });
});

describe("TopBar Compile", () => {
  it("uses an icon-only Compile button with no build badge or keybinding hint", () => {
    renderTopBar();

    const compile = screen.getByRole("button", { name: "Compile" });
    expect(compile.getAttribute("data-size")).toBe("icon-sm");
    expect(compile.textContent).toBe("");
    expect(compile.querySelector("svg")?.getAttribute("class")).toContain("size-3.5");
    expect(compile.querySelector('[data-testid="keybinding-hint"]')).toBeNull();
    expect(screen.queryByText("loaded")).toBeNull();

    fireEvent.click(compile);
    expect(compileNow).toHaveBeenCalledTimes(1);
  });
});
