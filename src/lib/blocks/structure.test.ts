import { describe, expect, it } from "vitest";
import type { Character } from "@/lib/types";
import { structurePassage } from "./structure";

const noCast: Character[] = [];

describe("structurePassage - paragraphs", () => {
  it("splits blank-line-separated paragraphs into blocks", () => {
    const blocks = structurePassage("First para.\n\nSecond para.", noCast);
    expect(blocks.map((b) => b.type)).toEqual(["narration", "narration"]);
    expect(blocks.map((b) => b.text)).toEqual(["First para.", "Second para."]);
    expect(blocks.every((b) => b.dirty && b.raw === "")).toBe(true);
  });

  it("classifies a quote-first paragraph as dialogue", () => {
    const [b] = structurePassage('"He is not wrong."', noCast);
    expect(b.type).toBe("dialogue");
    expect(b.text).toBe("He is not wrong.");
    expect(b.tail).toBeUndefined();
  });

  it("splits leading narration off a quote into narration + dialogue", () => {
    const blocks = structurePassage('Brian said. "You were one bad thought away."', noCast);
    expect(blocks.map((b) => b.type)).toEqual(["narration", "dialogue"]);
    expect(blocks[0].text).toBe("Brian said.");
    expect(blocks[1].text).toBe("You were one bad thought away.");
  });
});
