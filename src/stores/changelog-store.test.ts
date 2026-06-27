import { describe, it, expect, beforeEach } from "vitest";
import { useChangelogStore } from "@/stores/changelog-store";

const reset = () => useChangelogStore.setState({ isOpen: false, incoming: null });

describe("changelog store", () => {
  beforeEach(reset);

  it("opens with incoming notes", () => {
    useChangelogStore
      .getState()
      .open({ version: "0.4.0", notes: { summary: "s", highlights: ["a"] } });
    const s = useChangelogStore.getState();
    expect(s.isOpen).toBe(true);
    expect(s.incoming?.version).toBe("0.4.0");
  });

  it("opens without incoming (menu/settings entry)", () => {
    useChangelogStore.getState().open(null);
    expect(useChangelogStore.getState().isOpen).toBe(true);
    expect(useChangelogStore.getState().incoming).toBeNull();
  });

  it("closes", () => {
    useChangelogStore.getState().open(null);
    useChangelogStore.getState().close();
    expect(useChangelogStore.getState().isOpen).toBe(false);
  });
});
