// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FindBar } from "@/components/app/find-bar";
import { useFindStore } from "@/stores/find-store";
import { useSearchSurfaceStore } from "@/stores/search-surface-store";

const projectState = { blocks: [] };

vi.mock("@/stores/project-store", () => {
  const useProjectStore = Object.assign(
    (selector: (state: typeof projectState) => unknown): unknown => selector(projectState),
    { getState: (): typeof projectState => projectState },
  );
  return { useProjectStore };
});

afterEach(() => cleanup());

beforeEach(() => {
  useFindStore.setState({
    query: "chapter",
    replacement: "",
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    replaceExpanded: false,
    matches: [],
    currentIndex: -1,
    error: null,
  });
  useSearchSurfaceStore.setState({
    activeSurface: "editor",
    openSurface: "editor",
    focusRevision: 1,
  });
});

describe("FindBar search surface integration", () => {
  it("closes editor search without discarding its query", () => {
    render(<FindBar />);
    fireEvent.click(screen.getByRole("button", { name: "Close find" }));
    expect(useSearchSurfaceStore.getState().openSurface).toBeNull();
    expect(useFindStore.getState().query).toBe("chapter");
  });

  it("does not render while PDF search is open", () => {
    useSearchSurfaceStore.setState({ openSurface: "pdf" });
    render(<FindBar />);
    expect(screen.queryByLabelText("Close find")).toBeNull();
  });
});
