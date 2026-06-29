import { describe, it, expect } from "vitest";
import { findMatches, replaceOne, replaceAllEdits, type FindOptions } from "./find";

// Minimal block shape the matcher reads.
type TextBlock = { id: string; text: string };

const opts = (o: Partial<FindOptions>): FindOptions => ({
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  ...o,
});

describe("findMatches", () => {
  it("finds literal matches across blocks in document then offset order", () => {
    const blocks: TextBlock[] = [
      { id: "a", text: "the cat sat" },
      { id: "b", text: "cat and cat" },
    ];
    const { matches, error } = findMatches(blocks, "cat", opts({}));
    expect(error).toBeNull();
    expect(matches).toEqual([
      { blockId: "a", start: 4, end: 7 },
      { blockId: "b", start: 0, end: 3 },
      { blockId: "b", start: 8, end: 11 },
    ]);
  });

  it("is case-insensitive by default", () => {
    const { matches } = findMatches([{ id: "a", text: "Cat cat CAT" }], "cat", opts({}));
    expect(matches).toHaveLength(3);
  });

  it("honors caseSensitive", () => {
    const { matches } = findMatches(
      [{ id: "a", text: "Cat cat CAT" }],
      "cat",
      opts({ caseSensitive: true }),
    );
    expect(matches).toEqual([{ blockId: "a", start: 4, end: 7 }]);
  });

  it("honors wholeWord (no substring matches)", () => {
    const { matches } = findMatches(
      [{ id: "a", text: "cat category cat" }],
      "cat",
      opts({ wholeWord: true }),
    );
    expect(matches).toEqual([
      { blockId: "a", start: 0, end: 3 },
      { blockId: "a", start: 13, end: 16 },
    ]);
  });

  it("matches regex patterns", () => {
    const { matches } = findMatches(
      [{ id: "a", text: "a1 b2 c3" }],
      "[a-z]\\d",
      opts({ regex: true }),
    );
    expect(matches).toHaveLength(3);
  });

  it("does not hang on zero-length regex matches and skips them", () => {
    // `x*` matches the empty string at every position of "aaa"; all matches are
    // zero-length, so none are reported and the scan terminates.
    const { matches, error } = findMatches(
      [{ id: "a", text: "aaa" }],
      "x*",
      opts({ regex: true }),
    );
    expect(error).toBeNull();
    expect(matches).toEqual([]);
  });

  it("returns an error and no matches for an invalid regex", () => {
    const { matches, error } = findMatches(
      [{ id: "a", text: "abc" }],
      "(",
      opts({ regex: true }),
    );
    expect(matches).toEqual([]);
    expect(error).toBeTruthy();
  });

  it("treats regex metacharacters literally when regex is off", () => {
    const { matches } = findMatches([{ id: "a", text: "a.b a.b" }], "a.b", opts({}));
    expect(matches).toEqual([
      { blockId: "a", start: 0, end: 3 },
      { blockId: "a", start: 4, end: 7 },
    ]);
  });

  it("returns no matches and no error for an empty query", () => {
    const { matches, error } = findMatches([{ id: "a", text: "abc" }], "", opts({}));
    expect(matches).toEqual([]);
    expect(error).toBeNull();
  });
});

describe("replaceOne", () => {
  it("splices a literal replacement at the match range", () => {
    const out = replaceOne("the cat sat", { start: 4, end: 7 }, "cat", "dog", opts({}));
    expect(out).toBe("the dog sat");
  });

  it("treats $ in a literal replacement verbatim", () => {
    const out = replaceOne("price x", { start: 6, end: 7 }, "x", "$1", opts({}));
    expect(out).toBe("price $1");
  });

  it("expands capture groups in regex mode", () => {
    const out = replaceOne(
      "John Smith",
      { start: 0, end: 10 },
      "(\\w+) (\\w+)",
      "$2 $1",
      opts({ regex: true }),
    );
    expect(out).toBe("Smith John");
  });
});

describe("replaceAllEdits", () => {
  it("returns one edit per changed block, skipping unchanged blocks", () => {
    const blocks: TextBlock[] = [
      { id: "a", text: "cat cat" },
      { id: "b", text: "dog" },
      { id: "c", text: "a cat" },
    ];
    const edits = replaceAllEdits(blocks, "cat", "fox", opts({}));
    expect(edits).toEqual([
      { id: "a", text: "fox fox" },
      { id: "c", text: "a fox" },
    ]);
  });

  it("expands capture groups across all matches in regex mode", () => {
    const edits = replaceAllEdits(
      [{ id: "a", text: "a1 b2" }],
      "([a-z])(\\d)",
      "$2$1",
      opts({ regex: true }),
    );
    expect(edits).toEqual([{ id: "a", text: "1a 2b" }]);
  });

  it("treats $ in a literal replacement verbatim", () => {
    const edits = replaceAllEdits([{ id: "a", text: "x x" }], "x", "$&", opts({}));
    expect(edits).toEqual([{ id: "a", text: "$& $&" }]);
  });
});
