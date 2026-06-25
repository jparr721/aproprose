// round-trip.test.ts — the latex layer's persistence contract.
//
// The save path is serialize → write file → re-parse → replace blocks
// (project-store.saveChapter). Anything a block carries that isn't written to the
// LaTeX source is therefore silently dropped on every save. These tests pin that
// round-trip for the fields the editor mutates.

import { test, expect } from "vitest";
import type { Block } from "@/lib/types";
import { parseChapter } from "./parse";
import { serializeChapter } from "./serialize";

/** A dirty block as the editor produces it (no prior `raw`). */
function dirty(partial: Partial<Block>): Block {
  return { id: "x", type: "narration", text: "", raw: "", dirty: true, ...partial };
}

/** Save = serialize then re-parse, exactly as project-store.saveChapter does. */
function save(blocks: Block[]): Block[] {
  return parseChapter(serializeChapter(blocks));
}

test("a dialogue speaker survives a save round-trip", () => {
  const block = dirty({ type: "dialogue", text: "Where were you?", speaker: "c-marlow" });
  const [reparsed] = save([block]);
  expect(reparsed.type).toBe("dialogue");
  expect(reparsed.text).toBe("Where were you?");
  expect(reparsed.speaker).toBe("c-marlow");
});

test("a dialogue speaker survives alongside an action beat", () => {
  const block = dirty({
    type: "dialogue",
    text: "I was home.",
    beat: "She looked away.",
    speaker: "c-suspect",
  });
  const [reparsed] = save([block]);
  expect(reparsed.speaker).toBe("c-suspect");
  expect(reparsed.text).toBe("I was home.");
  expect(reparsed.beat).toBe("She looked away.");
});

test("a speaker-less dialogue round-trips with no stray speaker", () => {
  const block = dirty({ type: "dialogue", text: "Hello." });
  const [reparsed] = save([block]);
  expect(reparsed.type).toBe("dialogue");
  expect(reparsed.speaker).toBeUndefined();
});

test("re-saving an unedited parsed chapter is byte-identical", () => {
  const src = '% @speaker: c-marlow\n``Where were you?\'\'\n\nPlain narration.\n';
  expect(serializeChapter(parseChapter(src))).toBe(src);
});

test("bold survives a save round-trip and stays narration", () => {
  const [reparsed] = save([dirty({ text: "He said **stop**." })]);
  expect(reparsed.type).toBe("narration");
  expect(reparsed.text).toBe("He said **stop**.");
});

test("bold wrapping italic round-trips", () => {
  const [reparsed] = save([dirty({ text: "a **_b_** c" })]);
  expect(reparsed.type).toBe("narration");
  expect(reparsed.text).toBe("a **_b_** c");
});

test("italic wrapping bold round-trips", () => {
  const [reparsed] = save([dirty({ text: "_**x**_" })]);
  expect(reparsed.text).toBe("_**x**_");
});

test("a space-delimited number alongside emphasis is untouched", () => {
  const [reparsed] = save([dirty({ text: "the year _1984_ and 3 stars" })]);
  expect(reparsed.text).toBe("the year _1984_ and 3 stars");
});
