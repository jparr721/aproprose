import { describe, expect, it } from "vitest";

import { AuthorProfile, type AuthorPreferences } from "@/author";

describe("AuthorProfile", () => {
  it("freezes an exact run contract while later resolutions see the injected owner's updates", () => {
    let preferences: AuthorPreferences = {
      styleGuide: "  Preserve deliberate fragments.\nUse a close viewpoint.  ",
      editingRules: "Keep the ending unresolved.",
    };
    const author = new AuthorProfile({ read: () => preferences });
    const frozen = author.resolve();
    preferences = { styleGuide: "New voice.", editingRules: "New direction." };

    expect(frozen.preferences.styleGuide).toBe("  Preserve deliberate fragments.\nUse a close viewpoint.  ");
    expect(frozen.preferences.editingRules).toBe("Keep the ending unresolved.");
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.preferences)).toBe(true);
    expect(author.resolve().preferences).toEqual(preferences);
    expect(frozen.authority).toContain("Explicit author wishes take precedence");
    expect(frozen.authority).toContain("Application integrity remains mandatory");
    expect(frozen.authority).toContain("Retain contradictions");
  });
});
