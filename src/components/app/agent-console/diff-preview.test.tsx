// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentDiffPreview } from "@/components/app/agent-console/diff-preview";

afterEach(() => cleanup());

describe("AgentDiffPreview", () => {
  it("uses a success tint without a solid-success foreground token", () => {
    render(
      <AgentDiffPreview
        before="The harbor slept."
        after="The harbor shone."
      />,
    );

    const addition = screen.getByText("shone.");
    expect(addition.tagName).toBe("INS");
    expect(addition.className).toContain("bg-success/10");
    expect(addition.className).not.toContain("text-success-foreground");
    expect(addition.className).not.toContain("text-success");

    const deletion = screen.getByText("slept.");
    expect(deletion.tagName).toBe("DEL");
    expect(deletion.className).toContain("bg-destructive/10");
    expect(deletion.className).toContain("text-destructive");
  });
});
