// @vitest-environment happy-dom
//
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContextAnchor, type AnchorMode } from "@/components/app/right-panel/context-anchor";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useProjectStore } from "@/stores/project-store";

const renderAnchor = (mode: AnchorMode) =>
  render(
    <TooltipProvider>
      <ContextAnchor mode={mode} />
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
  it("anchors to the cursor block in cursor mode", () => {
    renderAnchor("cursor");
    expect(screen.getByText("Continuing after narration")).toBeTruthy();
    expect(screen.getByText("The door creaked open.")).toBeTruthy();
  });

  it("anchors to the whole chapter (not the cursor) in chapter mode", () => {
    renderAnchor("chapter");
    // The cursor is irrelevant when the op only reviews the whole chapter, so the
    // anchor must not claim to continue after the selected block.
    expect(screen.queryByText(/continuing after/i)).toBeNull();
    expect(screen.getByText("Whole chapter")).toBeTruthy();
    expect(screen.getByText("What the Letter Said")).toBeTruthy();
  });

  it("shows both the whole-chapter read and the insertion point in chapter-insert mode", () => {
    renderAnchor("chapter-insert");
    // Suggest reads the whole chapter but still inserts after the caret block, so
    // the eyebrow names the read scope while the body names where the block lands.
    expect(screen.getByText("Whole chapter")).toBeTruthy();
    expect(screen.getByText("Continues after narration - The door creaked open.")).toBeTruthy();
    // The go-to-block affordance stays available since there is an insertion anchor.
    expect(screen.getByLabelText("Scroll to block in editor")).toBeTruthy();
  });

  it("anchors to an explicit anchor block over the live selection", () => {
    // Suggest freezes a chapter-scope continuation to the block it was generated
    // against, so the anchor must name that block even after the caret moves away.
    useProjectStore.setState({
      selectedId: "b2",
      blocks: [
        { id: "b1", type: "narration", text: "The door creaked open." },
        { id: "b2", type: "narration", text: "She turned the key." },
      ],
    } as never);
    render(
      <TooltipProvider>
        <ContextAnchor mode="chapter-insert" anchorId="b1" />
      </TooltipProvider>,
    );
    expect(
      screen.getByText("Continues after narration - The door creaked open."),
    ).toBeTruthy();
    expect(screen.queryByText(/She turned the key\./)).toBeNull();
  });
});
