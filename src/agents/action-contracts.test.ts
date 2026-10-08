import { describe, expect, it } from "vitest";

import { AuthorProfile } from "@/author";
import { AGENT_ACTION_CONTRACTS, createPurposeAgent, purposeAgentActionSchema } from "@/agents";
import { compileAgentPolicy } from "@/lib/ai/agent-prompts";

const author = new AuthorProfile({
  read: () => ({ styleGuide: "Preserve intentional fragments.", editingRules: "Never explain the final image." }),
}).resolve();

describe("purpose-built agent policies", () => {
  it("isolates specialist authority while sharing the exact author contract", () => {
    const policies = ["writer", "literary-editor", "chapter-planner", "copyeditor", "next-beat", "character-developer"]
      .map((action) => createPurposeAgent(purposeAgentActionSchema.parse(action), author).compile({
        applicationInstructions: "APPLICATION INTEGRITY", taskInstructions: "FROZEN TASK", marker: "",
      }));

    for (const policy of policies) {
      expect(policy.instructions).toContain(author.preferences.styleGuide);
      expect(policy.instructions).toContain(author.preferences.editingRules);
      expect(policy.instructions).toContain("take precedence over specialist craft heuristics");
      expect(policy.instructions).toContain("APPLICATION INTEGRITY");
      expect(policy.instructions).toContain("FROZEN TASK");
    }
    const suggestion = policies.find((policy) => policy.action === "next-beat");
    const character = policies.find((policy) => policy.action === "character-developer");
    const planner = policies.find((policy) => policy.action === "chapter-planner");
    expect(suggestion?.capabilities).toEqual(["read-book", "analyze-chapter"]);
    expect(character?.capabilities).toEqual(["read-book", "update-character"]);
    expect(planner?.capabilities).toContain("ask-author");
    expect(planner?.capabilities).not.toContain("stage-manuscript");
    expect(planner?.stopAfterProposal).toBe(false);
  });

  it("does not let a task's selected mode turn Clean into a literary rewrite", () => {
    const policy = compileAgentPolicy({
      mode: "writing", sessionId: { kind: "project" },
      task: { kind: "selected-block-edit", chapterId: "ch1", blockIds: ["b1"], operation: "clean" },
      styleGuide: "Fragments stay.", editingRules: "Do not simplify vocabulary.",
    });
    expect(policy.action).toBe("copyeditor");
    expect(policy.instructions).toContain("Clean only the selected prose conservatively");
    expect(policy.instructions).not.toContain("Act as an exceptional literary collaborator");
    expect(policy.capabilities).toEqual(["read-book", "stage-manuscript"]);
  });

  it("gives every existing inference action a distinct versioned contract", () => {
    const versions = purposeAgentActionSchema.options.map((action) => AGENT_ACTION_CONTRACTS[action].promptVersion);
    expect(new Set(versions).size).toBe(purposeAgentActionSchema.options.length);
    expect(AGENT_ACTION_CONTRACTS["knowledge-map"].assessment).toContain("Never suppress or rewrite a source fact");
    expect(AGENT_ACTION_CONTRACTS["conversation-compactor"].assessment).toContain("Never turn compaction into approval");
    expect(AGENT_ACTION_CONTRACTS["preference-voice"].assessment).toContain("explicit Apply");
  });
});
