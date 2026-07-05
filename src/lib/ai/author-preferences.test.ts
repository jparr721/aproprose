import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

import { authorSystem } from "@/lib/ai/author-preferences";
import { useSettingsStore } from "@/stores/settings-store";

beforeEach(() => useSettingsStore.setState({ styleGuide: "", editingRules: "" }));

describe("authorSystem", () => {
  it("returns the base unchanged when both preferences are empty", () => {
    expect(authorSystem("BASE", "voice+editing")).toBe("BASE");
  });

  it("appends the voice block for both scopes when styleGuide is set", () => {
    useSettingsStore.setState({ styleGuide: "Gibson voice" });
    expect(authorSystem("BASE", "voice")).toContain("AUTHOR VOICE");
    expect(authorSystem("BASE", "voice")).toContain("Gibson voice");
    expect(authorSystem("BASE", "voice+editing")).toContain("AUTHOR VOICE");
  });

  it("appends editing rules only for the voice+editing scope", () => {
    useSettingsStore.setState({ editingRules: "No adverbs" });
    expect(authorSystem("BASE", "voice")).not.toContain("AUTHOR EDITING RULES");
    expect(authorSystem("BASE", "voice+editing")).toContain("AUTHOR EDITING RULES");
    expect(authorSystem("BASE", "voice+editing")).toContain("No adverbs");
  });

  it("keeps the base prompt first", () => {
    useSettingsStore.setState({ styleGuide: "V" });
    expect(authorSystem("BASE", "voice").startsWith("BASE")).toBe(true);
  });
});
