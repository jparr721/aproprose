// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  type RenderResult,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfPane } from "@/components/app/pdf-pane";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ProjectInfo } from "@/lib/types";
import { usePdfFindStore } from "@/stores/pdf-find-store";
import { useProjectStore } from "@/stores/project-store";
import { useSearchSurfaceStore } from "@/stores/search-surface-store";
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

vi.mock("@/lib/clipboard", () => ({
  copyText: vi.fn().mockResolvedValue(true),
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
  usePdfFindStore.getState().reset();
  useSearchSurfaceStore.setState({
    activeSurface: "editor",
    openSurface: null,
    focusRevision: 0,
  });
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

  it("activates PDF search and styles the filename on pointer interaction", async () => {
    renderPane();
    const pane = screen.getByLabelText("PDF preview");
    fireEvent.pointerDown(pane);
    expect(useSearchSurfaceStore.getState().activeSurface).toBe("pdf");
    expect(screen.getByText("preview.pdf").className).toContain(
      "text-accent-ink",
    );
    expect(screen.getByText("preview.pdf").className).toContain("font-medium");
  });

  it("searches with the retained PDF query while PDF find is open", async () => {
    renderPane();
    await waitFor(() => expect(adapter.loadDocument).toHaveBeenCalled());
    usePdfFindStore.setState({
      query: "Chapter Nine",
      caseSensitive: false,
      wholeWord: true,
    });
    useSearchSurfaceStore.setState({
      activeSurface: "pdf",
      openSurface: "pdf",
      focusRevision: 1,
    });
    await waitFor(() =>
      expect(adapter.search).toHaveBeenCalledWith({
        query: "Chapter Nine",
        caseSensitive: false,
        wholeWord: true,
      }),
    );
  });

  // Mutation caught: allowing synchronous search dispatch failures to escape.
  it("keeps synchronous search failures in the PDF find error state", async () => {
    renderPane();
    await waitFor(() => expect(adapter.loadDocument).toHaveBeenCalled());
    adapter.search.mockImplementationOnce(() => {
      throw new Error("Search dispatch failed");
    });

    act(() => {
      usePdfFindStore.setState({ query: "Chapter Nine" });
      useSearchSurfaceStore.setState({
        activeSurface: "pdf",
        openSurface: "pdf",
        focusRevision: 1,
      });
    });

    await waitFor(() =>
      expect(usePdfFindStore.getState()).toMatchObject({
        status: "error",
        error: "Search dispatch failed",
      }),
    );
    expect(screen.getByText("Search dispatch failed")).toBeTruthy();
    expect(screen.queryByText("PDF preview unavailable")).toBeNull();
  });

  // Mutation caught: allowing synchronous close dispatch failures to escape.
  it("keeps synchronous close failures in the PDF find error state", async () => {
    renderPane();
    await waitFor(() => expect(adapter.loadDocument).toHaveBeenCalled());
    await waitFor(() => expect(adapter.closeSearch).toHaveBeenCalled());
    adapter.closeSearch.mockClear();
    act(() => {
      usePdfFindStore.setState({ query: "Chapter Nine" });
      useSearchSurfaceStore.setState({
        activeSurface: "pdf",
        openSurface: "pdf",
        focusRevision: 1,
      });
    });
    await waitFor(() => expect(adapter.search).toHaveBeenCalled());
    adapter.closeSearch.mockImplementationOnce(() => {
      throw new Error("Close search failed");
    });

    act(() => {
      useSearchSurfaceStore.setState({ openSurface: "editor" });
    });

    await waitFor(() =>
      expect(usePdfFindStore.getState()).toMatchObject({
        status: "error",
        error: "Close search failed",
      }),
    );
    expect(screen.queryByText("PDF preview unavailable")).toBeNull();
  });

  // Mutation caught: allowing synchronous next-match failures to escape.
  it("keeps synchronous next-match failures in the PDF find error state", async () => {
    renderPane();
    await waitFor(() => expect(adapter.loadDocument).toHaveBeenCalled());
    act(() => {
      usePdfFindStore.setState({
        query: "Chapter Nine",
        status: "found",
        current: 1,
        total: 2,
        error: null,
      });
      useSearchSurfaceStore.setState({
        activeSurface: "pdf",
        openSurface: "pdf",
        focusRevision: 1,
      });
    });
    const next = await screen.findByRole("button", {
      name: "Next PDF match",
    });
    adapter.nextMatch.mockImplementationOnce(() => {
      throw new Error("Next match failed");
    });

    fireEvent.click(next);

    await waitFor(() =>
      expect(usePdfFindStore.getState()).toMatchObject({
        status: "error",
        error: "Next match failed",
      }),
    );
    expect(screen.getByText("Next match failed")).toBeTruthy();
    expect(screen.queryByText("PDF preview unavailable")).toBeNull();
  });

  // Mutation caught: allowing synchronous previous-match failures to escape.
  it("keeps synchronous previous-match failures in the PDF find error state", async () => {
    renderPane();
    await waitFor(() => expect(adapter.loadDocument).toHaveBeenCalled());
    act(() => {
      usePdfFindStore.setState({
        query: "Chapter Nine",
        status: "found",
        current: 1,
        total: 2,
        error: null,
      });
      useSearchSurfaceStore.setState({
        activeSurface: "pdf",
        openSurface: "pdf",
        focusRevision: 1,
      });
    });
    const previous = await screen.findByRole("button", {
      name: "Previous PDF match",
    });
    adapter.previousMatch.mockImplementationOnce(() => {
      throw new Error("Previous match failed");
    });

    fireEvent.click(previous);

    await waitFor(() =>
      expect(usePdfFindStore.getState()).toMatchObject({
        status: "error",
        error: "Previous match failed",
      }),
    );
    expect(screen.getByText("Previous match failed")).toBeTruthy();
    expect(screen.queryByText("PDF preview unavailable")).toBeNull();
  });

  // Mutation caught: counting the adapter's initialization close as a switch.
  it("closes PDF.js search when another find surface opens", async () => {
    renderPane();
    await waitFor(() => expect(adapter.loadDocument).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByText("Rendering")).toBeNull(),
    );
    adapter.search.mockClear();
    adapter.closeSearch.mockClear();
    act(() => {
      usePdfFindStore.setState({ query: "Chapter Nine" });
      useSearchSurfaceStore.setState({
        activeSurface: "pdf",
        openSurface: "pdf",
        focusRevision: 1,
      });
    });
    await waitFor(() =>
      expect(adapter.search).toHaveBeenCalledWith({
        query: "Chapter Nine",
        caseSensitive: false,
        wholeWord: false,
      }),
    );

    act(() => {
      useSearchSurfaceStore.setState({ openSurface: "editor" });
    });

    await waitFor(() => expect(adapter.closeSearch).toHaveBeenCalledTimes(1));
  });

  it("shows a copy-path tooltip and copied accessible label", async () => {
    renderPane();
    const copy = await screen.findByRole("button", {
      name: "Copy PDF path",
    });
    fireEvent.pointerMove(copy);
    expect(
      await screen.findByRole("tooltip", { name: "Copy PDF path" }),
    ).toBeTruthy();
    fireEvent.click(copy);
    expect(
      await screen.findByRole("button", { name: "Copied PDF path" }),
    ).toBeTruthy();
  });
});
