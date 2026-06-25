import { describe, it, expect } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { renderInline } from "./inline";

// renderInline returns an array of nodes (strings/Fragments/elements). Pull the
// tag name and first child text for assertions.
function tags(node: unknown): string[] {
  const arr = Array.isArray(node) ? node : [node];
  return arr.flatMap((n) => (isValidElement(n) ? [(n as ReactElement).type as string] : []));
}

describe("renderInline", () => {
  it("wraps bold in <strong>", () => {
    const out = renderInline("a **b** c");
    expect(tags(out)).toContain("strong");
  });

  it("wraps italic in <em>", () => {
    const out = renderInline("a _b_ c");
    expect(tags(out)).toContain("em");
  });

  it("nests bold over italic", () => {
    const out = renderInline("**_x_**") as ReactElement[];
    const strong = out.find((n) => isValidElement(n) && n.type === "strong") as ReactElement;
    expect(strong).toBeDefined();
    expect(tags(strong.props.children)).toContain("em");
  });
});
