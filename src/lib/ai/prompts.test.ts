import { describe, it, expect } from "vitest";
import { VOICE_PREAMBLE } from "@/lib/ai/prompts";

describe("VOICE_PREAMBLE italics contract", () => {
  it("tells the model that _italics_ and **bold** in the prose it reads are formatting, not errors", () => {
    expect(VOICE_PREAMBLE).toContain("_italics_");
    expect(VOICE_PREAMBLE).toContain("**bold**");
    expect(VOICE_PREAMBLE.toLowerCase()).toContain("formatting");
  });
});
