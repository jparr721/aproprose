import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

import {
  authorSystem,
  renderEditingPreference,
  renderVoicePreference,
} from "@/lib/ai/author-preferences";
import { PREFERENCE_MAX_CHARS } from "@/lib/types";
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

describe("renderVoicePreference", () => {
  it("returns an empty string for empty or whitespace-only input", () => {
    expect(renderVoicePreference("")).toBe("");
    expect(renderVoicePreference("   \n  ")).toBe("");
  });

  it("wraps non-empty input in a trimmed author voice block", () => {
    const output = renderVoicePreference("  Terse, tech-noir.  ");
    expect(output).toContain("AUTHOR VOICE");
    expect(output).toContain("Terse, tech-noir.");
    expect(output).not.toMatch(/^\s/);
    expect(output).not.toMatch(/\s$/);
  });

  it("clamps to the preference length limit", () => {
    const output = renderVoicePreference(
      "x".repeat(PREFERENCE_MAX_CHARS + 1_000),
    );
    expect(output).toContain("x".repeat(PREFERENCE_MAX_CHARS));
    expect(output).not.toContain("x".repeat(PREFERENCE_MAX_CHARS + 1));
  });
});

describe("renderEditingPreference", () => {
  it("returns an empty string for blank input", () => {
    expect(renderEditingPreference("   ")).toBe("");
  });

  it("wraps non-empty input in an author editing rules block", () => {
    const output = renderEditingPreference("No adverbs.");
    expect(output).toContain("AUTHOR EDITING RULES");
    expect(output).toContain("No adverbs.");
  });
});
