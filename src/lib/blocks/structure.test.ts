import { describe, expect, it } from "vitest";
import type { Character } from "@/lib/types";
import { parseChapter } from "@/lib/latex/parse";
import { serializeChapter } from "@/lib/latex/serialize";
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

  it("builds a chained dialogue block from quote-beat-quote", () => {
    const [b] = structurePassage('"I\'m serious," Brian said. "You were one bad thought away."', noCast);
    expect(b.type).toBe("dialogue");
    expect(b.text).toBe("I'm serious,");
    expect(b.tail).toEqual([
      { kind: "beat", text: "Brian said." },
      { kind: "quote", text: "You were one bad thought away." },
    ]);
  });

  it("infers the speaker from a cast name in the beat", () => {
    const cast = [{ id: "c-brian", name: "Brian", color: "#000", role: "" }];
    const [b] = structurePassage('"All right," Brian said. "Start with this."', cast);
    expect(b.speaker).toBe("c-brian");
  });

  it("infers the speaker from a leading tag that was split off", () => {
    const cast = [{ id: "c-brian", name: "Brian", color: "#000", role: "" }];
    const blocks = structurePassage('Brian said. "You were one bad thought away."', cast);
    expect(blocks[1].speaker).toBe("c-brian");
  });

  it("leaves the speaker unset when no cast name matches", () => {
    const cast = [{ id: "c-brian", name: "Brian", color: "#000", role: "" }];
    const [b] = structurePassage('"He is not wrong."', cast);
    expect(b.speaker).toBeUndefined();
  });
});

describe("structurePassage - adjacent quotes with no beat between them", () => {
  it("never emits a dialogue tail that starts with a quote", () => {
    const blocks = structurePassage('Brian turned. "Stop," "Now."', noCast);
    const b = blocks[1];
    expect(b.type).toBe("dialogue");
    if (b.tail !== undefined && b.tail.length > 0) {
      expect(b.tail[0].kind).toBe("beat");
    }
  });

  it("coalesces the two adjacent quote bodies into one quote, space-joined", () => {
    const blocks = structurePassage('Brian turned. "Stop," "Now."', noCast);
    const b = blocks[1];
    expect(b.type).toBe("dialogue");
    expect(b.text).toBe("Stop, Now.");
    expect(b.tail).toBeUndefined();
  });

  it("round-trips as dialogue (not latex) through serialize/parse", () => {
    const blocks = structurePassage('Brian turned. "Stop," "Now."', noCast).map((b) => ({
      ...b,
      dirty: true,
    }));
    const reparsed = parseChapter(serializeChapter(blocks));
    expect(reparsed.map((b) => b.type)).toEqual(blocks.map((b) => b.type));
    expect(reparsed.map((b) => b.type)).toContain("dialogue");
    expect(reparsed.map((b) => b.type)).not.toContain("latex");
  });

  it("leaves a normal chained dialogue (beat between quotes) unaffected", () => {
    const [b] = structurePassage('"I\'m serious," Brian said. "You were close."', noCast);
    expect(b.type).toBe("dialogue");
    expect(b.text).toBe("I'm serious,");
    expect(b.tail).toEqual([
      { kind: "beat", text: "Brian said." },
      { kind: "quote", text: "You were close." },
    ]);

    const blocks = [{ ...b, dirty: true }];
    const reparsed = parseChapter(serializeChapter(blocks));
    expect(reparsed[0].type).toBe("dialogue");
  });
});

describe("structurePassage - malformed quotes", () => {
  it("keeps quote-first text with no closing quote as narration", () => {
    const [b] = structurePassage('"Wait for it', noCast);
    expect(b.type).toBe("narration");
    expect(b.text).toBe('"Wait for it');
  });

  it("keeps leading text with no closing quote together as narration", () => {
    const [b] = structurePassage('Brian said, "Wait for it', noCast);
    expect(b.type).toBe("narration");
    expect(b.text).toBe('Brian said, "Wait for it');
  });
});
