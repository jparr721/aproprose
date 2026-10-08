// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceTab } from "@/components/app/settings/appearance-tab";
import { useSettingsStore } from "@/stores/settings-store";

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

beforeEach(() => useSettingsStore.setState({ theme: "light", proseSize: 18 }));
afterEach(cleanup);

describe("Appearance field semantics", () => {
  it("names the prose slider and color choice group", () => {
    render(<AppearanceTab />);
    expect(screen.getByRole("slider", { name: "Prose size" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Color theme" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sepia" }));
    expect(useSettingsStore.getState().theme).toBe("sepia");
  });
});
