// @vitest-environment happy-dom
//
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContextAnchor } from "@/components/app/right-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useProjectStore } from "@/stores/project-store";

const renderAnchor = (wholeChapter: boolean) =>
  render(
    <TooltipProvider>
      <ContextAnchor wholeChapter={wholeChapter} />
    </TooltipProvider>,
  );

afterEach(() => cleanup());

beforeEach(() => {
  useProjectStore.setState({
    project: {
      root: "/x", name: "n", mainFile: "m", title: null, author: null,
      metadata: { title: "", subtitle: "", author: "", publisher: "", isbn: "" },
      chapters: [{ id: "ch1", label: "1", title: "What the Letter Said", file: "a.tex", wordCount: 10 }],
    },
    activeChapterId: "ch1",
    selectedId: "b1",
    blocks: [{ id: "b1", type: "narration", text: "The door creaked open." }],
  } as never);
});

describe("ContextAnchor", () => {
  it("anchors to the cursor block in cursor scope", () => {
    renderAnchor(false);
    expect(screen.getByText("Continuing after narration")).toBeTruthy();
    expect(screen.getByText("The door creaked open.")).toBeTruthy();
  });

  it("anchors to the whole chapter (not the cursor) in chapter scope", () => {
    renderAnchor(true);
    // The cursor is irrelevant when the op reads the whole chapter, so the
    // anchor must not claim to continue after the selected block.
    expect(screen.queryByText(/continuing after/i)).toBeNull();
    expect(screen.getByText("Whole chapter")).toBeTruthy();
    expect(screen.getByText("What the Letter Said")).toBeTruthy();
  });
});
