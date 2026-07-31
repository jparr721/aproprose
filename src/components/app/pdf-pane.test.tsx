// @vitest-environment happy-dom
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  type RenderResult,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfPane } from "@/components/app/pdf-pane";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ProjectInfo } from "@/lib/types";
import { useProjectStore } from "@/stores/project-store";
import { useSettingsStore } from "@/stores/settings-store";

const adapter = vi.hoisted(() => ({
  loadDocument: vi.fn(),
  clearDocument: vi.fn(),
  setPage: vi.fn(),
  setScale: vi.fn(),
  search: vi.fn(),
  nextMatch: vi.fn(),
  previousMatch: vi.fn(),
  closeSearch: vi.fn(),
  getView: vi.fn(() => ({ page: 1, pageCount: 4, scale: 1.1 })),
  dispose: vi.fn(),
}));

const viewerCallbacks = vi.hoisted(() => ({
  onPageChange: null as ((page: number) => void) | null,
}));

vi.mock("@/lib/pdf/viewer-adapter", () => ({
  base64ToBytes: vi.fn(() => new Uint8Array([1])),
  createPdfViewerAdapter: vi.fn(async (options: {
    onReady: (state: {
      page: number;
      pageCount: number;
      scale: number;
    }) => void;
    onPageChange: (page: number) => void;
  }) => {
    viewerCallbacks.onPageChange = options.onPageChange;
    options.onReady({ page: 1, pageCount: 4, scale: 1.1 });
    return adapter;
  }),
}));

vi.mock("@/lib/tauri", () => ({
  pdfPath: vi.fn().mockResolvedValue("/books/preview.pdf"),
}));

function renderPane(): RenderResult {
  return render(
    <TooltipProvider>
      <PdfPane />
    </TooltipProvider>,
  );
}

const project: ProjectInfo = {
  root: "/books",
  name: "Book",
  mainFile: "main.tex",
  title: "Book",
  author: "Author",
  metadata: {
    title: "Book",
    subtitle: "",
    author: "Author",
    publisher: "",
    isbn: "",
  },
  chapters: [],
};

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  viewerCallbacks.onPageChange = null;
  adapter.loadDocument.mockResolvedValue(undefined);
  adapter.clearDocument.mockResolvedValue(undefined);
  adapter.dispose.mockResolvedValue(undefined);
  useSettingsStore.setState({ pdfZoom: 1.1 });
  useProjectStore.setState({
    project,
    compile: {
      status: "clean",
      pdfBase64: "AQ==",
      at: 1,
      durationMs: 100,
      log: "",
      errors: [],
    },
  });
});

describe("PdfPane viewer lifecycle", () => {
  it("loads compiled bytes at the persisted zoom", async () => {
    renderPane();
    await waitFor(() =>
      expect(adapter.loadDocument).toHaveBeenCalledWith(
        new Uint8Array([1]),
        { page: 1, scale: 1.1 },
      ),
    );
  });

  it("preserves the current page when compiled bytes are replaced", async () => {
    renderPane();
    await waitFor(() => expect(adapter.loadDocument).toHaveBeenCalledTimes(1));
    act(() => viewerCallbacks.onPageChange?.(3));
    act(() => {
      useProjectStore.setState((state) => ({
        compile: {
          status: state.compile.status,
          pdfBase64: "Ag==",
          log: state.compile.log,
          errors: state.compile.errors,
          durationMs: state.compile.durationMs,
          at: 2,
        },
      }));
    });
    await waitFor(() =>
      expect(adapter.loadDocument).toHaveBeenLastCalledWith(
        new Uint8Array([1]),
        { page: 3, scale: 1.1 },
      ),
    );
  });

  it("shows an explicit viewer error and keeps recompile available", async () => {
    adapter.loadDocument.mockRejectedValueOnce(new Error("Invalid PDF"));
    renderPane();
    expect(await screen.findByText("Invalid PDF")).toBeTruthy();
    expect(screen.getByTitle("Re-compile")).toBeTruthy();
  });

  it("disposes the adapter on unmount", async () => {
    const view = renderPane();
    await waitFor(() => expect(adapter.loadDocument).toHaveBeenCalled());
    view.unmount();
    await waitFor(() => expect(adapter.dispose).toHaveBeenCalledTimes(1));
  });
});
