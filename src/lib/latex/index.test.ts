import { expect, it } from "vitest";
import { countWords } from "@/lib/latex";

it("counts the opening quote plus every tail segment", () => {
  const b = {
    id: "b", type: "dialogue", text: "one two", raw: "", dirty: true,
    tail: [{ kind: "beat", text: "three" }, { kind: "quote", text: "four five" }],
  } as const;
  expect(countWords([b])).toBe(5);
});
