import { describe, expect, it } from "vitest";
import type { Block } from "@/lib/types";
import { carriesTailContent, dialogueSegments, nextSegmentKind } from "./dialogue";

function dlg(text: string, tail?: Block["tail"]): Block {
  return { id: "b1", type: "dialogue", text, raw: "", dirty: true, tail };
}

describe("dialogueSegments", () => {
  it("returns just the opening quote when there is no tail", () => {
    expect(dialogueSegments(dlg("Hello"))).toEqual([{ kind: "quote", text: "Hello" }]);
  });

  it("prepends the opening quote to the tail, in order", () => {
    const b = dlg("I'm serious,", [
      { kind: "beat", text: "Brian said." },
      { kind: "quote", text: "You were one bad thought away." },
    ]);
    expect(dialogueSegments(b)).toEqual([
      { kind: "quote", text: "I'm serious," },
      { kind: "beat", text: "Brian said." },
      { kind: "quote", text: "You were one bad thought away." },
    ]);
  });
});

describe("nextSegmentKind", () => {
  it("is beat after the opening quote with no tail", () => {
    expect(nextSegmentKind(dlg("Hi"))).toBe("beat");
  });
  it("is quote after a trailing beat", () => {
    expect(nextSegmentKind(dlg("Hi", [{ kind: "beat", text: "he said." }]))).toBe("quote");
  });
  it("is beat after a trailing quote", () => {
    expect(
      nextSegmentKind(dlg("Hi", [{ kind: "beat", text: "he said." }, { kind: "quote", text: "Go." }])),
    ).toBe("beat");
  });
});

describe("carriesTailContent", () => {
  it("is false with no tail or only blank tail text", () => {
    expect(carriesTailContent(dlg("Hi"))).toBe(false);
    expect(carriesTailContent(dlg("Hi", [{ kind: "beat", text: "  " }]))).toBe(false);
  });
  it("is true when a tail segment has real text", () => {
    expect(carriesTailContent(dlg("Hi", [{ kind: "beat", text: "he said." }]))).toBe(true);
  });
});
