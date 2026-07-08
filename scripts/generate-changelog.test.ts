import { describe, it, expect } from "vitest";
import {
  buildPrompt,
  parseEntry,
  prependEntry,
  stripCodeFences,
  commitRange,
  diffRange,
  openCodeArgs,
  type ChangelogEntry,
} from "./generate-changelog";

describe("generate-changelog", () => {
  it("buildPrompt includes commits, diff, and the JSON shape", () => {
    const p = buildPrompt(["feat: add X", "chore: bump dep"], "diff --git a b");
    expect(p).toContain("feat: add X");
    expect(p).toContain("- feat: add X");
    expect(p).toContain("diff --git a b");
    expect(p).toContain('"summary"');
    expect(p).toContain('"highlights"');
  });

  it("parseEntry parses a clean JSON object", () => {
    expect(parseEntry('{"summary":"New stuff","highlights":["A","B"]}')).toEqual({
      summary: "New stuff",
      highlights: ["A", "B"],
    });
  });

  it("parseEntry strips code fences and trims", () => {
    expect(parseEntry('```json\n{"summary":" Hi ","highlights":[" One "]}\n```')).toEqual({
      summary: "Hi",
      highlights: ["One"],
    });
  });

  it("parseEntry throws on non-JSON", () => {
    expect(() => parseEntry("not json at all")).toThrow(/valid JSON/);
  });

  it("parseEntry throws on an empty summary", () => {
    expect(() => parseEntry('{"summary":"  ","highlights":["A"]}')).toThrow(/summary/);
  });

  it("parseEntry throws on empty highlights", () => {
    expect(() => parseEntry('{"summary":"X","highlights":[]}')).toThrow(/highlights/);
    expect(() => parseEntry('{"summary":"X","highlights":["",""]}')).toThrow(/highlights/);
  });

  it("parseEntry throws when the JSON is not an object", () => {
    expect(() => parseEntry('"just a string"')).toThrow(/JSON object/);
    expect(() => parseEntry("null")).toThrow(/JSON object/);
  });

  it("parseEntry throws on a missing or non-string summary", () => {
    expect(() => parseEntry('{"highlights":["A"]}')).toThrow(/summary/);
    expect(() => parseEntry('{"summary":5,"highlights":["A"]}')).toThrow(/summary/);
  });

  it("parseEntry throws on a non-array or non-string highlights", () => {
    expect(() => parseEntry('{"summary":"X","highlights":"A"}')).toThrow(/highlights/);
    expect(() => parseEntry('{"summary":"X","highlights":[1,2]}')).toThrow(/highlights/);
  });

  it("stripCodeFences extracts JSON from a fenced block surrounded by prose", () => {
    expect(
      parseEntry('Here you go:\n```json\n{"summary":"S","highlights":["A"]}\n```\nHope that helps'),
    ).toEqual({ summary: "S", highlights: ["A"] });
  });

  it("stripCodeFences returns the input unchanged when there is no closing fence", () => {
    expect(stripCodeFences("```json\n{}")).toBe("```json\n{}");
    expect(() => parseEntry('```json\n{"summary":"S","highlights":["A"]}')).toThrow(/valid JSON/);
  });

  it("commitRange lists all commits with no prior tag, else the tag range", () => {
    expect(commitRange(null)).toBe("HEAD");
    expect(commitRange("v0.3.0")).toBe("v0.3.0..HEAD");
  });

  it("diffRange diffs the empty tree with no prior tag, else the tag range", () => {
    expect(diffRange(null)).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904..HEAD");
    expect(diffRange("v0.3.0")).toBe("v0.3.0..HEAD");
  });

  it("openCodeArgs runs the Codex model through OpenCode", () => {
    expect(openCodeArgs("/tmp/changelog-prompt.txt")).toEqual([
      "run",
      "--model",
      "openai/gpt-5.3-codex-spark",
      "--format",
      "default",
      "Use the attached changelog prompt file as your full instructions. Return only the JSON object.",
      "-f",
      "/tmp/changelog-prompt.txt",
    ]);
  });

  it("prependEntry puts the new entry first", () => {
    const existing: ChangelogEntry[] = [
      { version: "0.3.0", date: "2026-06-01", summary: "s", highlights: ["h"] },
    ];
    const next: ChangelogEntry = {
      version: "0.4.0",
      date: "2026-06-27",
      summary: "n",
      highlights: ["x"],
    };
    expect(prependEntry(existing, next).map((e) => e.version)).toEqual(["0.4.0", "0.3.0"]);
  });

  it("prependEntry rejects a duplicate version", () => {
    const existing: ChangelogEntry[] = [
      { version: "0.4.0", date: "2026-06-01", summary: "s", highlights: ["h"] },
    ];
    const dup: ChangelogEntry = {
      version: "0.4.0",
      date: "2026-06-27",
      summary: "n",
      highlights: ["x"],
    };
    expect(() => prependEntry(existing, dup)).toThrow(/already has an entry/);
  });
});
