import { expect, it } from "vitest";
import { parseChapter } from "./parse";
import { serializeChapter } from "./serialize";

it("parses a single-beat dialogue into a one-beat tail", () => {
  const [b] = parseChapter("``I'm serious,'' Brian said.\n");
  expect(b.type).toBe("dialogue");
  expect(b.text).toBe("I'm serious,");
  expect(b.tail).toEqual([{ kind: "beat", text: "Brian said." }]);
});

it("parses a chained quote-beat-quote into an alternating tail", () => {
  const src = "``I'm serious,'' Brian said. ``You were one bad thought away.''\n";
  const [b] = parseChapter(src);
  expect(b.text).toBe("I'm serious,");
  expect(b.tail).toEqual([
    { kind: "beat", text: "Brian said." },
    { kind: "quote", text: "You were one bad thought away." },
  ]);
});

it("round-trips a chained dialogue byte-for-byte when clean", () => {
  const src = "``I'm serious,'' Brian said. ``You were one bad thought away.''\n\n";
  expect(serializeChapter(parseChapter(src))).toBe(src);
});

it("falls through to latex when two quotes have no beat between them", () => {
  const [b] = parseChapter("``A'' ``B''\n");
  expect(b.type).toBe("latex");
});
