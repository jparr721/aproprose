import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));
vi.mock("@/lib/ai/model", () => ({ getModel: vi.fn().mockResolvedValue({}) }));

const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText };
});

import { editBlocks, reviseChapter } from "@/lib/ai/operations";
import { useSettingsStore } from "@/stores/settings-store";

const block = { id: "b1", type: "narration" as const, text: "t" };

beforeEach(() => {
  generateText.mockReset();
  useSettingsStore.setState({ styleGuide: "Gibson voice", editingRules: "No adverbs" });
});

describe("author preferences reach the model system prompt", () => {
  it("editBlocks injects both the voice and the editing blocks", async () => {
    generateText.mockResolvedValueOnce({ output: { edits: [] } });
    await editBlocks({ chapterId: "ch1", blocks: [block], instruction: "tighten" });
    const system = generateText.mock.calls[0][0].system as string;
    expect(system).toContain("AUTHOR VOICE");
    expect(system).toContain("Gibson voice");
    expect(system).toContain("AUTHOR EDITING RULES");
    expect(system).toContain("No adverbs");
  });

  it("reviseChapter injects voice only, not the editing rules", async () => {
    generateText.mockResolvedValueOnce({ output: { summary: "s", changes: [] } });
    await reviseChapter({ chapterId: "ch1", blocks: [block], instruction: "go" });
    const system = generateText.mock.calls[0][0].system as string;
    expect(system).toContain("AUTHOR VOICE");
    expect(system).not.toContain("AUTHOR EDITING RULES");
  });
});
