import { describe, it, expect } from "vitest";
import { diffWords } from "@/lib/diff/word-diff";

describe("diffWords", () => {
  it("returns a single same segment for identical text", () => {
    expect(diffWords("the cat sat", "the cat sat")).toEqual([
      { type: "same", text: "the cat sat" },
    ]);
  });

  it("marks a single word swap as del then add", () => {
    expect(diffWords("the cat sat", "the dog sat")).toEqual([
      { type: "same", text: "the " },
      { type: "del", text: "cat " },
      { type: "add", text: "dog " },
      { type: "same", text: "sat" },
    ]);
  });

  it("marks a pure insertion as an add segment", () => {
    expect(diffWords("a c", "a b c")).toEqual([
      { type: "same", text: "a " },
      { type: "add", text: "b " },
      { type: "same", text: "c" },
    ]);
  });

  it("marks a pure deletion as a del segment", () => {
    expect(diffWords("a b c", "a c")).toEqual([
      { type: "same", text: "a " },
      { type: "del", text: "b " },
      { type: "same", text: "c" },
    ]);
  });

  it("handles empty old and empty new", () => {
    expect(diffWords("", "abc")).toEqual([{ type: "add", text: "abc" }]);
    expect(diffWords("abc", "")).toEqual([{ type: "del", text: "abc" }]);
  });
});
