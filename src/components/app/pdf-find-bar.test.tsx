// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfFindBar } from "@/components/app/pdf-find-bar";
import { usePdfFindStore } from "@/stores/pdf-find-store";
import { useSearchSurfaceStore } from "@/stores/search-surface-store";

afterEach(() => cleanup());

beforeEach(() => {
  usePdfFindStore.getState().reset();
  useSearchSurfaceStore.setState({
    activeSurface: "pdf",
    openSurface: "pdf",
    focusRevision: 1,
  });
});

describe("PdfFindBar", () => {
  it("updates its independent query and options", () => {
    render(<PdfFindBar onNext={vi.fn()} onPrevious={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Find in PDF"), {
      target: { value: "Chapter Twelve" },
    });
    fireEvent.click(screen.getByTitle("Match case"));
    fireEvent.click(screen.getByTitle("Match whole word"));
    expect(usePdfFindStore.getState()).toMatchObject({
      query: "Chapter Twelve",
      caseSensitive: true,
      wholeWord: true,
    });
  });

  it("routes Enter and Shift+Enter in opposite directions", () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    usePdfFindStore.getState().setResult({
      status: "found",
      current: 1,
      total: 2,
      error: null,
    });
    render(<PdfFindBar onNext={onNext} onPrevious={onPrevious} />);
    const input = screen.getByLabelText("Find in PDF");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape while retaining the PDF query", () => {
    usePdfFindStore.getState().setQuery("arrival");
    render(<PdfFindBar onNext={vi.fn()} onPrevious={vi.fn()} />);
    fireEvent.keyDown(screen.getByLabelText("Find in PDF"), { key: "Escape" });
    expect(useSearchSurfaceStore.getState().openSurface).toBeNull();
    expect(usePdfFindStore.getState().query).toBe("arrival");
  });

  it("shows pending, count, no-results, and error states", () => {
    const view = render(<PdfFindBar onNext={vi.fn()} onPrevious={vi.fn()} />);
    usePdfFindStore.getState().setPending();
    view.rerender(<PdfFindBar onNext={vi.fn()} onPrevious={vi.fn()} />);
    expect(screen.getByLabelText("Searching PDF")).toBeTruthy();

    usePdfFindStore.getState().setResult({
      status: "found",
      current: 2,
      total: 7,
      error: null,
    });
    view.rerender(<PdfFindBar onNext={vi.fn()} onPrevious={vi.fn()} />);
    expect(screen.getByText("2 of 7")).toBeTruthy();

    usePdfFindStore.getState().setResult({
      status: "not-found",
      current: 0,
      total: 0,
      error: null,
    });
    view.rerender(<PdfFindBar onNext={vi.fn()} onPrevious={vi.fn()} />);
    expect(screen.getByText("No results")).toBeTruthy();

    usePdfFindStore.getState().setError("Search unavailable");
    view.rerender(<PdfFindBar onNext={vi.fn()} onPrevious={vi.fn()} />);
    expect(screen.getByText("Search unavailable")).toBeTruthy();
  });
});
