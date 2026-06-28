import { describe, it, expect } from "vitest";
import { worstSev, SEV_DOT, beatCharacters } from "@/lib/outline/beat-signals";
import type { Character, ContinuityFlag } from "@/lib/types";

const f = (sev: ContinuityFlag["sev"]): ContinuityFlag => ({ sev, tag: "t", text: "x" });

describe("worstSev", () => {
  it("returns null for no flags", () => {
    expect(worstSev([])).toBeNull();
  });

  it("returns the single severity when one flag", () => {
    expect(worstSev([f("ok")])).toBe("ok");
    expect(worstSev([f("warn")])).toBe("warn");
    expect(worstSev([f("flag")])).toBe("flag");
  });

  it("returns the worst severity regardless of order", () => {
    expect(worstSev([f("ok"), f("flag"), f("warn")])).toBe("flag");
    expect(worstSev([f("ok"), f("warn")])).toBe("warn");
    expect(worstSev([f("ok"), f("ok")])).toBe("ok");
  });
});

describe("SEV_DOT", () => {
  it("maps every severity to a token background class", () => {
    expect(SEV_DOT.ok).toBe("bg-success");
    expect(SEV_DOT.warn).toBe("bg-warning");
    expect(SEV_DOT.flag).toBe("bg-destructive");
  });
});

const c = (id: string): Character => ({ id, name: id, color: "oklch(0.7 0.1 30)", role: "" });

describe("beatCharacters", () => {
  it("resolves ids to roster characters in id order", () => {
    const roster = [c("a"), c("b"), c("z")];
    expect(beatCharacters(["z", "a"], roster)).toEqual([c("z"), c("a")]);
  });

  it("drops ids with no matching character", () => {
    expect(beatCharacters(["a", "ghost"], [c("a")])).toEqual([c("a")]);
  });

  it("returns [] for no ids", () => {
    expect(beatCharacters([], [c("a")])).toEqual([]);
  });
});
