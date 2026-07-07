import { describe, expect, it } from "vitest";
import { structurePassage } from "./structure";

const DUMP = `Brian said. "You were one bad thought away from texting the cops yourself."

David snorted. "He's not wrong."

Terrence looked at them both, then down at the backpack. "I hate that I know you're trying to help."`;

describe("structurePassage on the reported Muse dump", () => {
  it("produces one block per paragraph unit, dialogue where quoted", () => {
    const cast = [
      { id: "c-brian", name: "Brian", color: "#000", role: "" },
      { id: "c-david", name: "David", color: "#000", role: "" },
      { id: "c-terrence", name: "Terrence", color: "#000", role: "" },
    ];
    const blocks = structurePassage(DUMP, cast);
    // Each paragraph: leading narration tag + a dialogue block.
    const types = blocks.map((b) => b.type);
    expect(types).toEqual([
      "narration", "dialogue",
      "narration", "dialogue",
      "narration", "dialogue",
    ]);
    expect(blocks[1].speaker).toBe("c-brian");
    expect(blocks[3].speaker).toBe("c-david");
    expect(blocks[5].speaker).toBe("c-terrence");
  });
});
