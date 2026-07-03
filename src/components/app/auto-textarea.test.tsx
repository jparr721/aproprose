// @vitest-environment happy-dom
//
// Regression tests for the edit-mode viewport snap: entering edit mode on a
// block near the end of the chapter used to (a) mount the textarea one row
// tall, shrinking the document so the browser clamped the scroll viewport
// before the measuring effect could preserve it, and (b) let React's autoFocus
// call focus() without preventScroll, letting the browser reveal-scroll the
// field. Both showed up as the page jumping when clicking a block to edit it.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutoGrowTextarea } from "@/components/app/auto-textarea";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderInViewport(ui: React.ReactElement): { scrollTopWrites: number[] } {
  // A stand-in for the Radix ScrollArea viewport the editor mounts blocks in.
  // Any scrollTop write against it re-applies a value the browser may already
  // have clamped, which is exactly the snap being guarded against.
  const viewport = document.createElement("div");
  viewport.setAttribute("data-slot", "scroll-area-viewport");
  document.body.appendChild(viewport);
  const scrollTopWrites: number[] = [];
  Object.defineProperty(viewport, "scrollTop", {
    get: () => 100,
    set: (v: number) => {
      scrollTopWrites.push(v);
    },
  });
  render(ui, { container: viewport });
  return { scrollTopWrites };
}

describe("AutoGrowTextarea", () => {
  it("never writes the scroll viewport's scrollTop on mount", () => {
    const { scrollTopWrites } = renderInViewport(
      <AutoGrowTextarea value={"line\n".repeat(40)} onChange={() => {}} autoFocus />,
    );
    expect(scrollTopWrites).toEqual([]);
  });

  it("focuses on mount with preventScroll so the browser never reveal-scrolls", () => {
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, "focus");
    renderInViewport(<AutoGrowTextarea value="hello" onChange={() => {}} autoFocus />);
    expect(focus).toHaveBeenCalled();
    expect(focus.mock.calls.at(-1)?.[0]).toMatchObject({ preventScroll: true });
  });

  it("does not focus without autoFocus", () => {
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, "focus");
    renderInViewport(<AutoGrowTextarea value="hello" onChange={() => {}} />);
    expect(focus).not.toHaveBeenCalled();
  });

  it.each([
    ["start", 0],
    ["end", 11],
    [4, 4],
    [99, 11], // clamped to the value length
  ] as const)("places the caret at %s on mount", (caret, pos) => {
    renderInViewport(
      <AutoGrowTextarea value="hello world" onChange={() => {}} autoFocus caret={caret} />,
    );
    const el = document.querySelector("textarea");
    expect(el?.selectionStart).toBe(pos);
    expect(el?.selectionEnd).toBe(pos);
  });

  it("renders a hidden replica of the value that sizes the textarea's cell", () => {
    renderInViewport(<AutoGrowTextarea value={"one\ntwo"} onChange={() => {}} />);
    const replica = document.querySelector("[aria-hidden]");
    expect(replica?.textContent).toBe("one\ntwo ");
    // The replica sizes the grid cell; the textarea must never own its height.
    const el = document.querySelector("textarea");
    expect(el?.style.height).toBe("");
  });

  it("sizes the replica from the placeholder when the value is empty", () => {
    renderInViewport(
      <AutoGrowTextarea value="" onChange={() => {}} placeholder="What do they say?" />,
    );
    expect(document.querySelector("[aria-hidden]")?.textContent).toBe("What do they say? ");
  });
});
