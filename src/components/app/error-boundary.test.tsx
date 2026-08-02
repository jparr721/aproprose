// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiConsoleErrorBoundary,
  RootErrorBoundary,
  UnexpectedErrorBoundary,
} from "@/components/app/error-boundary";

afterEach(cleanup);

function ThrowingChild(): never {
  throw new Error("Private provider response at /Users/author/private");
}

describe("unexpected render recovery", () => {
  it("isolates a failed AI Console and leaves surrounding editor content mounted", () => {
    const close = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <div>
        <div>Editor remains available</div>
        <AiConsoleErrorBoundary onClose={close}>
          <ThrowingChild />
        </AiConsoleErrorBoundary>
      </div>,
    );

    expect(screen.getByText("Editor remains available")).toBeTruthy();
    expect(screen.getByText("AI Console unavailable")).toBeTruthy();
    expect(screen.queryByText("/Users/author/private")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close AI Console" }));
    expect(close).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("offers root retry and confirms before reloading", () => {
    const reload = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <UnexpectedErrorBoundary
        context="application"
        description="Safe recovery copy"
        onClose={null}
        onReload={reload}
        title="Something went wrong"
      >
        <ThrowingChild />
      </UnexpectedErrorBoundary>,
    );

    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload app" }));
    expect(screen.getByText("Reload Aproprose?")).toBeTruthy();
    const reloadButtons = screen.getAllByRole("button", { name: "Reload app" });
    fireEvent.click(reloadButtons[reloadButtons.length - 1]);
    expect(reload).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("mounts the root fallback for uncaught descendants", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <RootErrorBoundary>
        <ThrowingChild />
      </RootErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload app" })).toBeTruthy();
    consoleError.mockRestore();
  });
});
