import { describe, it, expect } from "vitest";
import { findEntry, buildReleaseBody } from "./release-body";

const VALID = {
  version: "0.4.0",
  date: "2026-06-27",
  summary: "A release.",
  highlights: ["Added X", "Fixed Y"],
};

describe("findEntry", () => {
  it("returns the matching entry", () => {
    expect(findEntry([VALID], "0.4.0")).toBe(VALID);
  });

  it("throws when no entry matches the version", () => {
    expect(() => findEntry([VALID], "9.9.9")).toThrow(/no entry for 9.9.9/);
  });

  it("throws on an entry with an empty summary", () => {
    expect(() => findEntry([{ ...VALID, summary: "  " }], "0.4.0")).toThrow(/invalid summary/);
  });

  it("throws on an entry with empty or blank highlights", () => {
    expect(() => findEntry([{ ...VALID, highlights: [] }], "0.4.0")).toThrow(/invalid highlights/);
    expect(() => findEntry([{ ...VALID, highlights: ["", " "] }], "0.4.0")).toThrow(
      /invalid highlights/,
    );
  });
});

describe("buildReleaseBody", () => {
  // This exact format is the inverse of parseUpdateNotes in src/lib/changelog.ts, pinned
  // there by a round-trip test. Keep the two in lockstep.
  it("emits the summary, a blank line, then dash bullets", () => {
    expect(buildReleaseBody(VALID)).toBe("A release.\n\n- Added X\n- Fixed Y");
  });

  it("emits a leading blank line when the summary is empty", () => {
    expect(buildReleaseBody({ summary: "", highlights: ["Only this"] })).toBe("\n\n- Only this");
  });
});
