import { describe, expect, it } from "vitest";
import {
  CONTINUITY_SYSTEM,
  CRITIQUE_SYSTEM,
  EDIT_MODE_MARKER,
  WRITING_MODE_MARKER,
  buildAgentInstructions,
} from "@/lib/ai/agent-prompts";

const build = (mode: "writing" | "edit") =>
  buildAgentInstructions({
    mode,
    task: { kind: "conversation", targetChapterId: "ch1" },
    styleGuide: "Close third person.",
    editingRules: "No throat-clearing.",
  });

describe("buildAgentInstructions", () => {
  it("includes exactly one Writing prompt and no Edit prompt", () => {
    const instructions = build("writing");
    expect(instructions.match(new RegExp(WRITING_MODE_MARKER, "g"))).toHaveLength(1);
    expect(instructions).not.toContain(EDIT_MODE_MARKER);
  });

  it("includes exactly one Edit prompt and no Writing prompt", () => {
    const instructions = build("edit");
    expect(instructions.match(new RegExp(EDIT_MODE_MARKER, "g"))).toHaveLength(1);
    expect(instructions).not.toContain(WRITING_MODE_MARKER);
  });

  it("applies voice and standing instructions to both modes", () => {
    for (const mode of ["writing", "edit"] as const) {
      const instructions = build(mode);
      expect(instructions).toContain("AUTHOR VOICE");
      expect(instructions).toContain("Close third person.");
      expect(instructions).toContain("AUTHOR EDITING RULES");
      expect(instructions).toContain("No throat-clearing.");
    }
  });

  it("keeps outline planning clarifying and individually reviewable", () => {
    const instructions = buildAgentInstructions({
      mode: "writing",
      task: { kind: "outline-sculpt", chapterId: "ch1" },
      styleGuide: "",
      editingRules: "",
    });

    expect(instructions).toContain("ask concise clarification questions");
    expect(instructions).toContain("initial set of plot-point ideas");
    expect(instructions).toContain("independently reviewable change");
    expect(instructions).toContain("chapter ch1");
  });
});

describe("analysis prompts", () => {
  it("preserves manuscript emphasis markers", () => {
    for (const prompt of [CRITIQUE_SYSTEM, CONTINUITY_SYSTEM]) {
      expect(prompt).toContain("_italics_");
      expect(prompt).toContain("**bold**");
      expect(prompt.toLowerCase()).toContain("formatting");
    }
  });

  it("requires findings to cite supplied block ids", () => {
    for (const prompt of [CRITIQUE_SYSTEM, CONTINUITY_SYSTEM]) {
      expect(prompt).toContain("SCENE BLOCKS");
      expect(prompt).toContain("blockIds");
      expect(prompt).toContain("[id]");
    }
  });
});
