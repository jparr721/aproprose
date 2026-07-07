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
    tail: [{ kind: "beat", text: "She looked away." }],
    speaker: "c-suspect",
  });
  const [reparsed] = save([block]);
  expect(reparsed.speaker).toBe("c-suspect");
  expect(reparsed.text).toBe("I was home.");
  expect(reparsed.tail).toEqual([{ kind: "beat", text: "She looked away." }]);
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

test("a freeform break round-trips its text", () => {
  for (const text of ["* * *", "Interlude", "INTERLUDE"]) {
    const [reparsed] = save([dirty({ type: "chapter", level: "break", text })]);
    expect(reparsed.type).toBe("chapter");
    expect(reparsed.level).toBe("break");
    expect(reparsed.text).toBe(text);
  }
});

test("a bold-wrapped centered line is a scene heading", () => {
  const [reparsed] = save([dirty({ type: "chapter", level: "scene", text: "Chapter One" })]);
  expect(reparsed.level).toBe("scene");
  expect(reparsed.text).toBe("Chapter One");
});

test("re-saving an existing star break is byte-identical", () => {
  const src = "\\begin{center}\n* * *\n\\end{center}\n";
  expect(serializeChapter(parseChapter(src))).toBe(src);
});

test("bold containing an underscore round-trips (underscore renders italic)", () => {
  const [reparsed] = save([dirty({ text: "**it's_a_trap**" })]);
  expect(reparsed.type).toBe("narration");
  expect(reparsed.text).toBe("**it's_a_trap**");
});

test("a freeform break with a LaTeX special round-trips", () => {
  const [reparsed] = save([dirty({ type: "chapter", level: "break", text: "50% done" })]);
  expect(reparsed.level).toBe("break");
  expect(reparsed.text).toBe("50% done");
});

// Chapter blocks are plain centered text, not prose: `**`/`_` are literal, never
// \textbf/\emph. This keeps a break disjoint from a scene heading (the only thing
// the parser reads as a scene is a whole-body \textbf), so break text can never
// masquerade as a scene and flip its level or corrupt.

test("an empty break round-trips as a break (canonical separator)", () => {
  const [reparsed] = save([dirty({ type: "chapter", level: "break", text: "" })]);
  expect(reparsed.type).toBe("chapter");
  expect(reparsed.level).toBe("break");
  expect(reparsed.text).toBe("* * *");
});

test("a fully-bold break stays a break, not a scene heading", () => {
  const [reparsed] = save([dirty({ type: "chapter", level: "break", text: "**Interlude**" })]);
  expect(reparsed.type).toBe("chapter");
  expect(reparsed.level).toBe("break");
  expect(reparsed.text).toBe("**Interlude**");
});

test("a break with multiple bold spans stays a break and keeps its text", () => {
  const [reparsed] = save([dirty({ type: "chapter", level: "break", text: "a **b** c" })]);
  expect(reparsed.level).toBe("break");
  expect(reparsed.text).toBe("a **b** c");
});

test("a scene heading with markdown markers keeps them literal", () => {
  const [reparsed] = save([dirty({ type: "chapter", level: "scene", text: "**One**" })]);
  expect(reparsed.level).toBe("scene");
  expect(reparsed.text).toBe("**One**");
});

test("an unedited scene heading round-trips byte-identical", () => {
  const src = "\\begin{center}\n\\textbf{Chapter One}\n\\end{center}\n";
  expect(serializeChapter(parseChapter(src))).toBe(src);
});

test("an edited scene heading with inner emphasis round-trips byte-exact", () => {
  // Chapter labels are plain: a hand-authored \emph inside a heading must survive
  // a no-op edit unchanged, not be reinterpreted as `_x_` and escaped away.
  const src = "\\begin{center}\n\\textbf{The \\emph{Real} End}\n\\end{center}\n";
  const [parsed] = parseChapter(src);
  expect(parsed.level).toBe("scene");
  expect(serializeChapter([{ ...parsed, dirty: true }])).toBe(src);
});

test("two adjacent \\textbf spans are a break, not a corrupted scene", () => {
  // Greedy classification would capture across both spans and corrupt the text.
  // The body is not a single whole-body \textbf, so it is a freeform break whose
  // raw latex is preserved verbatim (byte-exact on a no-op edit).
  const src = "\\begin{center}\n\\textbf{a} \\textbf{b}\n\\end{center}\n";
  const [reparsed] = parseChapter(src);
  expect(reparsed.type).toBe("chapter");
  expect(reparsed.level).toBe("break");
  expect(serializeChapter([{ ...reparsed, dirty: true }])).toBe(src);
});
