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
        className={undefined}
      />,
    );

    const addition = screen.getByText("shone.");
    expect(addition.tagName).toBe("INS");
    expect(addition.className).toBe("bg-success/10 no-underline");

    const deletion = screen.getByText("slept.");
    expect(deletion.tagName).toBe("DEL");
    expect(deletion.className).toContain("bg-destructive/10");
    expect(deletion.className).toContain("text-destructive");
  });

  it("drops the prose flow margin so a card's gap owns the spacing", () => {
    render(
      <AgentDiffPreview
        before="The harbor slept."
        after="The harbor shone."
        className={undefined}
      />,
    );

    const paragraph = screen.getByText("shone.").closest("p");
    expect(paragraph?.className).toContain("[&:not(:first-child)]:mt-0");
    expect(paragraph?.className).not.toContain("[&:not(:first-child)]:mt-6");
  });
});
