import { describe, it, expect } from "vitest";
import { parseUpdateNotes, CHANGELOG } from "@/lib/changelog";

describe("parseUpdateNotes", () => {
  it("splits a release body into summary + highlights", () => {
    const body = "Big release.\n\n- Added X\n- Fixed Y";
    expect(parseUpdateNotes(body)).toEqual({
      summary: "Big release.",
      highlights: ["Added X", "Fixed Y"],
    });
  });

  it("handles a body with only bullets", () => {
    expect(parseUpdateNotes("- Only this")).toEqual({
      summary: "",
      highlights: ["Only this"],
    });
  });

  it("returns empty fields for an empty body", () => {
    expect(parseUpdateNotes("")).toEqual({ summary: "", highlights: [] });
  });
});

describe("CHANGELOG", () => {
  it("is a non-empty array of entries", () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    expect(typeof CHANGELOG[0].version).toBe("string");
  });
});
