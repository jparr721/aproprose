// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Input } from "@/components/ui/input";

afterEach(cleanup);

describe("Input", () => {
  it("sets color scheme classes so native number controls match the theme", () => {
    render(<Input type="number" aria-label="Word count" />);
    const input = screen.getByLabelText("Word count");
    expect(input.className).toContain("scheme-light");
    expect(input.className).toContain("dark:scheme-dark");
  });
});
