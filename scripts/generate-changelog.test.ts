import { describe, it, expect } from "vitest";
import {
  buildPrompt,
  parseEntry,
  prependEntry,
  type ChangelogEntry,
} from "./generate-changelog";

describe("generate-changelog", () => {
  it("buildPrompt includes commits, diff, and the JSON shape", () => {
    const p = buildPrompt(["feat: add X", "chore: bump dep"], "diff --git a b");
    expect(p).toContain("feat: add X");
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
