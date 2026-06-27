import { describe, it, expect } from "vitest";
import { parseUpdateNotes, buildReleaseBody, CHANGELOG } from "@/lib/changelog";

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

  it("keeps every non-bullet line in the summary (lossless)", () => {
    expect(parseUpdateNotes("Line one.\nLine two.\n\n- Added X")).toEqual({
      summary: "Line one. Line two.",
      highlights: ["Added X"],
    });
  });

  it("strips CRLF carriage returns", () => {
    expect(parseUpdateNotes("Headline.\r\n\r\n- Added X\r\n- Fixed Y")).toEqual({
      summary: "Headline.",
      highlights: ["Added X", "Fixed Y"],
    });
  });
});

describe("buildReleaseBody / parseUpdateNotes round-trip", () => {
  it("emits the summary, a blank line, then dash bullets", () => {
    expect(buildReleaseBody({ summary: "Big release.", highlights: ["Added X", "Fixed Y"] })).toBe(
      "Big release.\n\n- Added X\n- Fixed Y",
    );
  });

  it("parseUpdateNotes is the exact inverse of buildReleaseBody", () => {
    const notes = { summary: "Big release.", highlights: ["Added X", "Fixed Y"] };
    expect(parseUpdateNotes(buildReleaseBody(notes))).toEqual(notes);
  });

  it("round-trips an empty summary", () => {
    const notes = { summary: "", highlights: ["Only this"] };
    expect(parseUpdateNotes(buildReleaseBody(notes))).toEqual(notes);
  });
});

describe("CHANGELOG", () => {
  it("is a non-empty array of entries", () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    expect(typeof CHANGELOG[0].version).toBe("string");
  });
});
