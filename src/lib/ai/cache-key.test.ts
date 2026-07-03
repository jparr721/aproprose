import { describe, expect, it } from "vitest";
import { aiCacheKey } from "@/lib/ai/cache-key";

describe("aiCacheKey", () => {
  it("renders <op>:<chapter>:<scope>:<sel>", () => {
    expect(aiCacheKey("suggest", "ch1", "cursor", "b7")).toBe("suggest:ch1:cursor:b7");
  });

  it("renders a null chapter as an empty segment", () => {
    expect(aiCacheKey("critique", null, "chapter", "")).toBe("critique::chapter:");
  });

  it("matches the tabs' historical hand-built keys exactly", () => {
    expect(aiCacheKey("edit", "ch1", "block", ["e2", "e1"].sort().join(","))).toBe("edit:ch1:block:e1,e2");
    expect(aiCacheKey("continuity", "ch1", "cursor", "B")).toBe("continuity:ch1:cursor:B");
  });
});
