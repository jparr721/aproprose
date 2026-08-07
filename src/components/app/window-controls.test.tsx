// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getCurrentWindow = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("Tauri window metadata is unavailable");
  }),
);

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow,
}));

vi.mock("@/lib/platform", () => ({
  IS_MAC: false,
}));

import { WindowControls } from "@/components/app/window-controls";

afterEach(cleanup);

describe("WindowControls browser preview", () => {
  it("does not access native window APIs outside Tauri", () => {
    expect(() => render(<WindowControls />)).not.toThrow();
    expect(getCurrentWindow).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
