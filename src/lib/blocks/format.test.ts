import { describe, it, expect } from "vitest";
import { toggleInlineWrap } from "./format";

describe("toggleInlineWrap", () => {
  it("wraps a selection and keeps the inner selected", () => {
    // "abc", select "b" (1..2), bold
    expect(toggleInlineWrap({ text: "abc", start: 1, end: 2 }, "**")).toEqual({ text: "a**b**c", start: 3, end: 4 });
  });

  it("wraps with the italic marker", () => {
    expect(toggleInlineWrap({ text: "abc", start: 1, end: 2 }, "_")).toEqual({ text: "a_b_c", start: 2, end: 3 });
  });

  it("unwraps when the markers are inside the selection", () => {
    // select "**b**" (1..6)
    expect(toggleInlineWrap({ text: "a**b**c", start: 1, end: 6 }, "**")).toEqual({ text: "abc", start: 1, end: 2 });
  });

  it("unwraps when the markers sit just outside the selection", () => {
    // select "b" (3..4) of "a**b**c"
    expect(toggleInlineWrap({ text: "a**b**c", start: 3, end: 4 }, "**")).toEqual({ text: "abc", start: 1, end: 2 });
  });

  it("inserts an empty pair with the caret between on an empty selection", () => {
    expect(toggleInlineWrap({ text: "ab", start: 1, end: 1 }, "**")).toEqual({ text: "a****b", start: 3, end: 3 });
  });

  it("wraps a selection that starts at index 0", () => {
    expect(toggleInlineWrap({ text: "abc", start: 0, end: 3 }, "**")).toEqual({ text: "**abc**", start: 2, end: 5 });
  });

  it("unwraps inside-markers when the selection starts at index 0", () => {
    expect(toggleInlineWrap({ text: "**abc**", start: 0, end: 7 }, "**")).toEqual({ text: "abc", start: 0, end: 3 });
  });

  it("clamps an out-of-range selection so the result stays in bounds", () => {
    // A stale selection wider than the text must not produce offsets past its end.
    expect(toggleInlineWrap({ text: "ab", start: 0, end: 99 }, "**")).toEqual({ text: "**ab**", start: 2, end: 4 });
  });
});
