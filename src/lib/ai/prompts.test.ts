import { describe, it, expect } from "vitest";
import {
  VOICE_PREAMBLE,
  MUSE_SYSTEM,
  REVISE_SYSTEM,
  renderVoicePreference,
  renderEditingPreference,
} from "@/lib/ai/prompts";

describe("VOICE_PREAMBLE italics contract", () => {
  it("tells the model that _italics_ and **bold** in the prose it reads are formatting, not errors", () => {
    expect(VOICE_PREAMBLE).toContain("_italics_");
    expect(VOICE_PREAMBLE).toContain("**bold**");
    expect(VOICE_PREAMBLE.toLowerCase()).toContain("formatting");
  });
});

describe("renderVoicePreference", () => {
  it("returns an empty string for empty or whitespace-only input", () => {
    expect(renderVoicePreference("")).toBe("");
    expect(renderVoicePreference("   \n  ")).toBe("");
  });

  it("wraps non-empty input in a trimmed AUTHOR VOICE block", () => {
    const out = renderVoicePreference("  Terse, tech-noir.  ");
    expect(out).toContain("AUTHOR VOICE");
    expect(out).toContain("Terse, tech-noir.");
    expect(out).not.toMatch(/^\s/);
    expect(out).not.toMatch(/\s$/);
  });

  it("clamps to 2000 characters", () => {
    const out = renderVoicePreference("x".repeat(3000));
    expect(out).toContain("x".repeat(2000));
    expect(out).not.toContain("x".repeat(2001));
  });
});

describe("renderEditingPreference", () => {
  it("returns an empty string for blank input", () => {
    expect(renderEditingPreference("   ")).toBe("");
  });

  it("wraps non-empty input in an AUTHOR EDITING RULES block", () => {
    const out = renderEditingPreference("No adverbs.");
    expect(out).toContain("AUTHOR EDITING RULES");
    expect(out).toContain("No adverbs.");
  });
});

describe("manuscript-change prompts require one block per unit", () => {
  it("MUSE_SYSTEM forbids blank lines inside newText", () => {
    expect(MUSE_SYSTEM).toMatch(/one block per paragraph/i);
    expect(MUSE_SYSTEM).toMatch(/never .*blank line/i);
  });
  it("REVISE_SYSTEM forbids blank lines inside newText", () => {
    expect(REVISE_SYSTEM).toMatch(/one block per paragraph/i);
  });
});
