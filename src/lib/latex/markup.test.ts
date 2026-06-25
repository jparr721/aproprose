import { describe, it, expect } from "vitest";
import { parseInline } from "./markup";

describe("parseInline", () => {
  it("parses a bold span", () => {
    expect(parseInline("a **b** c")).toEqual([
      { kind: "text", value: "a " },
      { kind: "bold", children: [{ kind: "text", value: "b" }] },
      { kind: "text", value: " c" },
    ]);
  });

  it("parses an italic span", () => {
    expect(parseInline("a _b_ c")).toEqual([
      { kind: "text", value: "a " },
      { kind: "italic", children: [{ kind: "text", value: "b" }] },
      { kind: "text", value: " c" },
    ]);
  });

  it("nests bold over italic", () => {
    expect(parseInline("**_x_**")).toEqual([
      { kind: "bold", children: [{ kind: "italic", children: [{ kind: "text", value: "x" }] }] },
    ]);
  });

  it("nests italic over bold", () => {
    expect(parseInline("_**x**_")).toEqual([
      { kind: "italic", children: [{ kind: "bold", children: [{ kind: "text", value: "x" }] }] },
    ]);
  });

  it("leaves an unmatched marker literal", () => {
    expect(parseInline("a ** b")).toEqual([{ kind: "text", value: "a ** b" }]);
    expect(parseInline("a __ b")).toEqual([{ kind: "text", value: "a __ b" }]);
  });

  it("does not create empty spans", () => {
    expect(parseInline("****")).toEqual([{ kind: "text", value: "****" }]);
  });

  it("parses adjacent spans", () => {
    expect(parseInline("**a**_b_")).toEqual([
      { kind: "bold", children: [{ kind: "text", value: "a" }] },
      { kind: "italic", children: [{ kind: "text", value: "b" }] },
    ]);
  });

  it("uses the first closer for italic (shortest match)", () => {
    expect(parseInline("_a_b_")).toEqual([
      { kind: "italic", children: [{ kind: "text", value: "a" }] },
      { kind: "text", value: "b_" },
    ]);
  });

  it("uses the first closer for bold, leaving a trailing star literal", () => {
    expect(parseInline("**foo***")).toEqual([
      { kind: "bold", children: [{ kind: "text", value: "foo" }] },
      { kind: "text", value: "*" },
    ]);
  });
});
