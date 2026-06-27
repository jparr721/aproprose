import { describe, it, expect } from "vitest";
import { worstSev, SEV_DOT } from "@/lib/outline/beat-signals";
import type { ContinuityFlag } from "@/lib/types";

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
